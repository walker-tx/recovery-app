import { it } from "@effect/vitest";
import { Effect } from "effect";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AuthenticationException, WorkOS } from "@workos-inc/node";
import { createLocalJWKSet, decodeJwt, jwtVerify } from "jose";
import { startProvider } from "../src/provider.ts";
import { digest } from "../src/contracts.ts";

const fixture = (lifetimes = { accessTokenSeconds: 300, sessionSeconds: 604800, verificationSeconds: 600 }) => Effect.gen(function* () {
  const dir = yield* Effect.acquireRelease(Effect.promise(() => mkdtemp(join(tmpdir(), "verification-consumption-"))), dir => Effect.promise(() => rm(dir, { recursive: true, force: true })));
  const options = { database: join(dir, "state.sqlite"), apiKey: `sk_test_local_${"18".repeat(32)}`, lifetimes };
  const acquire = () => Effect.acquireRelease(Effect.promise(() => startProvider(options)), provider => Effect.promise(() => provider.close()));
  let provider = yield* acquire();
  const sdk = (maxRetries?: number) => new WorkOS(options.apiKey, { apiHostname: "127.0.0.1", port: provider.port, https: false, maxRetries });
  const db = yield* Effect.acquireRelease(Effect.sync(() => new DatabaseSync(options.database)), db => Effect.sync(() => db.close()));
  const challenge = (email: string) => Effect.promise(async () => {
    await sdk().userManagement.createUser({ email, password: "Synthetic-password-48" });
    try { await sdk().userManagement.authenticateWithPassword({ clientId: provider.clientId, email, password: "Synthetic-password-48" }); }
    catch (error) {
      assert.ok(error instanceof AuthenticationException);
      const verification = await sdk().userManagement.getEmailVerification(error.rawData.email_verification_id as string);
      return { pending: error.pendingAuthenticationToken!, verification };
    }
    throw new Error("Expected verification challenge");
  });
  const verify = (pending: string, code: string, clientId: string = provider.clientId, maxRetries?: number) => sdk(maxRetries).userManagement.authenticateWithEmailVerification({ clientId, pendingAuthenticationToken: pending, code });
  const jwks = () => Effect.promise(async () => (await fetch(`http://127.0.0.1:${provider.port}/sso/jwks/${provider.clientId}`)).json());
  return { db, sdk, challenge, verify, jwks, restart: () => Effect.gen(function* () { yield* Effect.promise(() => provider.close()); provider = yield* acquire(); }) };
});
const invalid = (error: unknown) => error instanceof Error && "error" in error && error.error === "invalid_grant";

it.live("verification is atomic single-use, user-bound and purpose-bound", () => Effect.gen(function* () {
  const f = yield* fixture();
  const a = yield* f.challenge("one@example.test");
  const b = yield* f.challenge("two@example.test");
  // A challenge lacking the verification-purpose detail must not be a verification grant.
  f.db.prepare("INSERT INTO challenges VALUES(?,?,?,?)").run("other-purpose", b.verification.userId, digest("synthetic-other-purpose"), Date.now() + 60000);
  yield* Effect.promise(() => assert.rejects(f.verify("synthetic-other-purpose", b.verification.code), invalid));
  const savedBody = String(f.db.prepare("SELECT body FROM email_verifications WHERE challenge_id=?").get(a.verification.id)!.body);
  f.db.prepare("UPDATE email_verifications SET body=? WHERE challenge_id=?").run(JSON.stringify({ ...JSON.parse(savedBody), user_id: b.verification.userId }), a.verification.id);
  yield* Effect.promise(() => assert.rejects(f.verify(a.pending, a.verification.code), invalid));
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM sessions").get()?.n, 0);
  assert.equal((yield* Effect.promise(() => f.sdk().userManagement.getUser(a.verification.userId))).emailVerified, false);
  f.db.prepare("UPDATE email_verifications SET body=? WHERE challenge_id=?").run(savedBody, a.verification.id);
  const results = yield* Effect.promise(() => Promise.allSettled([f.verify(a.pending, a.verification.code), f.verify(a.pending, a.verification.code)]));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const success = results.find(r => r.status === "fulfilled")!;
  assert.ok(success.status === "fulfilled");
  assert.equal(success.value.user.id, a.verification.userId);
  assert.equal(success.value.user.emailVerified, true);
  assert.equal(decodeJwt(success.value.accessToken).sub, a.verification.userId);
  assert.equal((yield* Effect.promise(() => f.sdk().userManagement.getUser(b.verification.userId))).emailVerified, false);
  const failure = results.find(r => r.status === "rejected")!;
  assert.ok(failure.status === "rejected" && invalid(failure.reason));
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM sessions").get()?.n, 1);
  yield* f.restart();
  yield* Effect.promise(() => assert.rejects(f.verify(a.pending, a.verification.code), invalid));
}));

