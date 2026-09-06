"use node";

import { WorkOS } from "@workos-inc/node";
import { resolveWorkOSApiKey, resolveWorkOSExpectations, workOSEnvironment } from "./workosAuthConfig";

import type {
  WorkOSEmailVerification,
  WorkOSGateway,
  WorkOSGatewayOperation,
  WorkOSGatewaySession,
  WorkOSGatewayUser,
  WorkOSPasswordReset,
  WorkOSUserClassification,
} from "./workosGateway.ts";
import { categorizeWorkOSError, WorkOSGatewayError } from "./workosErrorPolicy.ts";

export const workosGateway: WorkOSGateway = {
  async lookupUserByEmail(email) {
    return safely("lookupUserByEmail", async () => {
      const users = await getWorkOS().userManagement.listUsers({ email, limit: 2 });
      if (users.data.length === 0) return { kind: "new" };

      const user = toGatewayUser(users.data[0]);
      if (users.data.length !== 1) return { kind: "unknownRecovery", user };

      const identities = await getWorkOS().userManagement.getUserIdentities(user.id);
      if (identities.length === 0) {
        return { kind: user.emailVerified ? "password" : "unverifiedPassword", user };
      }
      if (identities.length === 1 && identities[0].provider === "GoogleOAuth") {
        return { kind: "googleOnly", user };
      }
      if (identities.length === 1 && identities[0].provider === "AppleOAuth") {
        return { kind: "appleOnly", user };
      }
      return { kind: "unknownRecovery", user };
    });
  },

  async createPasswordUser(input) {
    return safely("createPasswordUser", async () =>
      toGatewayUser(
        await getWorkOS().userManagement.createUser({
          email: input.email,
          password: input.password,
          emailVerified: false,
        }),
      ),
    );
  },

  async authenticatePassword(input) {
    try {
      return toGatewaySession(
        await getWorkOS().userManagement.authenticateWithPassword({
          email: input.email,
          password: input.password,
        }),
      );
    } catch (error) {
      const challenge = parseStagingVerificationRequiredChallenge(error);
      if (challenge !== undefined) return challenge;
      if (error instanceof WorkOSGatewayError) throw error;
      throw new WorkOSGatewayError(categorizeWorkOSError("authenticatePassword", error));
    }
  },

  async getEmailVerification(id) {
    return safely("getEmailVerification", async () =>
      toEmailVerification(await getWorkOS().userManagement.getEmailVerification(id)),
    );
  },

  async completeEmailVerification(input) {
    return safely("completeEmailVerification", async () =>
      toGatewaySession(
        await getWorkOS().userManagement.authenticateWithEmailVerification({
          pendingAuthenticationToken: input.pendingAuthenticationToken,
          code: input.code,
        }),
      ),
    );
  },

  async createPasswordReset(email) {
    return safely("createPasswordReset", async () =>
      toPasswordReset(await getWorkOS().userManagement.createPasswordReset({ email })),
    );
  },

  async completePasswordReset(input) {
    return safely("completePasswordReset", async () =>
      toGatewayUser(
        await getWorkOS().userManagement
          .resetPassword(input)
          .then(({ user }) => user),
      ),
    );
  },

  async refreshSession(refreshToken) {
    return safely("refreshSession", async () =>
      toGatewaySession(
        await getWorkOS().userManagement.authenticateWithRefreshToken({ refreshToken }),
      ),
    );
  },

  async revokeSession(sessionId) {
    return safely("revokeSession", () => getWorkOS().userManagement.revokeSession({ sessionId }));
  },

  async getUserById(userId) {
    return safely("getUserById", async () =>
      toGatewayUser(await getWorkOS().userManagement.getUser(userId)),
    );
  },
};

async function safely<T>(operation: WorkOSGatewayOperation, request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof WorkOSGatewayError) throw error;
    throw new WorkOSGatewayError(categorizeWorkOSError(operation, error));
  }
}

function toGatewayUser(user: { id: string; email: string; emailVerified: boolean }): WorkOSGatewayUser {
  return { id: user.id, email: user.email, emailVerified: user.emailVerified };
}

function toGatewaySession(session: {
  user: { id: string; email: string; emailVerified: boolean };
  accessToken: string;
  refreshToken: string;
}): WorkOSGatewaySession {
  return {
    kind: "authenticated",
    user: toGatewayUser(session.user),
    sessionId: sessionIdFromAccessToken(session.accessToken),
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
  };
}

function toEmailVerification(verification: {
  id: string;
  userId: string;
  code: string;
  expiresAt: string;
}): WorkOSEmailVerification {
  return {
    id: verification.id,
    userId: verification.userId,
    code: verification.code,
    expiresAt: verification.expiresAt,
  };
}

function toPasswordReset(reset: {
  id: string;
  userId: string;
  passwordResetToken: string;
  expiresAt: string;
}): WorkOSPasswordReset {
  return {
    id: reset.id,
    userId: reset.userId,
    token: reset.passwordResetToken,
    expiresAt: reset.expiresAt,
  };
}

function sessionIdFromAccessToken(accessToken: string): string {
  try {
    const payload = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64url").toString()) as {
      sid?: unknown;
    };
    if (typeof payload.sid === "string" && payload.sid !== "") return payload.sid;
  } catch {
    // The safe gateway error below intentionally omits provider token details.
  }
  throw new WorkOSGatewayError("providerUnavailable");
}

/**
 * Compatibility parser for the WorkOS staging wire response. SDK 10.11.0 does not
 * declare `rawData.email_verification_id`; a bounded local-Convex staging probe
 * verified that field and that it retrieves the matching verification object.
 */
export function parseStagingVerificationRequiredChallenge(error: unknown) {
  if (typeof error !== "object" || error === null) return undefined;
  const providerError = error as {
    code?: unknown;
    pendingAuthenticationToken?: unknown;
    rawData?: { email_verification_id?: unknown };
  };
  if (providerError.code !== "email_verification_required") return undefined;
  const emailVerificationId = providerError.rawData?.email_verification_id;
  if (
    typeof providerError.pendingAuthenticationToken !== "string" ||
    providerError.pendingAuthenticationToken === "" ||
    typeof emailVerificationId !== "string" ||
    emailVerificationId === ""
  ) {
    throw new WorkOSGatewayError("providerUnavailable");
  }
  return {
    kind: "verificationRequired" as const,
    emailVerificationId,
    pendingAuthenticationToken: providerError.pendingAuthenticationToken,
  };
}

function getWorkOS(): WorkOS {
  const env = workOSEnvironment();
  const trust = resolveWorkOSExpectations(env);
  const apiKey = resolveWorkOSApiKey(env);
  // Resolve per invocation so changed local destinations or credentials cannot
  // retain a previously paired SDK client. Construction performs no request.
  return new WorkOS({
    ...trust.sdkOptions,
    apiKey,
    clientId: trust.clientId,
    maxRetries: 0,
  });
}
