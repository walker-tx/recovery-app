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
  readonly completedPendingTokens = new Set<string>();
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
    if (this.completedPendingTokens.has(input.pendingAuthenticationToken)) {
      throw new WorkOSGatewayError("invalidVerification");
    }
    const userId = input.pendingAuthenticationToken.replace(/^pending-/, "");
    const entry = [...this.users.values()].find(
      (candidate) => candidate.classification.kind !== "new" && candidate.classification.user.id === userId,
    );
    if (!entry || input.code !== "123456" || entry.classification.kind === "new") {
      throw new WorkOSGatewayError("invalidVerification");
    }
    this.completedPendingTokens.add(input.pendingAuthenticationToken);
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
    const refreshed = {
      ...session,
      accessToken: `${session.accessToken}-refreshed`,
      refreshToken: `${refreshToken}-rotated`,
    };
    this.sessions.delete(refreshToken);
    this.sessions.set(refreshed.refreshToken, refreshed);
    return refreshed;
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
  let currentTime = now;
  const intents = new Map<
    string,
    WorkOSSignupIntent & {
      state: "pending" | "inFlight" | "consumed";
      leaseExpiresAt?: number;
    }
  >();
  const delivered = { verification: [] as unknown[], reset: [] as unknown[], guidance: [] as unknown[] };
  const cleanup = vi.fn(async () => undefined);
  let nextIntent = 0;
  const dependencies: WorkOSAuthOrchestrationDependencies = {
    gateway,
    now: () => currentTime,
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
      acquireSignupIntent: async ({ publicId, now: requestedAt, leaseExpiresAt }) => {
        const intent = intents.get(publicId);
        const acquirable =
          intent?.state === "pending" ||
          (intent?.state === "inFlight" &&
            intent.leaseExpiresAt !== undefined &&
            intent.leaseExpiresAt <= requestedAt);
        if (!intent || !acquirable || intent.now + 10 * 60_000 <= requestedAt) {
          throw new WorkOSAuthError("INVALID_SIGNUP");
        }
        intent.state = "inFlight";
        intent.leaseExpiresAt = leaseExpiresAt;
        return { ...intent, leaseExpiresAt };
      },
      releaseSignupIntentLease: async ({ publicId, leaseExpiresAt }) => {
        const intent = intents.get(publicId);
        if (
          !intent ||
          intent.state !== "inFlight" ||
          intent.leaseExpiresAt !== leaseExpiresAt
        ) {
          throw new WorkOSAuthError("INVALID_SIGNUP");
        }
        intent.state = "pending";
        intent.leaseExpiresAt = undefined;
      },
      completeSignupIntent: async ({ publicId, leaseExpiresAt }) => {
        const intent = intents.get(publicId);
        if (
          !intent ||
          intent.state !== "inFlight" ||
          intent.leaseExpiresAt !== leaseExpiresAt
        ) {
          throw new WorkOSAuthError("INVALID_SIGNUP");
        }
        intent.state = "consumed";
        intent.leaseExpiresAt = undefined;
      },
      cleanupExpiredAuthData: cleanup,
    },
    delivery: {
      verification: (input) => { delivered.verification.push(input); },
      reset: (input) => { delivered.reset.push(input); },
      guidance: (input) => { delivered.guidance.push(input); },
    },
  };
  return {
    auth: createWorkOSAuthOrchestration(dependencies),
    dependencies,
    gateway,
    intents,
    delivered,
    cleanup,
    advanceTime: (milliseconds: number) => {
      currentTime += milliseconds;
    },
  };
}

function expectAuthError(code: string) {
  return expect.objectContaining({ code });
}

