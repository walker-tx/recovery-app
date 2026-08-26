import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkOSGatewayError } from "./workosErrorPolicy.ts";
import type {
  WorkOSGateway,
  WorkOSGatewaySession,
  WorkOSGatewayUser,
  WorkOSUserClassification,
} from "./workosGateway.ts";
import {
  createWorkOSAuthOrchestration,
  WorkOSAuthError,
  type WorkOSAuthOrchestrationDependencies,
  type WorkOSSignupIntent,
} from "./workosAuthOrchestration.ts";

const now = Date.parse("2026-08-26T12:00:00.000Z");
const later = new Date(now + 5 * 60_000).toISOString();

class FakeGateway implements WorkOSGateway {
  readonly users = new Map<string, { classification: WorkOSUserClassification; password?: string }>();
  readonly resets = new Map<string, { userId: string; used: boolean }>();
  readonly sessions = new Map<string, WorkOSGatewaySession>();
  calls: string[] = [];
  nextFailure?: { operation: keyof WorkOSGateway; category: ConstructorParameters<typeof WorkOSGatewayError>[0] };

  seed(classification: Exclude<WorkOSUserClassification, { kind: "new" }>, password?: string) {
    this.users.set(classification.user.email.toLowerCase(), { classification, password });
  }

  fail(operation: keyof WorkOSGateway, category: ConstructorParameters<typeof WorkOSGatewayError>[0]) {
    this.nextFailure = { operation, category };
  }

  private maybeFail(operation: keyof WorkOSGateway) {
    this.calls.push(operation);
    if (this.nextFailure?.operation === operation) {
      const category = this.nextFailure.category;
      this.nextFailure = undefined;
      throw new WorkOSGatewayError(category);
    }
  }

  async lookupUserByEmail(email: string) {
    this.maybeFail("lookupUserByEmail");
    return this.users.get(email)?.classification ?? { kind: "new" as const };
  }

  async createPasswordUser(input: { email: string; password: string }) {
    this.maybeFail("createPasswordUser");
    const user = userFor(input.email, false);
    this.seed({ kind: "unverifiedPassword", user }, input.password);
    return user;
  }

  async authenticatePassword(input: { email: string; password: string }) {
    this.maybeFail("authenticatePassword");
    const entry = this.users.get(input.email);
    if (entry?.password !== input.password || entry.classification.kind === "new") {
      throw new WorkOSGatewayError("invalidCredentials");
    }
    if (entry.classification.kind === "unverifiedPassword") {
      return {
        kind: "verificationRequired" as const,
        emailVerificationId: `verification-${entry.classification.user.id}`,
        pendingAuthenticationToken: `pending-${entry.classification.user.id}`,
      };
    }
    return this.newSession(entry.classification.user);
  }

  async getEmailVerification(id: string) {
    this.maybeFail("getEmailVerification");
    return {
      id,
      userId: id.replace(/^verification-/, ""),
      code: "123456",
      expiresAt: later,
    };
  }

  async completeEmailVerification(input: { pendingAuthenticationToken: string; code: string }) {
    this.maybeFail("completeEmailVerification");
    const userId = input.pendingAuthenticationToken.replace(/^pending-/, "");
    const entry = [...this.users.values()].find(
      (candidate) => candidate.classification.kind !== "new" && candidate.classification.user.id === userId,
    );
    if (!entry || input.code !== "123456" || entry.classification.kind === "new") {
      throw new WorkOSGatewayError("invalidVerification");
    }
    const user = { ...entry.classification.user, emailVerified: true };
    this.seed({ kind: "password", user }, entry.password);
    return this.newSession(user);
  }

  async createPasswordReset(email: string) {
    this.maybeFail("createPasswordReset");
    const entry = this.users.get(email);
    if (!entry || entry.classification.kind === "new") throw new WorkOSGatewayError("invalidReset");
    const reset = {
      id: `reset-${entry.classification.user.id}`,
      userId: entry.classification.user.id,
      token: `reset-token-${entry.classification.user.id}`,
      expiresAt: later,
    };
    this.resets.set(reset.token, { userId: reset.userId, used: false });
    return reset;
  }

  async completePasswordReset(input: { token: string; newPassword: string }) {
    this.maybeFail("completePasswordReset");
    const reset = this.resets.get(input.token);
    if (!reset || reset.used) throw new WorkOSGatewayError("invalidReset");
    reset.used = true;
    const entry = [...this.users.values()].find(
      (candidate) => candidate.classification.kind !== "new" && candidate.classification.user.id === reset.userId,
    );
    if (!entry || entry.classification.kind === "new") throw new WorkOSGatewayError("invalidReset");
    this.seed({ kind: "password", user: entry.classification.user }, input.newPassword);
    return entry.classification.user;
  }

