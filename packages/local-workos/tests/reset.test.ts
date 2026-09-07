import { JwksSchema } from "../src/contracts.ts";
import { layer } from "@effect/vitest";
import { Effect, FileSystem, Path, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import { NodeServices } from "@effect/platform-node";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { AuthenticationException, WorkOS } from "@workos-inc/node";
import { startProvider } from "../src/provider.ts";
import { UserSchema } from "../src/contracts.ts";
const UserJson = Schema.fromJsonString(UserSchema);
import { createLocalJWKSet, jwtVerify } from "jose";
const password = "Synthetic-password-before-48";
const replacement = "Synthetic-password-after-48";
const fixture = (passwordResetSeconds = 1800) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const { join } = yield* Path.Path;
    const dir = yield* fs
      .makeTempDirectoryScoped({ prefix: "reset-fixture-" })
      .pipe(Effect.flatMap(fs.realPath));
    const options = {
      database: join(dir, "state.sqlite"),
      apiKey: `sk_test_local_${"28".repeat(32)}`,
      lifetimes: { passwordResetSeconds },
    };
    const acquire = () =>
      Effect.acquireRelease(
        Effect.promise(() => startProvider(options)),
        (ownedProvider) => Effect.promise(() => ownedProvider.close()),
      );
    let provider = yield* acquire();
    // Only the SQL-defect fixture suppresses SDK backoff; normal fixtures retain SDK retries.
    const sdk = (maxRetries?: number) =>
      new WorkOS(options.apiKey, {
        apiHostname: "127.0.0.1",
        port: provider.port,
        https: false,
        ...(maxRetries === undefined ? {} : { maxRetries }),
      });
    const db = yield* Effect.acquireRelease(
      Effect.sync(() => new DatabaseSync(options.database)),
      (ownedDb) => Effect.sync(() => ownedDb.close()),
    );
    return {
      db,
      sdk,
      options,
      jwks: () =>
        HttpClient.get(
          `http://127.0.0.1:${provider.port}/sso/jwks/${provider.clientId}`,
        ).pipe(
          Effect.flatMap((response) => response.json),
          Effect.flatMap(Schema.decodeUnknownEffect(JwksSchema)),
        ),
      signIn: (email: string, suppliedPassword: string) =>
        sdk().userManagement.authenticateWithPassword({
          clientId: provider.clientId,
          email,
          password: suppliedPassword,
        }),
      verify: (pendingAuthenticationToken: string) =>
        sdk().userManagement.authenticateWithEmailVerification({
          clientId: provider.clientId,
          pendingAuthenticationToken,
          code: "000000",
        }),
      restart: () =>
        Effect.gen(function* () {
          yield* Effect.promise(() => provider.close());
          provider = yield* acquire();
        }),
      clear: () =>
        Effect.promise(() =>
          provider.clearData({
            operation: "clear-provider-data",
            database: options.database,
            providerGeneration: provider.providerGeneration,
            affectedDomains: ["users", "sessions", "challenges"],
          }),
        ),
    };
  });
const status = (expected: number) => (error: unknown) =>
  error instanceof Error && "status" in error && error.status === expected;
