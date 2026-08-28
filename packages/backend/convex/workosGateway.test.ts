import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import { parseStagingVerificationRequiredChallenge } from "./workos.ts";
import type {
  WorkOSGateway,
  WorkOSGatewaySession,
  WorkOSGatewayUser,
  WorkOSUserClassification,
} from "./workosGateway.ts";

class FakeWorkOSGateway implements WorkOSGateway {
  readonly #users = new Map<
    string,
    { classification: WorkOSUserClassification; password?: string }
  >();
  readonly #sessions = new Map<string, WorkOSGatewaySession>();
  readonly #verifications = new Map<
    string,
    { id: string; userId: string; code: string; expiresAt: string }
  >();
  readonly #resets = new Map<
    string,
    { id: string; userId: string; token: string; expiresAt: string }
  >();
  #nextFailure: "rateLimited" | "providerUnavailable" | undefined;

  failNextWith(category: "rateLimited" | "providerUnavailable") {
    this.#nextFailure = category;
  }

  seed(
    classification: Exclude<WorkOSUserClassification, { kind: "new" }>,
    password?: string,
  ) {
    this.#users.set(classification.user.email, { classification, password });
  }

  async lookupUserByEmail(email: string) {
    if (this.#nextFailure) {
      const failure = this.#nextFailure;
      this.#nextFailure = undefined;
      throw new Error(failure);
    }
    return this.#users.get(email)?.classification ?? { kind: "new" as const };
  }

  async createPasswordUser(input: { email: string; password: string }) {
    const user = userFor(input.email, false);
    this.seed({ kind: "unverifiedPassword", user }, input.password);
    return user;
  }

  async authenticatePassword(input: { email: string; password: string }) {
    const entry = this.#users.get(input.email);
    if (entry?.password !== input.password || entry.classification.kind === "new") {
      throw new Error("invalidCredentials");
    }
    if (entry.classification.kind === "unverifiedPassword") {
      return {
        kind: "verificationRequired" as const,
        emailVerificationId: `verification-${entry.classification.user.id}`,
        pendingAuthenticationToken: `pending-${entry.classification.user.id}`,
      };
    }
    return this.#newSession(entry.classification.user);
  }

  async getEmailVerification(id: string) {
    const verification = this.#verifications.get(id);
    if (!verification) throw new Error("invalidVerification");
    return verification;
  }

  async completeEmailVerification(input: { pendingAuthenticationToken: string; code: string }) {
    const userId = input.pendingAuthenticationToken.replace(/^pending-/, "");
    const entry = [...this.#users.values()].find(
      ({ classification }) =>
        classification.kind !== "new" && classification.user.id === userId,
    );
    if (!entry || input.code !== "123456" || entry.classification.kind === "new") {
      throw new Error("invalidVerification");
    }
    const user = { ...entry.classification.user, emailVerified: true };
    this.seed({ kind: "password", user }, entry.password);
    return this.#newSession(user);
  }

  createVerification(userId: string) {
    const verification = {
      id: `verification-${userId}`,
      userId,
      code: "123456",
      expiresAt: "2030-01-01T00:00:00.000Z",
    };
    this.#verifications.set(verification.id, verification);
    return verification;
  }

  async createPasswordReset(email: string) {
    const classification = await this.lookupUserByEmail(email);
    if (classification.kind === "new") throw new Error("invalidReset");
    const reset = {
      id: `reset-${classification.user.id}`,
      userId: classification.user.id,
      token: `token-${classification.user.id}`,
      expiresAt: "2030-01-01T00:00:00.000Z",
    };
    this.#resets.set(reset.id, reset);
    return reset;
  }

  async completePasswordReset(input: { token: string; newPassword: string }) {
    const reset = [...this.#resets.values()].find(({ token }) => token === input.token);
    if (!reset) throw new Error("invalidReset");
    const entry = [...this.#users.values()].find(
      ({ classification }) =>
        classification.kind !== "new" && classification.user.id === reset.userId,
    );
    if (!entry || entry.classification.kind === "new") throw new Error("invalidReset");
    const user = { ...entry.classification.user, emailVerified: true };
    this.seed({ kind: "password", user }, input.newPassword);
    return user;
  }

  async refreshSession(refreshToken: string) {
    const session = this.#sessions.get(refreshToken);
    if (!session) throw new Error("invalidSession");
    return { ...session, accessToken: `${session.accessToken}-refreshed` };
  }

  async revokeSession(sessionId: string) {
    const matching = [...this.#sessions.entries()].find(
      ([, session]) => session.sessionId === sessionId,
    );
    if (!matching) throw new Error("invalidSession");
    this.#sessions.delete(matching[0]);
  }

  async getUserById(userId: string) {
    const entry = [...this.#users.values()].find(
      ({ classification }) =>
        classification.kind !== "new" && classification.user.id === userId,
    );
    if (!entry || entry.classification.kind === "new") throw new Error("providerUnavailable");
    return entry.classification.user;
  }

  #newSession(user: WorkOSGatewayUser): WorkOSGatewaySession {
    const sequence = this.#sessions.size + 1;
    const session: WorkOSGatewaySession = {
      kind: "authenticated",
      user,
      sessionId: `session-${sequence}`,
      accessToken: `access-${sequence}`,
      refreshToken: `refresh-${sequence}`,
    };
    this.#sessions.set(session.refreshToken, session);
    return session;
  }
}