it.live("five failed verification attempts persist across restart and concurrent retries", () => Effect.gen(function* () {
  const f = yield* fixture();
  const a = yield* f.challenge("attempts@example.test");
  const wrong = a.verification.code === "000000" ? "000001" : "000000";
  // Client guard must not spend an attempt.
  yield* Effect.promise(() => assert.rejects(f.verify(a.pending, wrong, "wrong-client")));
  for (let i = 0; i < 4; i++) yield* Effect.promise(() => assert.rejects(f.verify(a.pending, wrong), invalid));
  yield* f.restart();
  const session = yield* Effect.promise(() => f.verify(a.pending, a.verification.code));
  assert.equal(session.user.emailVerified, true);
  const b = yield* f.challenge("locked@example.test");
  const wrongB = b.verification.code === "000000" ? "000001" : "000000";
  yield* Effect.promise(() => Promise.all(Array.from({ length: 5 }, () => assert.rejects(f.verify(b.pending, wrongB), invalid))));
  yield* f.restart();
  yield* Effect.promise(() => assert.rejects(f.verify(b.pending, b.verification.code), invalid));
  assert.equal((yield* Effect.promise(() => f.sdk().userManagement.getUser(b.verification.userId))).emailVerified, false);
  const c = yield* f.challenge("partial-attempts@example.test");
  const wrongC = c.verification.code === "000000" ? "000001" : "000000";
  for (let i = 0; i < 4; i++) yield* Effect.promise(() => assert.rejects(f.verify(c.pending, wrongC), invalid));
  assert.equal(f.db.prepare("SELECT failed_attempts FROM email_verifications WHERE challenge_id=?").get(c.verification.id)?.failed_attempts, 4);
  yield* f.restart();
  yield* Effect.promise(() => assert.rejects(f.verify(c.pending, wrongC), invalid));
  yield* Effect.promise(() => assert.rejects(f.verify(c.pending, c.verification.code), invalid));
}));

it.live("session insertion defects roll back verification and consumption without exposing storage errors", () => Effect.gen(function* () {
  const f = yield* fixture();
  const a = yield* f.challenge("rollback@example.test");
  f.db.exec("CREATE TRIGGER reject_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'synthetic-sensitive-storage'); END");
  yield* Effect.promise(() => assert.rejects(f.verify(a.pending, a.verification.code, undefined, 0), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!error.message.includes("synthetic-sensitive-storage"));
    return "status" in error && error.status === 500;
  }));
  assert.equal((yield* Effect.promise(() => f.sdk().userManagement.getUser(a.verification.userId))).emailVerified, false);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM sessions").get()?.n, 0);
  assert.equal((yield* Effect.promise(() => f.sdk().userManagement.getEmailVerification(a.verification.id))).id, a.verification.id);
  f.db.exec("DROP TRIGGER reject_session");
  assert.equal((yield* Effect.promise(() => f.verify(a.pending, a.verification.code))).user.emailVerified, true);
}));

it.live("supported one-second verification and token lifetimes expire with real elapsed time", () => Effect.gen(function* () {
  const f = yield* fixture({ verificationSeconds: 1, accessTokenSeconds: 1, sessionSeconds: 2 });
  const a = yield* f.challenge("elapsed-success@example.test");
  assert.equal(Date.parse(a.verification.expiresAt) - Date.parse(a.verification.createdAt), 1000);
  const session = yield* Effect.promise(() => f.verify(a.pending, a.verification.code));
  const token = decodeJwt(session.accessToken);
  assert.equal(token.exp! - token.iat!, 1);
  const row = f.db.prepare("SELECT expires_at FROM sessions WHERE id=?").get(token.sid as string)!;
  assert.ok(token.exp! * 1000 <= Number(row.expires_at));
  const b = yield* f.challenge("elapsed-expired@example.test");
  const started = performance.now();
  yield* Effect.sleep(1150);
  assert.ok(performance.now() - started >= 1100);
  yield* f.restart();
  yield* Effect.promise(() => assert.rejects(f.verify(b.pending, b.verification.code), invalid));
  yield* Effect.promise(() => assert.rejects(f.sdk().userManagement.getEmailVerification(b.verification.id)));
  assert.ok(Date.now() / 1000 >= token.exp!);
  const keys = createLocalJWKSet(yield* f.jwks());
  yield* Effect.promise(() => assert.rejects(jwtVerify(session.accessToken, keys), (error: unknown) => error instanceof Error && "code" in error && error.code === "ERR_JWT_EXPIRED"));
  // Actual shortened lifetime proof, not ten-minute/default lifetime coverage.
}));
