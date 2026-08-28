import type { PrivateGuidanceCategory } from "./authEmailTemplates.ts";
import type {
  WorkOSGateway,
  WorkOSGatewaySession,
  WorkOSUserClassification,
} from "./workosGateway.ts";
import { WorkOSGatewayError } from "./workosErrorPolicy.ts";
import type { EncryptedPendingAuthenticationToken } from "./workosIntentCrypto.ts";
import { normalizeAuthEmail, recoveryInitiationResult, signupInitiationResult } from "./workosAuthPolicy.ts";

const SIGNUP_LEASE_MS = 30_000;
const INTENT_ID_GENERATION_ATTEMPTS = 2;
const DURABLE_COMPLETION_ATTEMPTS = 2;

export type WorkOSAuthErrorCode =
  | "INVALID_CREDENTIALS"
  | "INVALID_RESET"
  | "INVALID_SESSION"
  | "INVALID_SIGNUP"
  | "PROVIDER_UNAVAILABLE";

export class WorkOSAuthError extends Error {
  readonly name = "WorkOSAuthError";

  constructor(readonly code: WorkOSAuthErrorCode) {
    super(code);
  }
}

export type WorkOSSignupIntent = {
  publicId: string;
  emailFingerprint: string;
  purpose: "signup";
  encryptedPendingToken?: EncryptedPendingAuthenticationToken;
  privateGuidanceCategory?: PrivateGuidanceCategory;
  now: number;
};

type AcquiredSignupIntent = Omit<WorkOSSignupIntent, "publicId" | "now"> & {
  leaseExpiresAt: number;
};

type SignupIntentStore = {
  admitInitiationRequest(input: {
    emailFingerprint: string;
    purpose: "signup" | "recovery";
    now: number;
  }): Promise<boolean>;
  createSignupIntent(input: WorkOSSignupIntent): Promise<void>;
  acquireSignupIntent(input: {
    publicId: string;
    now: number;
    leaseExpiresAt: number;
  }): Promise<AcquiredSignupIntent>;
  releaseSignupIntentLease(input: { publicId: string; leaseExpiresAt: number }): Promise<void>;
  completeSignupIntent(input: { publicId: string; leaseExpiresAt: number; now: number }): Promise<void>;
  cleanupExpiredAuthData(): Promise<void>;
};

type AuthDelivery = {
  verification(input: { email: string; code: string; expiresAt: number }): void;
  reset(input: { email: string; resetToken: string; expiresAt: number }): void;
  guidance(input: { email: string; category: PrivateGuidanceCategory; expiresAt: number }): void;
};

export type WorkOSAuthOrchestrationDependencies = {
  gateway: WorkOSGateway;
  intents: SignupIntentStore;
  delivery: AuthDelivery;
  now(): number;
  newIntentId(): string;
  fingerprintEmail(normalizedEmail: string): string;
  encryptPendingAuthenticationToken(token: string): EncryptedPendingAuthenticationToken;
  decryptPendingAuthenticationToken(encrypted: EncryptedPendingAuthenticationToken): string;
};

type PublicSession = { accessToken: string; refreshToken: string };