  async refreshSession(refreshToken: string) {
    this.maybeFail("refreshSession");
    const session = this.sessions.get(refreshToken);
    if (!session) throw new WorkOSGatewayError("invalidSession");
    return { ...session, accessToken: `${session.accessToken}-refreshed` };
  }

  async revokeSession(sessionId: string) {
    this.maybeFail("revokeSession");
    const session = [...this.sessions.values()].find((candidate) => candidate.sessionId === sessionId);
    if (!session) throw new WorkOSGatewayError("invalidSession");
    this.sessions.delete(session.refreshToken);
  }

  async getUserById(userId: string) {
    this.maybeFail("getUserById");
    const entry = [...this.users.values()].find(
      (candidate) => candidate.classification.kind !== "new" && candidate.classification.user.id === userId,
    );
    if (!entry || entry.classification.kind === "new") throw new WorkOSGatewayError("providerUnavailable");
    return entry.classification.user;
  }

  sessionFor(email: string) {
    const entry = this.users.get(email);
    if (!entry || entry.classification.kind === "new") throw new Error("missing fake user");
    return this.newSession(entry.classification.user);
  }

  private newSession(user: WorkOSGatewayUser) {
    const session: WorkOSGatewaySession = {
      kind: "authenticated",
      user,
      sessionId: `session-${user.id}`,
      accessToken: `access-${user.id}`,
      refreshToken: `refresh-${user.id}`,
    };
    this.sessions.set(session.refreshToken, session);
    return session;
  }
}

function userFor(email: string, emailVerified = true): WorkOSGatewayUser {
  return { id: `user-${email}`, email, emailVerified };
}

function harness() {
  const gateway = new FakeGateway();
  const intents = new Map<string, WorkOSSignupIntent & { state: "pending" | "inFlight" | "consumed" }>();
  const delivered = { verification: [] as unknown[], reset: [] as unknown[], guidance: [] as unknown[] };
  const cleanup = vi.fn(async () => undefined);
  let nextIntent = 0;
  const dependencies: WorkOSAuthOrchestrationDependencies = {
    gateway,
    now: () => now,
    newIntentId: () => `00000000-0000-4000-8000-${String(++nextIntent).padStart(12, "0")}`,
    fingerprintEmail: (email) => `fingerprint:${email}`,
    encryptPendingAuthenticationToken: (token) => ({
      ciphertext: [...token].reverse().join(""),
      nonce: "nonce",
      authenticationTag: "tag",
    }),
    decryptPendingAuthenticationToken: (encrypted) =>
      [...encrypted.ciphertext].reverse().join(""),
    intents: {
      admitInitiationRequest: vi.fn(async () => true),
      createSignupIntent: async (input) => {
        if (intents.has(input.publicId)) throw new Error("duplicate intent");
        intents.set(input.publicId, { ...input, state: "pending" });
      },
      acquireSignupIntent: async ({ publicId, leaseExpiresAt }) => {
        const intent = intents.get(publicId);
        if (!intent || intent.state !== "pending" || intent.now + 10 * 60_000 <= now) {
          throw new WorkOSAuthError("INVALID_SIGNUP");
        }
        intent.state = "inFlight";
        return { ...intent, leaseExpiresAt };
      },
      releaseSignupIntentLease: async ({ publicId }) => {
        const intent = intents.get(publicId);
        if (!intent || intent.state !== "inFlight") throw new WorkOSAuthError("INVALID_SIGNUP");
        intent.state = "pending";
      },
      completeSignupIntent: async ({ publicId }) => {
        const intent = intents.get(publicId);
        if (!intent || intent.state !== "inFlight") throw new WorkOSAuthError("INVALID_SIGNUP");
        intent.state = "consumed";
      },
      cleanupExpiredAuthData: cleanup,
    },
    delivery: {
      verification: (input) => delivered.verification.push(input),
      reset: (input) => delivered.reset.push(input),
      guidance: (input) => delivered.guidance.push(input),
    },
  };
  return { auth: createWorkOSAuthOrchestration(dependencies), dependencies, gateway, intents, delivered, cleanup };
}

function expectAuthError(code: string) {
  return expect.objectContaining({ code });
}

