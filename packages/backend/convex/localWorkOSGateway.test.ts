import { it } from "vitest";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WorkOS } from "@workos-inc/node";
import { startProvider } from "../../local-workos/src/provider.ts";
import {
  categorizeWorkOSError,
  WorkOSGatewayError,
} from "./workosErrorPolicy.ts";
import { parseStagingVerificationRequiredChallenge } from "./workos.ts";
import type { WorkOSGatewayOperation } from "./workosGateway.ts";

it("actual SDK errors and configured client defaults satisfy existing gateway parser and categories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gateway-policy-"));
  try {
    const apiKey = `sk_test_local_${"68".repeat(32)}`;
    // Use the provider's public Promise boundary; its Effect runtime owns services.
    const provider = await startProvider({
      database: join(dir, "state.sqlite"),
      apiKey,
    });
    try {
      // Same configured client-ID default as the gateway; never invoke its remote singleton.
      const sdk = new WorkOS({
        apiKey,
        clientId: provider.clientId,
        apiHostname: "127.0.0.1",
        port: provider.port,
        https: false,
      });
      const email = "gateway@example.test",
        password = "Synthetic-password-gateway-48";
      await sdk.userManagement.createUser({ email, password });
      const rejects = (
        operation: WorkOSGatewayOperation,
        category: ReturnType<typeof categorizeWorkOSError>,
        run: () => Promise<unknown>,
      ) =>
        assert.rejects(run, (error) => {
          assert.equal(categorizeWorkOSError(operation, error), category);
          return true;
        });
      await rejects("authenticatePassword", "invalidCredentials", () =>
        sdk.userManagement.authenticateWithPassword({
          email,
          password: "wrong",
        }),
      );
      const challenge = await (async () => {
        try {
          await sdk.userManagement.authenticateWithPassword({
            email,
            password,
          });
        } catch (error) {
          assert.equal(
            categorizeWorkOSError("authenticatePassword", error),
            "verificationRequired",
          );
          const result = parseStagingVerificationRequiredChallenge(error);
          assert.ok(result);
          return result;
        }
        throw new Error("Expected challenge");
      })();
      await rejects("getEmailVerification", "invalidVerification", () =>
        sdk.userManagement.getEmailVerification("missing"),
      );
      await rejects("completeEmailVerification", "invalidVerification", () =>
        sdk.userManagement.authenticateWithEmailVerification({
          pendingAuthenticationToken: challenge.pendingAuthenticationToken,
          code: "not-a-code",
        }),
      );
      const verification = await sdk.userManagement.getEmailVerification(
        challenge.emailVerificationId,
      );
      const session =
        await sdk.userManagement.authenticateWithEmailVerification({
          pendingAuthenticationToken: challenge.pendingAuthenticationToken,
          code: verification.code,
        });
      // Gateway-owned category assertions use real SDK failures from owned SQLite fixtures.
      // Suppress retries only for the deliberately induced 500 and 429 responses.
      const noRetrySdk = new WorkOS({
        apiKey,
        clientId: provider.clientId,
        apiHostname: "127.0.0.1",
        port: provider.port,
        https: false,
        maxRetries: 0,
      });
      const db = new DatabaseSync(join(dir, "state.sqlite"));
      try {
        db.exec("PRAGMA busy_timeout = 5000");
        db.exec(
          "CREATE TRIGGER reject_replay BEFORE INSERT ON refresh_replays BEGIN SELECT RAISE(ABORT, 'synthetic-sensitive-replay'); END",
        );
        await rejects("refreshSession", "providerUnavailable", () =>
          noRetrySdk.userManagement.authenticateWithRefreshToken({
            refreshToken: session.refreshToken,
          }),
        );
        db.exec("DROP TRIGGER reject_replay");
      } finally {
        db.close();
      }
      let current = session;
      for (let i = 0; i < 256; i++) {
        current = await sdk.userManagement.authenticateWithRefreshToken({
          refreshToken: current.refreshToken,
        });
      }
      await rejects("refreshSession", "rateLimited", () =>
        noRetrySdk.userManagement.authenticateWithRefreshToken({
          refreshToken: current.refreshToken,
        }),
      );
      await rejects("createPasswordReset", "invalidReset", () =>
        sdk.userManagement.createPasswordReset({
          email: "missing@example.test",
        }),
      );
      await rejects("completePasswordReset", "invalidReset", () =>
        sdk.userManagement.resetPassword({
          token: "missing",
          newPassword: password,
        }),
      );
      await rejects("refreshSession", "invalidSession", () =>
        sdk.userManagement.authenticateWithRefreshToken({
          refreshToken: "missing",
        }),
      );
      await rejects("revokeSession", "invalidSession", () =>
        sdk.userManagement.revokeSession({ sessionId: "missing" }),
      );
      assert.throws(
        () =>
          parseStagingVerificationRequiredChallenge({
            code: "email_verification_required",
            pendingAuthenticationToken: "present",
            rawData: {},
          }),
        (error) =>
          error instanceof WorkOSGatewayError &&
          error.category === "providerUnavailable",
      );
    } finally {
      await provider.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