export function createWorkOSAuthOrchestration(dependencies: WorkOSAuthOrchestrationDependencies) {
  const startSignup = async (input: { email: string; password: string }) => {
    const email = normalizeAuthEmail(input.email);
    const generatedIntent = generateSignupIntentId(dependencies.newIntentId);
    const intentId = generatedIntent.intentId;

    if (!generatedIntent.canPersist) {
      await cleanupSafely(dependencies.intents);
      return signupInitiationResult("providerUnavailable", intentId);
    }

    try {
      const emailFingerprint = dependencies.fingerprintEmail(email);
      const admitted = await dependencies.intents.admitInitiationRequest({
        emailFingerprint,
        purpose: "signup",
        now: dependencies.now(),
      });
      if (!admitted) return signupInitiationResult("rateLimited", intentId);

      const classification = await dependencies.gateway.lookupUserByEmail(email);
      if (classification.kind === "new" || classification.kind === "unverifiedPassword") {
        const user =
          classification.kind === "new"
            ? await dependencies.gateway.createPasswordUser({ email, password: input.password })
            : classification.user;
        const authentication = await dependencies.gateway.authenticatePassword({
          email,
          password: input.password,
        });
        if (authentication.kind === "verificationRequired") {
          const verification = await dependencies.gateway.getEmailVerification(
            authentication.emailVerificationId,
          );
          if (verification.userId !== user.id) throw new WorkOSGatewayError("providerUnavailable");
          dependencies.delivery.verification({
            email,
            code: verification.code,
            expiresAt: Date.parse(verification.expiresAt),
          });
          await dependencies.intents.createSignupIntent({
            publicId: intentId,
            emailFingerprint,
            purpose: "signup",
            encryptedPendingToken: dependencies.encryptPendingAuthenticationToken(
              authentication.pendingAuthenticationToken,
            ),
            now: dependencies.now(),
          });
          return signupInitiationResult(classification, intentId);
        }
      }

      const guidance = guidanceFor(classification);
      if (guidance !== undefined) {
        dependencies.delivery.guidance({
          email,
          category: guidance,
          expiresAt: dependencies.now() + 10 * 60_000,
        });
      }
      await dependencies.intents.createSignupIntent({
        publicId: intentId,
        emailFingerprint,
        purpose: "signup",
        ...(guidance === undefined ? {} : { privateGuidanceCategory: guidance }),
        now: dependencies.now(),
      });
      return signupInitiationResult(classification, intentId);
    } catch (error) {
      return signupInitiationResult(
        error instanceof WorkOSGatewayError ? error.category : "providerUnavailable",
        intentId,
      );
    } finally {
      await cleanupSafely(dependencies.intents);
    }
  };

  const completeSignup = async (input: { intentId: string; code: string }): Promise<PublicSession> => {
    const leaseExpiresAt = dependencies.now() + SIGNUP_LEASE_MS;
    let acquired: AcquiredSignupIntent;
    try {
      acquired = await dependencies.intents.acquireSignupIntent({
        publicId: input.intentId,
        now: dependencies.now(),
        leaseExpiresAt,
      });
    } catch {
      throw new WorkOSAuthError("INVALID_SIGNUP");
    }

    let providerCompleted = false;
    try {
      if (acquired.encryptedPendingToken === undefined) {
        throw new WorkOSAuthError("INVALID_SIGNUP");
      }
      const session = await dependencies.gateway.completeEmailVerification({
        pendingAuthenticationToken: dependencies.decryptPendingAuthenticationToken(
          acquired.encryptedPendingToken,
        ),
        code: input.code,
      });
      providerCompleted = true;
      const consumed = await completeSignupIntentWithRetry(
        dependencies.intents,
        {
          publicId: input.intentId,
          leaseExpiresAt,
          now: dependencies.now(),
        },
        DURABLE_COMPLETION_ATTEMPTS,
      );
      if (!consumed) {
        await revokeSafely(dependencies.gateway, session.sessionId);
        throw providerUnavailable();
      }
      return publicSession(session);
    } catch (error) {
      if (!providerCompleted) {
        await releaseSafely(dependencies.intents, input.intentId, leaseExpiresAt);
      }
      if (error instanceof WorkOSAuthError) throw error;
      if (error instanceof WorkOSGatewayError) {
        if (error.category === "invalidVerification") throw new WorkOSAuthError("INVALID_SIGNUP");
        throw providerUnavailable();
      }
      throw providerCompleted ? providerUnavailable() : new WorkOSAuthError("INVALID_SIGNUP");
    } finally {
      await cleanupSafely(dependencies.intents);
    }
  };

  const signIn = async (input: { email: string; password: string }): Promise<PublicSession> => {
    try {
      const authentication = await dependencies.gateway.authenticatePassword({
        email: normalizeAuthEmail(input.email),
        password: input.password,
      });
      if (authentication.kind === "verificationRequired") {
        throw new WorkOSAuthError("INVALID_CREDENTIALS");
      }
      return publicSession(authentication);
    } catch (error) {
      if (error instanceof WorkOSAuthError) throw error;
      if (error instanceof WorkOSGatewayError && error.category === "invalidCredentials") {
        throw new WorkOSAuthError("INVALID_CREDENTIALS");
      }
      throw providerUnavailable();
    }
  };

  const refreshSession = async (input: { refreshToken: string }) => {
    try {
      const session = await dependencies.gateway.refreshSession(input.refreshToken);
      return { status: "success" as const, ...publicSession(session) };
    } catch (error) {
      if (error instanceof WorkOSGatewayError && error.category === "invalidSession") {
        return { status: "invalid" as const };
      }
      throw providerUnavailable();
    }
  };

  const signOutSession = async (input: { refreshToken: string }) => {
    try {
      const session = await dependencies.gateway.refreshSession(input.refreshToken);
      await dependencies.gateway.revokeSession(session.sessionId);
      return { revoked: true as const };
    } catch (error) {
      if (error instanceof WorkOSGatewayError && error.category === "invalidSession") {
        throw new WorkOSAuthError("INVALID_SESSION");
      }
      throw providerUnavailable();
    }
  };

  const startRecovery = async (input: { email: string }) => {
    const email = normalizeAuthEmail(input.email);
    try {
      const emailFingerprint = dependencies.fingerprintEmail(email);
      const admitted = await dependencies.intents.admitInitiationRequest({
        emailFingerprint,
        purpose: "recovery",
        now: dependencies.now(),
      });
      if (!admitted) return recoveryInitiationResult("rateLimited");

      const classification = await dependencies.gateway.lookupUserByEmail(email);
      if (classification.kind === "password" || classification.kind === "unverifiedPassword") {
        const reset = await dependencies.gateway.createPasswordReset(email);
        dependencies.delivery.reset({
          email,
          resetToken: reset.token,
          expiresAt: Date.parse(reset.expiresAt),
        });
      } else {
        const guidance = guidanceFor(classification);
        if (guidance !== undefined && classification.kind !== "new") {
          dependencies.delivery.guidance({
            email,
            category: guidance,
            expiresAt: dependencies.now() + 10 * 60_000,
          });
        }
      }
      return recoveryInitiationResult(classification);
    } catch (error) {
      return recoveryInitiationResult(
        error instanceof WorkOSGatewayError ? error.category : "providerUnavailable",
      );
    } finally {
      await cleanupSafely(dependencies.intents);
    }
  };

  const resetPassword = async (input: { token: string; newPassword: string }) => {
    try {
      await dependencies.gateway.completePasswordReset(input);
      return { reset: true as const };
    } catch (error) {
      if (error instanceof WorkOSGatewayError && error.category === "invalidReset") {
        throw new WorkOSAuthError("INVALID_RESET");
      }
      throw providerUnavailable();
    }
  };

  return {
    startSignup,
    completeSignup,
    signIn,
    refreshSession,
    signOutSession,
    startRecovery,
    resetPassword,
  };
}

