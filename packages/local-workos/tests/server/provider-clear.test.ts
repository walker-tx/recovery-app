import { layer } from "@effect/vitest";
import { Effect, Exit, Cause, FileSystem, Path, Schema, Layer } from "effect";
import { NodeServices, NodeHttpClient } from "@effect/platform-node";
import { HttpClient } from "effect/unstable/http";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { WorkOS } from "@workos-inc/node";
import { createLocalJWKSet, jwtVerify } from "jose";
import {
  acquireProvider,
  ProviderClearError,
} from "../../src/server/provider.ts";
const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs
    .makeTempDirectoryScoped({ prefix: "provider-clear-" })
    .pipe(Effect.flatMap(fs.realPath));
  const database = path.join(dir, "provider.sqlite");
  const provider = yield* acquireProvider({
    database,
    apiKey: `sk_test_local_${"ab".repeat(32)}`,
  });
  const user = yield* provider.createIdentityFixture({
    email: "owned@example.test",
    provider: "GoogleOAuth",
  });
  // This direct SQL adapter is exclusively for the synthetic disposable fixture.
  const db = yield* Effect.acquireRelease(
    Effect.sync(() => new DatabaseSync(database)),
    (connection) => Effect.sync(() => connection.close()),
  );
  db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
    "session_fixture",
    user.id,
    "synthetic",
    123,
  );
  db.prepare("INSERT INTO challenges VALUES(?,?,?,?)").run(
    "challenge_fixture",
    user.id,
    "synthetic",
    123,
  );
  db.exec(
    "CREATE TABLE unrelated_fixture(value TEXT); INSERT INTO unrelated_fixture VALUES('preserve')",
  );
  const confirmation = {
    operation: "clear-provider-data",
    database,
    providerGeneration: provider.providerGeneration,
    affectedDomains: ["users", "sessions", "challenges"],
  };
  const counts = () =>
    ["users", "sessions", "challenges"].map(
      (table) => db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n,
    );
  const identityHash = () =>
    createHash("sha256")
      .update(String(db.prepare("SELECT body FROM instance").get()?.body))
      .digest("hex");
  return { provider, db, confirmation, counts, identityHash, user, fs };
});
layer(Layer.merge(NodeServices.layer, NodeHttpClient.layerUndici), {
  excludeTestServices: true,
})("provider clear", (it) => {
  it.effect(
    "local provider clear atomically removes auth data, preserves identity and never reuses subjects",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        const before = f.identityHash();
        const result = yield* f.provider.clearData(f.confirmation);
        assert.equal(result.operation, "clear-provider-data");
        assert.deepEqual(f.counts(), [0, 0, 0]);
        assert.equal(f.identityHash(), before);
        yield* f.provider.clearData(f.confirmation);
        assert.deepEqual(f.counts(), [0, 0, 0]);
        assert.equal(
          f.db.prepare("SELECT value FROM unrelated_fixture").get()?.value,
          "preserve",
        );
        const replacement = yield* f.provider.createIdentityFixture({
          email: f.user.email,
          provider: "GoogleOAuth",
        });
        assert.notEqual(replacement.id, f.user.id);
        assert.equal(result.issuedAccessTokens, "valid-until-expiry");
      }),
  );
  it.effect(
    "clear rejects missing domains, foreign identity and changed persisted signing identity",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        for (const confirmation of [
          undefined,
          { ...f.confirmation, operation: "destroy-provider" },
          {
            ...f.confirmation,
            affectedDomains: ["users", "users", "challenges"],
          },
          { ...f.confirmation, affectedDomains: ["users"] },
          { ...f.confirmation, providerGeneration: randomUUID() },
          { ...f.confirmation, database: "/foreign/provider.sqlite" },
        ]) {
          const exit = yield* Effect.exit(f.provider.clearData(confirmation));
          assert.ok(Exit.isFailure(exit));
          if (Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause);
            assert.ok(error instanceof ProviderClearError);
            assert.equal(error.reason, "confirmation");
          }
          assert.deepEqual(f.counts(), [1, 1, 1]);
        }
        f.db.prepare("UPDATE instance SET body=?").run("{}");
        const exit = yield* Effect.exit(f.provider.clearData(f.confirmation));
        assert.ok(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause);
          assert.ok(error instanceof ProviderClearError);
          assert.equal(error.reason, "identity");
        }
        assert.deepEqual(f.counts(), [1, 1, 1]);
      }),
  );
  it.effect(
    "SQL failure rolls back every cleared domain and exposes only tagged sanitized failure",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        f.db.exec(
          "CREATE TRIGGER reject_clear BEFORE DELETE ON users BEGIN SELECT RAISE(ABORT, 'synthetic-sensitive'); END",
        );
        const exit = yield* Effect.exit(f.provider.clearData(f.confirmation));
        assert.ok(Exit.isFailure(exit));
        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause);
          assert.ok(error instanceof ProviderClearError);
          assert.ok(!String(error).includes("synthetic-sensitive"));
        }
        assert.deepEqual(f.counts(), [1, 1, 1]);
      }),
  );

  it.effect(
    "clear preserves SDK access, signing/JWKS and already-issued JWT validity",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        const sdk = new WorkOS(`sk_test_local_${"ab".repeat(32)}`, {
          apiHostname: "127.0.0.1",
          port: f.provider.port,
          https: false,
        });
        const user = yield* Effect.promise(() =>
          sdk.userManagement.createUser({
            email: "password@example.test",
            password: "Synthetic-password-42",
            emailVerified: true,
          }),
        );
        const session = yield* Effect.promise(() =>
          sdk.userManagement.authenticateWithPassword({
            clientId: f.provider.clientId,
            email: user.email,
            password: "Synthetic-password-42",
          }),
        );
        const jwks = () =>
          HttpClient.get(
            `http://127.0.0.1:${f.provider.port}/sso/jwks/${f.provider.clientId}`,
          ).pipe(
            Effect.flatMap((response) => response.json),
            Effect.flatMap(
              Schema.decodeUnknownEffect(
                Schema.Struct({
                  keys: Schema.Array(
                    Schema.Record(Schema.String, Schema.Unknown),
                  ),
                }),
              ),
            ),
          );
        const before = yield* jwks();
        yield* f.provider.clearData(f.confirmation);
        assert.deepEqual(yield* jwks(), before);
        const verified = yield* Effect.promise(() =>
          jwtVerify(
            session.accessToken,
            createLocalJWKSet({ keys: [...before.keys] }),
            {
              issuer: f.provider.issuer,
              audience: f.provider.clientId,
            },
          ),
        );
        assert.equal(verified.payload.sub, user.id);
        const remaining = yield* Effect.promise(() =>
          sdk.userManagement.listUsers(),
        );
        assert.deepEqual(remaining.data, []);
      }),
  );
  it.effect(
    "clear rejects replacement database path even with identical persisted contents",
    () =>
      Effect.gen(function* () {
        const f = yield* fixture;
        const database = f.confirmation.database;
        yield* f.fs.rename(database, database + ".owned");
        yield* f.fs.copyFile(database + ".owned", database);
        const exit = yield* Effect.exit(f.provider.clearData(f.confirmation));
        assert.ok(Exit.isFailure(exit));
        assert.deepEqual(f.counts(), [1, 1, 1]);
      }),
  );
});