function userFor(email: string, emailVerified = true): WorkOSGatewayUser {
  return { id: `user-${email}`, email, emailVerified };
}

describe("WorkOSGateway contract", () => {
  it.each([
    ["password", true],
    ["unverifiedPassword", false],
    ["googleOnly", true],
    ["appleOnly", true],
    ["unknownRecovery", true],
  ] as const)("classifies %s users without exposing SDK objects", async (kind, verified) => {
    const gateway = new FakeWorkOSGateway();
    const user = userFor(`${kind}@example.com`, verified);
    gateway.seed({ kind, user });

    await expect(gateway.lookupUserByEmail(user.email)).resolves.toEqual({ kind, user });
  });

  it("classifies an unknown email as new", async () => {
    await expect(new FakeWorkOSGateway().lookupUserByEmail("new@example.com")).resolves.toEqual({
      kind: "new",
    });
  });

  it.each(["rateLimited", "providerUnavailable"] as const)(
    "can deterministically simulate a %s outcome",
    async (category) => {
      const gateway = new FakeWorkOSGateway();
      gateway.failNextWith(category);

      await expect(gateway.lookupUserByEmail("person@example.com")).rejects.toThrow(category);
      await expect(gateway.lookupUserByEmail("person@example.com")).resolves.toEqual({
        kind: "new",
      });
    },
  );

  it("supports password creation, verification retrieval/completion, authentication, refresh, revocation, reset, and ID lookup", async () => {
    const gateway = new FakeWorkOSGateway();
    const created = await gateway.createPasswordUser({
      email: "person@example.com",
      password: "initial-password",
    });
    const verification = gateway.createVerification(created.id);

    await expect(gateway.getEmailVerification(verification.id)).resolves.toEqual(verification);
    const challenge = await gateway.authenticatePassword({
      email: created.email,
      password: "initial-password",
    });
    expect(challenge.kind).toBe("verificationRequired");
    if (challenge.kind !== "verificationRequired") throw new Error("expected challenge");
    const session = await gateway.completeEmailVerification({
      pendingAuthenticationToken: challenge.pendingAuthenticationToken,
      code: verification.code,
    });
    const refreshed = await gateway.refreshSession(session.refreshToken);
    expect(refreshed.user).toEqual({ ...created, emailVerified: true });
    expect(refreshed.refreshToken).toBe(session.refreshToken);
    await gateway.revokeSession(refreshed.sessionId);
    await expect(gateway.refreshSession(refreshed.refreshToken)).rejects.toThrow(
      "invalidSession",
    );

    const reset = await gateway.createPasswordReset(created.email);
    await gateway.completePasswordReset({ token: reset.token, newPassword: "next-password" });
    await expect(gateway.getUserById(created.id)).resolves.toEqual({
      ...created,
      emailVerified: true,
    });
  });

  it("cannot mint application JWTs or be selected by the active auth config", async () => {
    const gateway: WorkOSGateway = new FakeWorkOSGateway();
    expect("mintApplicationJwt" in gateway).toBe(false);

    const authConfig = await readFile(new URL("./auth.config.ts", import.meta.url), "utf8");
    expect(authConfig).toMatch(/buildWorkOSAuthConfig/);
    expect(authConfig).not.toMatch(/FakeWorkOSGateway|emulat/i);
  });

  it("isolates the staging-proven verification-required compatibility response", () => {
    expect(
      parseStagingVerificationRequiredChallenge({
        code: "email_verification_required",
        pendingAuthenticationToken: "pending-secret",
        rawData: { email_verification_id: "email_verification_123" },
      }),
    ).toEqual({
      kind: "verificationRequired",
      emailVerificationId: "email_verification_123",
      pendingAuthenticationToken: "pending-secret",
    });
    expect(() =>
      parseStagingVerificationRequiredChallenge({
        code: "email_verification_required",
        pendingAuthenticationToken: "pending-secret",
        rawData: {},
      }),
    ).toThrow("providerUnavailable");
    expect(parseStagingVerificationRequiredChallenge({ code: "invalid_password" })).toBeUndefined();
  });

  it("loads without WorkOS configuration and fails closed only when invoked", async () => {
    vi.stubEnv("WORKOS_API_KEY", "");
    vi.stubEnv("WORKOS_CLIENT_ID", "");

    try {
      const { workosGateway } = await import("./workos.ts");

      await expect(workosGateway.getUserById("user_test")).rejects.toMatchObject({
        category: "providerUnavailable",
        message: "providerUnavailable",
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