function publicSession(session: WorkOSGatewaySession): PublicSession {
  return { accessToken: session.accessToken, refreshToken: session.refreshToken };
}

function guidanceFor(classification: WorkOSUserClassification): PrivateGuidanceCategory | undefined {
  if (
    classification.kind === "password" ||
    classification.kind === "unverifiedPassword" ||
    classification.kind === "unknownRecovery"
  ) {
    return "passwordSignInOrRecovery";
  }
  if (classification.kind === "googleOnly") return "googleSignIn";
  if (classification.kind === "appleOnly") return "appleSignIn";
  return undefined;
}

function providerUnavailable() {
  return new WorkOSAuthError("PROVIDER_UNAVAILABLE");
}

function generateSignupIntentId(generate: () => string) {
  for (let attempt = 0; attempt < INTENT_ID_GENERATION_ATTEMPTS; attempt += 1) {
    try {
      return { intentId: generate(), canPersist: true as const };
    } catch {
      // Retry the application-owned generator before using a response-only fallback.
    }
  }
  return { intentId: globalThis.crypto.randomUUID(), canPersist: false as const };
}

async function completeSignupIntentWithRetry(
  store: SignupIntentStore,
  input: { publicId: string; leaseExpiresAt: number; now: number },
  attempts: number,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await store.completeSignupIntent(input);
      return true;
    } catch {
      // Retry is bounded; credentials remain private until durable consumption succeeds.
    }
  }
  return false;
}

async function revokeSafely(gateway: WorkOSGateway, sessionId: string) {
  try {
    await gateway.revokeSession(sessionId);
  } catch {
    // The public result remains failure even if compensating revocation is unavailable.
  }
}

async function releaseSafely(store: SignupIntentStore, publicId: string, leaseExpiresAt: number) {
  try {
    await store.releaseSignupIntentLease({ publicId, leaseExpiresAt });
  } catch {
    // Preserve the safe orchestration error; the lease expiry permits later recovery.
  }
}

async function cleanupSafely(store: SignupIntentStore) {
  try {
    await store.cleanupExpiredAuthData();
  } catch {
    // Cleanup is opportunistic and must not change the public auth result.
  }
}
