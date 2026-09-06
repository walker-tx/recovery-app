import { it } from "@effect/vitest";
import { Effect } from "effect";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkOS } from "@workos-inc/node";
import { startProvider } from "../src/provider.ts";
import { categorizeWorkOSError, WorkOSGatewayError } from "../../backend/convex/workosErrorPolicy.ts";
import { parseStagingVerificationRequiredChallenge } from "../../backend/convex/workos.ts";
import type { WorkOSGatewayOperation } from "../../backend/convex/workosGateway.ts";

it.live("actual SDK errors and configured client defaults satisfy existing gateway parser and categories", () => Effect.gen(function* () {
  const dir = yield* Effect.acquireRelease(Effect.promise(() => mkdtemp(join(tmpdir(), "gateway-policy-"))), dir => Effect.promise(() => rm(dir, { recursive: true, force: true })));
  const apiKey = `sk_test_local_${"68".repeat(32)}`;
  const provider = yield* Effect.acquireRelease(Effect.promise(() => startProvider({ database: join(dir, "state.sqlite"), apiKey })), p => Effect.promise(() => p.close()));
  // Same configured client-ID default as the gateway; never invoke its remote singleton.
  const sdk = new WorkOS({ apiKey, clientId: provider.clientId, apiHostname: "127.0.0.1", port: provider.port, https: false });
  const email = "gateway@example.test", password = "Synthetic-password-gateway-48";
  yield* Effect.promise(() => sdk.userManagement.createUser({ email, password }));
  const rejects = (operation: WorkOSGatewayOperation, category: ReturnType<typeof categorizeWorkOSError>, run: () => Promise<unknown>) => Effect.promise(() => assert.rejects(run, error => { assert.equal(categorizeWorkOSError(operation, error), category); return true; }));
  yield* rejects("authenticatePassword", "invalidCredentials", () => sdk.userManagement.authenticateWithPassword({ email, password: "wrong" }));
  const challenge = yield* Effect.promise(async () => {
    try { await sdk.userManagement.authenticateWithPassword({ email, password }); }
    catch (error) {
      assert.equal(categorizeWorkOSError("authenticatePassword", error), "verificationRequired");
      const result = parseStagingVerificationRequiredChallenge(error);
      assert.ok(result); return result;
    }
    throw new Error("Expected challenge");
  });
  yield* rejects("getEmailVerification", "invalidVerification", () => sdk.userManagement.getEmailVerification("missing"));
  yield* rejects("completeEmailVerification", "invalidVerification", () => sdk.userManagement.authenticateWithEmailVerification({ pendingAuthenticationToken: challenge.pendingAuthenticationToken, code: "not-a-code" }));
  const verification = yield* Effect.promise(() => sdk.userManagement.getEmailVerification(challenge.emailVerificationId));
  const session = yield* Effect.promise(() => sdk.userManagement.authenticateWithEmailVerification({ pendingAuthenticationToken: challenge.pendingAuthenticationToken, code: verification.code }));
  yield* Effect.promise(() => sdk.userManagement.authenticateWithRefreshToken({ refreshToken: session.refreshToken }));
  yield* rejects("createPasswordReset", "invalidReset", () => sdk.userManagement.createPasswordReset({ email: "missing@example.test" }));
  yield* rejects("completePasswordReset", "invalidReset", () => sdk.userManagement.resetPassword({ token: "missing", newPassword: password }));
  yield* rejects("refreshSession", "invalidSession", () => sdk.userManagement.authenticateWithRefreshToken({ refreshToken: "missing" }));
  yield* rejects("revokeSession", "invalidSession", () => sdk.userManagement.revokeSession({ sessionId: "missing" }));
  assert.throws(() => parseStagingVerificationRequiredChallenge({ code: "email_verification_required", pendingAuthenticationToken: "present", rawData: {} }), error => error instanceof WorkOSGatewayError && error.category === "providerUnavailable");
}));