describe("WorkOS auth orchestration", () => {
  it("waits for verification delivery before completing signup initiation", async () => {
    const test = harness();
    let resolveDelivery!: () => void;
    const delivery = new Promise<void>((resolve) => {
      resolveDelivery = resolve;
    });
    const verification = vi.fn(() => delivery);
    test.dependencies.delivery.verification = verification;

    const operation = test.auth.startSignup({ email: "awaited@example.net", password: "password" });
    const settled = vi.fn();
    void operation.then(settled);
    await vi.waitFor(() => expect(verification).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(settled).not.toHaveBeenCalled();
    resolveDelivery();
    await expect(operation).resolves.toEqual({
      accepted: true,
      intentId: "00000000-0000-4000-8000-000000000001",
    });
  });

  beforeEach(() => vi.restoreAllMocks());

  it("returns a neutral fallback without starting signup when intent ID generation fails", async () => {
    const test = harness();
    const generate = vi.fn(() => {
      throw new Error("rng unavailable");
    });
    test.dependencies.newIntentId = generate;
    const createIntent = vi.spyOn(test.dependencies.intents, "createSignupIntent");

    await expect(
      test.auth.startSignup({ email: "rng-failure@example.net", password: "a-password" }),
    ).resolves.toEqual({
      accepted: true,
      intentId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
    });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(test.dependencies.intents.admitInitiationRequest).not.toHaveBeenCalled();
    expect(createIntent).not.toHaveBeenCalled();
    expect(test.gateway.calls).toEqual([]);
    expect(test.delivered).toEqual({ verification: [], reset: [], guidance: [] });
  });

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

  it("orders acquire, provider completion, durable consumption, then public success", async () => {
    const test = harness();
    const started = await test.auth.startSignup({
      email: "ordered@example.net",
      password: "password",
    });
    const events: string[] = [];
    const acquire = test.dependencies.intents.acquireSignupIntent;
    const providerComplete = test.gateway.completeEmailVerification.bind(test.gateway);
    const durableComplete = test.dependencies.intents.completeSignupIntent;
    vi.spyOn(test.dependencies.intents, "acquireSignupIntent").mockImplementation(async (input) => {
      events.push("acquire");
      return acquire(input);
    });
    vi.spyOn(test.gateway, "completeEmailVerification").mockImplementation(async (input) => {
      events.push("providerComplete");
      return providerComplete(input);
    });
    vi.spyOn(test.dependencies.intents, "completeSignupIntent").mockImplementation(
      async (input) => {
        events.push("durableConsume");
        return durableComplete(input);
      },
    );

    await test.auth.completeSignup({ intentId: started.intentId, code: "123456" });
    events.push("publicSuccess");

    expect(events).toEqual(["acquire", "providerComplete", "durableConsume", "publicSuccess"]);
  });

  it("retries durable consumption once before returning provider credentials", async () => {
    const test = harness();
    const started = await test.auth.startSignup({
      email: "retry-persistence@example.net",
      password: "password",
    });
    const durableComplete = test.dependencies.intents.completeSignupIntent;
    let attempts = 0;
    vi.spyOn(test.dependencies.intents, "completeSignupIntent").mockImplementation(
      async (input) => {
        attempts += 1;
        if (attempts === 1) throw new Error("transient persistence failure");
        return durableComplete(input);
      },
    );

    await expect(
      test.auth.completeSignup({ intentId: started.intentId, code: "123456" }),
    ).resolves.toEqual({
      accessToken: "access-user-retry-persistence@example.net",
      refreshToken: "refresh-user-retry-persistence@example.net",
    });
    expect(attempts).toBe(2);
    expect(test.gateway.calls).not.toContain("revokeSession");
    expect(test.intents.get(started.intentId)?.state).toBe("consumed");
  });

  it("revokes a verified session when durable consumption exhausts retries", async () => {
    const test = harness();
    const started = await test.auth.startSignup({
      email: "failed-persistence@example.net",
      password: "password",
    });
    const complete = vi
      .spyOn(test.dependencies.intents, "completeSignupIntent")
      .mockRejectedValue(new Error("persistent storage failure"));

    await expect(
      test.auth.completeSignup({ intentId: started.intentId, code: "123456" }),
    ).rejects.toEqual(expectAuthError("PROVIDER_UNAVAILABLE"));
    expect(complete).toHaveBeenCalledTimes(2);
    expect(test.gateway.calls.slice(-2)).toEqual(["completeEmailVerification", "revokeSession"]);
    expect(test.gateway.sessions).toHaveLength(0);
    expect(test.intents.get(started.intentId)?.state).toBe("inFlight");

    await expect(
      test.auth.completeSignup({ intentId: started.intentId, code: "123456" }),
    ).rejects.toEqual(expectAuthError("INVALID_SIGNUP"));
    test.advanceTime(30_001);
    await expect(
      test.auth.completeSignup({ intentId: started.intentId, code: "123456" }),
    ).rejects.toEqual(expectAuthError("INVALID_SIGNUP"));
    expect(test.intents.get(started.intentId)?.state).toBe("pending");
  });

  it("keeps persistence failure safe when compensating revocation also fails", async () => {
    const test = harness();
    const started = await test.auth.startSignup({
      email: "failed-revocation@example.net",
      password: "password",
    });
    vi.spyOn(test.dependencies.intents, "completeSignupIntent").mockRejectedValue(
      new Error("persistent storage failure"),
    );
    test.gateway.fail("revokeSession", "providerUnavailable");

    await expect(
      test.auth.completeSignup({ intentId: started.intentId, code: "123456" }),
    ).rejects.toEqual(expectAuthError("PROVIDER_UNAVAILABLE"));
    expect(test.gateway.calls[test.gateway.calls.length - 1]).toBe("revokeSession");
    expect(test.intents.get(started.intentId)?.state).toBe("inFlight");
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

    const callsBeforeAlreadyInvalid = failure.gateway.calls.length;
    await expect(failure.auth.signOutSession({ refreshToken: "invalid" })).resolves.toEqual({ revoked: true });
    expect(failure.gateway.calls.slice(callsBeforeAlreadyInvalid)).toEqual(["refreshSession"]);
  });

  it.each([
    ["fingerprinting", (test: ReturnType<typeof harness>) => {
      test.dependencies.fingerprintEmail = () => {
        throw new Error("fingerprint failed");
      };
    }],
    ["admission persistence", (test: ReturnType<typeof harness>) => {
      vi.mocked(test.dependencies.intents.admitInitiationRequest).mockRejectedValue(
        new Error("admission persistence failed"),
      );
    }],
    ["encryption", (test: ReturnType<typeof harness>) => {
      test.dependencies.encryptPendingAuthenticationToken = () => {
        throw new Error("encryption failed");
      };
    }],
    ["delivery", (test: ReturnType<typeof harness>) => {
      test.dependencies.delivery.verification = async () => {
        throw new Error("delivery failed");
      };
    }],
    ["intent persistence", (test: ReturnType<typeof harness>) => {
      test.dependencies.intents.createSignupIntent = async () => {
        throw new Error("persistence failed");
      };
    }],
    ["cleanup", (test: ReturnType<typeof harness>) => {
      test.cleanup.mockRejectedValue(new Error("cleanup failed"));
    }],
    ["unexpected provider operation", (test: ReturnType<typeof harness>) => {
      vi.spyOn(test.gateway, "lookupUserByEmail").mockRejectedValue(
        new Error("unexpected failure"),
      );
    }],
  ] as const)("keeps signup neutral after %s failure", async (_name, configure) => {
    const test = harness();
    configure(test);

    await expect(
      test.auth.startSignup({ email: "neutral@example.net", password: "password" }),
    ).resolves.toEqual({
      accepted: true,
      intentId: "00000000-0000-4000-8000-000000000001",
    });
    expect(test.cleanup).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["fingerprinting", (test: ReturnType<typeof harness>) => {
      test.dependencies.fingerprintEmail = () => {
        throw new Error("fingerprint failed");
      };
    }],
    ["admission persistence", (test: ReturnType<typeof harness>) => {
      vi.mocked(test.dependencies.intents.admitInitiationRequest).mockRejectedValue(
        new Error("admission persistence failed"),
      );
    }],
    ["delivery", (test: ReturnType<typeof harness>) => {
      test.gateway.seed(
        { kind: "password", user: userFor("neutral-recovery@example.net") },
        "password",
      );
      test.dependencies.delivery.reset = async () => {
        throw new Error("delivery failed");
      };
    }],
    ["cleanup", (test: ReturnType<typeof harness>) => {
      test.cleanup.mockRejectedValue(new Error("cleanup failed"));
    }],
    ["unexpected provider operation", (test: ReturnType<typeof harness>) => {
      vi.spyOn(test.gateway, "lookupUserByEmail").mockRejectedValue(
        new Error("unexpected failure"),
      );
    }],
  ] as const)("keeps recovery neutral after %s failure", async (_name, configure) => {
    const test = harness();
    configure(test);

    await expect(
      test.auth.startRecovery({ email: "neutral-recovery@example.net" }),
    ).resolves.toEqual({ accepted: true });
    expect(test.cleanup).toHaveBeenCalledTimes(1);
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
