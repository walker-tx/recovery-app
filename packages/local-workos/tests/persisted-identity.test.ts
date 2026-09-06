import assert from "node:assert/strict";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { exportJWK, generateKeyPair } from "jose";
import { WorkOS } from "@workos-inc/node";
import { startProvider } from "../src/provider.ts";
const directory = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "persisted-identity-"))),
  (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
);
it.live("rejects malformed stored identities without replacing state", () =>
  Effect.gen(function* () {
    const dir = yield* directory;
    const blocker = yield* Effect.acquireRelease(
      Effect.promise(
        () =>
          new Promise<ReturnType<typeof createServer>>((resolve) => {
            const server = createServer();
            server.listen(0, "127.0.0.1", () => resolve(server));
          }),
      ),
      (server) =>
        Effect.promise(
          () =>
            new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            ),
        ),
    );
    const address = blocker.address();
    assert.ok(address && typeof address !== "string");
    yield* Effect.promise(async () => {
      const pair = await generateKeyPair("RS256", { extractable: true });
      const other = await generateKeyPair("RS256", { extractable: true });
      const identity = {
        generation: randomUUID(),
        privateKey: await exportJWK(pair.privateKey),
        publicKey: await exportJWK(pair.publicKey),
      };
      const invalid = [
        ...[
          "-".repeat(36),
          "a".repeat(36),
          "550e8400-e29b-11d4-a716-446655440000",
          "550e8400-e29b-41d4-7716-446655440000",
          "550E8400-E29B-41D4-A716-446655440000",
        ].map((generation) => ({ ...identity, generation })),
        { ...identity, publicKey: await exportJWK(other.publicKey) },
        { ...identity, publicKey: { ...identity.publicKey, e: "Aw" } },
        {
          ...identity,
          privateKey: { ...identity.privateKey, n: "AA" },
          publicKey: { ...identity.publicKey, n: "AA" },
        },
        { ...identity, publicKey: identity.privateKey },
        { ...identity, privateKey: identity.publicKey },
        null,
        "malformed-json",
      ];
      for (const [index, body] of invalid.entries()) {
        const database = join(dir, `${index}.sqlite`);
        const db = new DatabaseSync(database);
        await chmod(database, 0o600);
        try {
          db.exec(
            "CREATE TABLE instance (id INTEGER PRIMARY KEY, body TEXT NOT NULL)",
          );
          const saved = body === "malformed-json" ? "{" : JSON.stringify(body);
          db.prepare("INSERT INTO instance VALUES(1,?)").run(saved);
          await assert.rejects(
            async () => {
              const unexpected = await startProvider({
                database,
                apiKey: "sk_test_synthetic",
                port: address.port,
              });
              await unexpected.close();
            },
            { message: "Invalid persisted signing identity" },
          );
          assert.equal(
            db.prepare("SELECT body FROM instance").get()?.body,
            saved,
          );
        } finally {
          db.close();
        }
      }
    });
  }),
);
it.live(
  "fixture conflicts with fixtures and SDK users are sanitized and never deduplicated",
  () =>
    Effect.gen(function* () {
      const dir = yield* directory;
      const options = {
        database: join(dir, "state.sqlite"),
        apiKey: "sk_test_synthetic",
      };
      const provider = yield* Effect.acquireRelease(
        Effect.promise(() => startProvider(options)),
        (p) => Effect.promise(() => p.close()),
      );
      const sdk = new WorkOS(options.apiKey, {
        apiHostname: "127.0.0.1",
        port: provider.port,
        https: false,
      });
      provider.createIdentityFixture({
        email: "fixture@example.test",
        provider: "GoogleOAuth",
      });
      yield* Effect.promise(() =>
        sdk.userManagement.createUser({
          email: "sdk@example.test",
          password: "Synthetic-password-42",
        }),
      );
      for (const email of [" FIXTURE@example.test ", "sdk@example.test"]) {
        assert.throws(
          () =>
            provider.createIdentityFixture({ email, provider: "AppleOAuth" }),
          (error) => {
            assert.ok(error instanceof Error);
            assert.equal(error.message, "Unable to create identity fixture");
            assert.deepEqual(Object.keys(error), []);
            assert.equal(error.cause, undefined);
            return true;
          },
        );
      }
      const users = yield* Effect.promise(() => sdk.userManagement.listUsers());
      assert.equal(users.data.length, 2);
      // A competing writer can fail after any precheck: sanitize the write itself.
      const competing = new DatabaseSync(options.database);
      try {
        competing.exec("BEGIN IMMEDIATE");
        assert.throws(
          () =>
            provider.createIdentityFixture({
              email: "new-subject@example.test",
              provider: "GoogleOAuth",
            }),
          (error) => {
            assert.ok(error instanceof Error);
            assert.equal(error.message, "Unable to create identity fixture");
            assert.deepEqual(Object.keys(error), []);
            assert.equal(error.cause, undefined);
            return true;
          },
        );
      } finally {
        competing.close();
      }
    }),
);
it.live(
  "generated signing identity is unchanged on restart and publishes only public fields",
  () =>
    Effect.gen(function* () {
      const dir = yield* directory;
      const options = {
        database: join(dir, "state.sqlite"),
        apiKey: "sk_test_synthetic",
      };
      const first = yield* Effect.acquireRelease(
        Effect.promise(() => startProvider(options)),
        (p) => Effect.promise(() => p.close()),
      );
      yield* Effect.promise(() => first.close());
      const db = yield* Effect.acquireRelease(
        Effect.sync(() => new DatabaseSync(options.database)),
        (db) => Effect.sync(() => db.close()),
      );
      const saved = db.prepare("SELECT body FROM instance").get()?.body;
      assert.equal(typeof saved, "string");
      const identity = JSON.parse(saved as string);
      const second = yield* Effect.acquireRelease(
        Effect.promise(() => startProvider(options)),
        (p) => Effect.promise(() => p.close()),
      );
      assert.equal(second.providerGeneration, first.providerGeneration);
      assert.equal(db.prepare("SELECT body FROM instance").get()?.body, saved);
      const jwks = yield* Effect.promise(async () =>
        (
          await fetch(
            `http://127.0.0.1:${second.port}/sso/jwks/${second.clientId}`,
          )
        ).json(),
      );
      assert.deepEqual(jwks, {
        keys: [
          {
            kty: "RSA",
            n: identity.publicKey.n,
            e: identity.publicKey.e,
            kid: first.providerGeneration,
            alg: "RS256",
            use: "sig",
          },
        ],
      });
    }),
);