layer(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer), {
  excludeTestServices: true,
})("reset", (it) => {
  it.effect(
    "SDK reset is single-use and atomically updates credentials, verifies email, invalidates challenges and revokes sessions",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        const user = yield* Effect.promise(() =>
          f.sdk().userManagement.createUser({
            email: "reset@example.test",
            password,
            emailVerified: true,
          }),
        );
        const issued = yield* Effect.promise(() =>
          f.signIn(user.email, password),
        );
        // Owned verification-state setup only; the active session came from the real SDK.
        const saved = yield* Schema.decodeEffect(UserJson)(
          String(
            f.db.prepare("SELECT body FROM users WHERE id=?").get(user.id)!
              .body,
          ),
        );
        f.db.prepare("UPDATE users SET body=? WHERE id=?").run(
          yield* Schema.encodeEffect(UserJson)({
            ...saved,
            email_verified: false,
          }),
          user.id,
        );
        let pending = "";
        yield* Effect.promise(() =>
          assert.rejects(f.signIn(user.email, password), (error: unknown) => {
            assert.ok(error instanceof AuthenticationException);
            pending = error.pendingAuthenticationToken!;
            return true;
          }),
        );
        const other = yield* Effect.promise(() =>
          f.sdk().userManagement.createUser({
            email: "preserved@example.test",
            password,
            emailVerified: true,
          }),
        );
        yield* Effect.promise(() => f.signIn(other.email, password));
        yield* Effect.promise(() =>
          f.sdk().userManagement.createPasswordReset({ email: other.email }),
        );
        const reset = yield* Effect.promise(() =>
          f.sdk().userManagement.createPasswordReset({ email: user.email }),
        );
        assert.equal(reset.object, "password_reset");
        assert.equal(reset.userId, user.id);
        assert.equal(reset.email, user.email);
        assert.equal(
          Date.parse(reset.expiresAt) - Date.parse(reset.createdAt),
          1800000,
        );
        assert.ok(reset.passwordResetToken.length >= 32);
        assert.equal(typeof reset.passwordResetUrl, "string");
        assert.equal(
          Buffer.from(
            yield* (yield* FileSystem.FileSystem).readFile(f.options.database),
          ).includes(Buffer.from(reset.passwordResetToken)),
          false,
        );
        yield* Effect.promise(() =>
          assert.rejects(f.verify(reset.passwordResetToken), status(400)),
        );
        const second = yield* Effect.promise(() =>
          f.sdk().userManagement.createPasswordReset({ email: user.email }),
        );
        yield* f.restart();
        yield* Effect.promise(() =>
          assert.rejects(
            f.sdk().userManagement.resetPassword({
              token: pending,
              newPassword: replacement,
            }),
            status(400),
          ),
        );
        const results = yield* Effect.promise(() =>
          Promise.allSettled(
            [1, 2].map(() =>
              f.sdk().userManagement.resetPassword({
                token: reset.passwordResetToken,
                newPassword: replacement,
              }),
            ),
          ),
        );
        assert.equal(
          results.filter((result) => result.status === "fulfilled").length,
          1,
        );
        const success = results.find(
          (result) => result.status === "fulfilled",
        )!;
        assert.ok(success.status === "fulfilled");
        assert.equal(success.value.user.emailVerified, true);
        assert.equal(success.value.user.id, user.id);
        assert.equal(
          f.db
            .prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id=?")
            .get(user.id)?.n,
          0,
        );
        const keys = createLocalJWKSet({ keys: [...(yield* f.jwks()).keys] });
        assert.equal(
          (yield* Effect.promise(() => jwtVerify(issued.accessToken, keys)))
            .payload.sub,
          user.id,
        );
        assert.equal(
          f.db
            .prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id=?")
            .get(other.id)?.n,
          1,
        );
        assert.equal(
          f.db
            .prepare("SELECT COUNT(*) AS n FROM challenges WHERE user_id=?")
            .get(user.id)?.n,
          0,
        );
        assert.equal(
          f.db
            .prepare("SELECT COUNT(*) AS n FROM challenges WHERE user_id=?")
            .get(other.id)?.n,
          1,
        );
        yield* Effect.promise(() =>
          assert.rejects(
            f.sdk().userManagement.resetPassword({
              token: second.passwordResetToken,
              newPassword: password,
            }),
            status(400),
          ),
        );
        yield* Effect.promise(() =>
          assert.rejects(f.signIn(user.email, password), status(400)),
        );
        assert.equal(
          (yield* Effect.promise(() => f.signIn(user.email, replacement))).user
            .id,
          user.id,
        );
      }),
  );
  it.effect(
    "reset policy, unknown email and SQL rollback preserve usable credentials without leaking defects",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture();
        yield* Effect.promise(() =>
          assert.rejects(
            f.sdk().userManagement.createPasswordReset({
              email: "absent@example.test",
            }),
            status(404),
          ),
        );
        const user = yield* Effect.promise(() =>
          f.sdk().userManagement.createUser({
            email: "rollback@example.test",
            password,
            emailVerified: true,
          }),
        );
        yield* Effect.promise(() => f.signIn(user.email, password));
        const before = yield* Schema.decodeEffect(UserJson)(
          String(
            f.db.prepare("SELECT body FROM users WHERE id=?").get(user.id)!
              .body,
          ),
        );
        f.db.prepare("UPDATE users SET body=? WHERE id=?").run(
          yield* Schema.encodeEffect(UserJson)({
            ...before,
            email_verified: false,
          }),
          user.id,
        );
        const reset = yield* Effect.promise(() =>
          f.sdk().userManagement.createPasswordReset({ email: user.email }),
        );
        yield* Effect.promise(() =>
          assert.rejects(
            f.sdk().userManagement.resetPassword({
              token: reset.passwordResetToken,
              newPassword: "short",
            }),
            status(422),
          ),
        );
        f.db.exec(
          "CREATE TRIGGER reject_revoke BEFORE DELETE ON challenges BEGIN SELECT RAISE(ABORT, 'synthetic-sensitive-storage'); END",
        );
        yield* Effect.promise(() =>
          assert.rejects(
            f.sdk(0).userManagement.resetPassword({
              token: reset.passwordResetToken,
              newPassword: replacement,
            }),
            (error: unknown) => {
              assert.ok(error instanceof Error);
              assert.ok(!error.message.includes("synthetic-sensitive-storage"));
              return status(500)(error);
            },
          ),
        );
        assert.equal(
          f.db
            .prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id=?")
            .get(user.id)?.n,
          1,
        );
        assert.equal(
          (yield* Effect.promise(() => f.sdk().userManagement.getUser(user.id)))
            .emailVerified,
          false,
        );
        yield* Effect.promise(() =>
          assert.rejects(
            f.signIn(user.email, password),
            (error: unknown) => error instanceof AuthenticationException,
          ),
        );
        f.db.exec("DROP TRIGGER reject_revoke");
        assert.equal(
          (yield* Effect.promise(() =>
            f.sdk().userManagement.resetPassword({
              token: reset.passwordResetToken,
              newPassword: replacement,
            }),
          )).user.id,
          user.id,
        );
        yield* Effect.promise(() =>
          f.sdk().userManagement.createPasswordReset({ email: user.email }),
        );
        yield* f.clear();
        assert.equal(
          f.db.prepare("SELECT COUNT(*) AS n FROM password_resets").get()?.n,
          0,
        );
      }),
  );
  it.effect(
    "supported one-second reset lifetime expires after real elapsed time and restart",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture(1);
        yield* Effect.promise(() =>
          f.sdk().userManagement.createUser({
            email: "elapsed@example.test",
            password,
          }),
        );
        const reset = yield* Effect.promise(() =>
          f.sdk().userManagement.createPasswordReset({
            email: "elapsed@example.test",
          }),
        );
        assert.equal(
          Date.parse(reset.expiresAt) - Date.parse(reset.createdAt),
          1000,
        );
        const started = performance.now();
        yield* Effect.sleep(1150);
        assert.ok(performance.now() - started >= 1100);
        yield* f.restart();
        yield* Effect.promise(() =>
          assert.rejects(
            f.sdk().userManagement.resetPassword({
              token: reset.passwordResetToken,
              newPassword: replacement,
            }),
            status(400),
          ),
        );
        // Real shortened expiry, not elapsed proof of the default thirty minutes.
      }),
  );
});