describe("WorkOS auth orchestration", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("starts new signup and resumes unverified signup without exposing account state", async () => {
    const test = harness();
    const first = await test.auth.startSignup({ email: " Person@Example.NET ", password: "a-password" });
    const resumed = await test.auth.startSignup({ email: "person@example.net", password: "a-password" });

    expect(first).toEqual({ accepted: true, intentId: expect.any(String) });
    expect(resumed).toEqual({ accepted: true, intentId: expect.any(String) });
    expect(first.intentId).not.toBe(resumed.intentId);
    expect(test.delivered.verification).toHaveLength(2);
    expect(test.intents.get(first.intentId)?.encryptedPendingToken).toBeDefined();
    expect(test.intents.get(resumed.intentId)?.encryptedPendingToken).toBeDefined();
    expect(JSON.stringify(test.intents.get(first.intentId))).not.toContain("a-password");
    expect(JSON.stringify(test.intents.get(first.intentId))).not.toContain("pending-user");
  });

  it.each(["password", "googleOnly", "appleOnly"] as const)(
    "keeps existing %s signup neutral and stores only private guidance",
    async (kind) => {
      const test = harness();
      const email = `${kind}@example.net`;
      test.gateway.seed({ kind, user: userFor(email) });

      const result = await test.auth.startSignup({ email, password: "not-persisted" });

      expect(result).toEqual({ accepted: true, intentId: expect.any(String) });
      expect(test.intents.get(result.intentId)?.encryptedPendingToken).toBeUndefined();
      expect(test.delivered.guidance).toHaveLength(1);
    },
  );

  it("completes verification once and rejects consumed intent replay", async () => {
    const test = harness();
    const started = await test.auth.startSignup({ email: "new@example.net", password: "a-password" });

    await expect(test.auth.completeSignup({ intentId: started.intentId, code: "123456" })).resolves.toEqual({
      accessToken: "access-user-new@example.net",
      refreshToken: "refresh-user-new@example.net",
    });
    await expect(test.auth.completeSignup({ intentId: started.intentId, code: "123456" })).rejects.toEqual(
      expectAuthError("INVALID_SIGNUP"),
    );
  });

  it("uses one safe signup error for expired, invalid, inapplicable, and duplicate intents", async () => {
    const test = harness();
    test.gateway.seed({ kind: "password", user: userFor("existing@example.net") });
    const inapplicable = await test.auth.startSignup({ email: "existing@example.net", password: "ignored" });

    await expect(test.auth.completeSignup({ intentId: "missing", code: "123456" })).rejects.toEqual(expectAuthError("INVALID_SIGNUP"));
    await expect(test.auth.completeSignup({ intentId: inapplicable.intentId, code: "123456" })).rejects.toEqual(expectAuthError("INVALID_SIGNUP"));
    const expired = await test.auth.startSignup({ email: "expired@example.net", password: "password" });
    test.intents.get(expired.intentId)!.now = now - 11 * 60_000;
    await expect(test.auth.completeSignup({ intentId: expired.intentId, code: "123456" })).rejects.toEqual(expectAuthError("INVALID_SIGNUP"));
    const intent = test.intents.get(inapplicable.intentId)!;
    intent.state = "inFlight";
    await expect(test.auth.completeSignup({ intentId: inapplicable.intentId, code: "123456" })).rejects.toEqual(expectAuthError("INVALID_SIGNUP"));
  });

  it("releases the signup lease after invalid code and retryable provider failure", async () => {
    const invalid = harness();
    const first = await invalid.auth.startSignup({ email: "invalid@example.net", password: "a-password" });
    await expect(invalid.auth.completeSignup({ intentId: first.intentId, code: "000000" })).rejects.toEqual(expectAuthError("INVALID_SIGNUP"));
    expect(invalid.intents.get(first.intentId)?.state).toBe("pending");

    const retryable = harness();
    const second = await retryable.auth.startSignup({ email: "retry@example.net", password: "a-password" });
    retryable.gateway.fail("completeEmailVerification", "providerUnavailable");
    await expect(retryable.auth.completeSignup({ intentId: second.intentId, code: "123456" })).rejects.toEqual(expectAuthError("PROVIDER_UNAVAILABLE"));
    expect(retryable.intents.get(second.intentId)?.state).toBe("pending");
  });

  it("normalizes unknown account and wrong password into one sign-in error", async () => {
    const test = harness();
    test.gateway.seed({ kind: "password", user: userFor("known@example.net") }, "correct");

    await expect(test.auth.signIn({ email: "missing@example.net", password: "wrong" })).rejects.toEqual(expectAuthError("INVALID_CREDENTIALS"));
    await expect(test.auth.signIn({ email: "known@example.net", password: "wrong" })).rejects.toEqual(expectAuthError("INVALID_CREDENTIALS"));
  });

  it("returns session credentials for sign-in and stable refresh", async () => {
    const test = harness();
    test.gateway.seed({ kind: "password", user: userFor("person@example.net") }, "correct");
    const signedIn = await test.auth.signIn({ email: "person@example.net", password: "correct" });

    await expect(test.auth.refreshSession({ refreshToken: signedIn.refreshToken })).resolves.toEqual({
      status: "success",
      accessToken: "access-user-person@example.net-refreshed",
      refreshToken: signedIn.refreshToken,
    });
  });

  it("separates terminal invalid refresh from retryable provider failure", async () => {
    const test = harness();
    await expect(test.auth.refreshSession({ refreshToken: "expired" })).resolves.toEqual({ status: "invalid" });
    test.gateway.fail("refreshSession", "providerUnavailable");
    await expect(test.auth.refreshSession({ refreshToken: "retry" })).rejects.toEqual(expectAuthError("PROVIDER_UNAVAILABLE"));
  });

  it.each([
    "new",
    "password",
    "unverifiedPassword",
    "unknownRecovery",
    "googleOnly",
    "appleOnly",
  ] as const)(
    "keeps %s recovery neutral",
    async (kind) => {
      const test = harness();
      const email = `${kind}@example.net`;
      if (kind !== "new") test.gateway.seed({ kind, user: userFor(email) });

      await expect(test.auth.startRecovery({ email })).resolves.toEqual({ accepted: true });
      expect(test.delivered.reset).toHaveLength(
        kind === "password" || kind === "unverifiedPassword" ? 1 : 0,
      );
      expect(test.delivered.guidance).toHaveLength(kind === "googleOnly" || kind === "appleOnly" || kind === "unknownRecovery" ? 1 : 0);
    },
  );

  it("resets a password once and rejects token replay", async () => {
    const test = harness();
    test.gateway.seed({ kind: "password", user: userFor("reset@example.net") }, "old");
    await test.auth.startRecovery({ email: "reset@example.net" });
    const token = "reset-token-user-reset@example.net";

    await expect(test.auth.resetPassword({ token, newPassword: "new" })).resolves.toEqual({ reset: true });
    await expect(test.auth.resetPassword({ token, newPassword: "newer" })).rejects.toEqual(expectAuthError("INVALID_RESET"));
  });

  it("revokes only after validating the refresh credential and reports failures", async () => {
    const success = harness();
    success.gateway.seed({ kind: "password", user: userFor("out@example.net") }, "password");
    const session = success.gateway.sessionFor("out@example.net");
    await expect(success.auth.signOutSession({ refreshToken: session.refreshToken })).resolves.toEqual({ revoked: true });
    expect(success.gateway.calls.slice(-2)).toEqual(["refreshSession", "revokeSession"]);

    const failure = harness();
    failure.gateway.seed({ kind: "password", user: userFor("fail@example.net") }, "password");
    const failedSession = failure.gateway.sessionFor("fail@example.net");
    failure.gateway.fail("revokeSession", "providerUnavailable");
    await expect(failure.auth.signOutSession({ refreshToken: failedSession.refreshToken })).rejects.toEqual(expectAuthError("PROVIDER_UNAVAILABLE"));
    await expect(failure.auth.signOutSession({ refreshToken: "invalid" })).rejects.toEqual(
      expectAuthError("INVALID_SESSION"),
    );
  });

  it("keeps duplicate/rate-limited initiation neutral and attempts cleanup after failures", async () => {
    const limited = harness();
    vi.mocked(limited.dependencies.intents.admitInitiationRequest).mockResolvedValue(false);
    await expect(limited.auth.startSignup({ email: "limit@example.net", password: "password" })).resolves.toEqual({ accepted: true, intentId: expect.any(String) });
    expect(limited.gateway.calls).toEqual([]);

    const failed = harness();
    failed.gateway.fail("createPasswordUser", "rateLimited");
    await expect(failed.auth.startSignup({ email: "rate@example.net", password: "password" })).resolves.toEqual({ accepted: true, intentId: expect.any(String) });
    expect(failed.cleanup).toHaveBeenCalled();
  });
});
