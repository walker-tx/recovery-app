import { layer } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema, Option } from "effect";
import { NodeServices } from "@effect/platform-node";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { WorkOS } from "@workos-inc/node";
import { acquireProvider } from "../../src/server/provider.ts";
const require = createRequire(import.meta.url);
const { createRegistry } = require("../../../../scripts/stack-registry.cjs");
const { createLifecycle } = require("../../../../scripts/stack-lifecycle.cjs");
// Narrow compile-time views of the existing untyped CJS test boundary, not a new wire schema.
type Reservation = {
  stackId: string;
  providerGeneration: string;
  ports: { provider: number };
};
type Destruction = {
  state: string;
  retirement: string;
  storage: Record<string, string>;
  trustRepairRequired: boolean;
};
const apiKey = `sk_test_local_${"ac".repeat(32)}`;

layer(NodeServices.layer, { excludeTestServices: true })(
  "provider destruction",
  (it) => {
    it.effect(
      "destroys real stopped provider SQL/signing storage, refuses old-stack startup, preserves sibling and other domains",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const { join } = yield* Path.Path;
          const dir = yield* fs
            .makeTempDirectoryScoped({
              prefix: "provider-destruction-integration-",
            })
            .pipe(Effect.flatMap(fs.realPath));
          const worktree = join(dir, "selected"),
            sibling = join(dir, "sibling");
          yield* fs.makeDirectory(worktree, { mode: 0o700 });
          yield* fs.makeDirectory(sibling, { mode: 0o700 });
          // Real port observation. No process adapter invents a stopped/live process identity.
          const registry = createRegistry({
            registryPath: join(dir, "registry"),
            inspectProcess: () => Promise.resolve(null),
          });
          const record = yield* Effect.promise<Reservation>(() =>
            registry.reserve(worktree),
          );
          const other = yield* Effect.promise<Reservation>(() =>
            registry.reserve(sibling),
          );
          const root = join(worktree, ".recovery-stack"),
            providerDir = join(root, "provider");
          const database = join(providerDir, "state.sqlite");
          const confirmation = {
            operation: "destroy-provider-identity",
            worktree,
            stackId: record.stackId,
            providerGeneration: record.providerGeneration,
            affectedDomains: ["provider-data", "provider-signing-identity"],
          };
          yield* fs.makeDirectory(providerDir, {
            recursive: true,
            mode: 0o700,
          });
          const marker = yield* Schema.encodeEffect(
            Schema.fromJsonString(
              Schema.Struct({
                stackId: Schema.String,
                providerGeneration: Schema.String,
              }),
            ),
          )({
            stackId: record.stackId,
            providerGeneration: record.providerGeneration,
          });
          for (const target of [root, providerDir]) {
            yield* fs.writeFileString(
              join(target, ".recovery-stack-owner.json"),
              marker,
              { mode: 0o600 },
            );
          }
          const preserved = [
            join(root, "mailpit.sqlite"),
            join(worktree, "convex-fixture.sqlite"),
            join(root, "synthetic-admin-seed"),
            join(dir, "synthetic-device-state"),
          ];
          for (const file of preserved) {
            yield* fs.writeFileString(file, "owned-preserved-fixture", {
              mode: 0o600,
            });
          }
          const snapshots = yield* Effect.forEach(preserved, (file) =>
            Effect.gen(function* () {
              return {
                file,
                bytes: yield* fs.readFile(file),
                inode: Option.getOrThrow((yield* fs.stat(file)).ino),
              };
            }),
          );
          const siblingProvider = yield* acquireProvider({
            database: join(sibling, "state.sqlite"),
            port: other.ports.provider,
            apiKey,
            providerGeneration: other.providerGeneration,
          });
          const siblingUser = yield* siblingProvider.createIdentityFixture({
            email: "sibling@example.test",
            provider: "GoogleOAuth",
          });
          const siblingSdk = new WorkOS(apiKey, {
            apiHostname: "127.0.0.1",
            port: siblingProvider.port,
            https: false,
          });
          let prepared = false,
            commands = 0;
          const lifecycle = createLifecycle({
            registry,
            run: () => {
              commands++;
              return Promise.resolve();
            },
            identify: () => Promise.resolve(null),
            ready: () => Promise.resolve(true),
            prepare: () => {
              prepared = true;
              return Promise.resolve();
            },
          });
          // Closing this nested acquisition scope closes the actual HTTP listener and SQL
          // resource before the real filesystem lifecycle is allowed to remove storage.
          yield* Effect.scoped(
            Effect.gen(function* () {
              const provider = yield* acquireProvider({
                database,
                port: record.ports.provider,
                apiKey,
                providerGeneration: record.providerGeneration,
              });
              const sdk = new WorkOS(apiKey, {
                apiHostname: "127.0.0.1",
                port: provider.port,
                https: false,
              });
              const user = yield* Effect.promise(() =>
                sdk.userManagement.createUser({
                  email: "destroy@example.test",
                  password: "Synthetic-password-42",
                  emailVerified: true,
                }),
              );
              yield* Effect.promise(() =>
                sdk.userManagement.authenticateWithPassword({
                  clientId: provider.clientId,
                  email: user.email,
                  password: "Synthetic-password-42",
                }),
              );
              const db = yield* Effect.acquireRelease(
                Effect.sync(
                  () => new DatabaseSync(database, { readOnly: true }),
                ),
                (connection) => Effect.sync(() => connection.close()),
              );
              const saved = yield* Schema.decodeUnknownEffect(
                Schema.fromJsonString(
                  Schema.Struct({
                    generation: Schema.String,
                    privateKey: Schema.Struct({ d: Schema.String }),
                    publicKey: Schema.Struct({ kty: Schema.String }),
                  }),
                ),
              )(
                String(
                  db.prepare("SELECT body FROM instance WHERE id=1").get()
                    ?.body,
                ),
              );
              assert.equal(saved.generation, record.providerGeneration);
              // Check presence without printing, hashing, or returning private signing material.
              assert.equal(typeof saved.privateKey.d, "string");
              assert.equal(saved.publicKey.kty, "RSA");
              assert.equal(
                db.prepare("SELECT count(*) AS n FROM users").get()?.n,
                1,
              );
              assert.equal(
                db.prepare("SELECT count(*) AS n FROM sessions").get()?.n,
                1,
              );
              yield* Effect.promise(() =>
                assert.rejects(
                  lifecycle.destroyProvider(worktree, confirmation),
                  /stopped/,
                ),
              );
              assert.equal(
                yield* fs.exists(join(root, "provider-retirement.json")),
                false,
              );
            }),
          );
          assert.equal(
            (yield* Effect.promise<{ services: { provider: string } }>(() =>
              registry.status(worktree),
            )).services.provider,
            "stopped",
          );
          const outcome = yield* Effect.promise<Destruction>(() =>
            lifecycle.destroyProvider(worktree, confirmation),
          );
          assert.equal(outcome.state, "complete");
          assert.equal(outcome.retirement, "recorded");
          assert.equal(outcome.storage["state.sqlite"], "removed");
          assert.equal(outcome.trustRepairRequired, true);
          assert.deepEqual(yield* fs.readDirectory(providerDir), [
            ".recovery-stack-owner.json",
          ]);
          // Read-only open cannot accidentally recreate the deleted SQL/signing store.
          assert.throws(() => new DatabaseSync(database, { readOnly: true }));
          const reserve = registry.reserve;
          let allocations = 0;
          registry.reserve = () => {
            allocations++;
            throw Error("unexpected allocation");
          };
          yield* Effect.promise(() =>
            assert.rejects(
              lifecycle.start(worktree, () => []),
              {
                message:
                  "Provider retired; deliberate trust re-pairing and ownership reconciliation required",
              },
            ),
          );
          registry.reserve = reserve;
          assert.equal(allocations, 0);
          assert.equal(prepared, false);
          assert.equal(commands, 0);
          assert.equal(yield* fs.exists(database), false);
          assert.deepEqual(
            yield* Effect.promise(() =>
              registry.readOwned(worktree, record.stackId),
            ),
            record,
          );
          for (const snapshot of snapshots) {
            assert.deepEqual(yield* fs.readFile(snapshot.file), snapshot.bytes);
            assert.equal(
              Option.getOrThrow((yield* fs.stat(snapshot.file)).ino),
              snapshot.inode,
            );
          }
          assert.equal(
            (yield* Effect.promise(() =>
              siblingSdk.userManagement.getUser(siblingUser.id),
            )).id,
            siblingUser.id,
          );
          assert.deepEqual(
            yield* Effect.promise(() =>
              registry.readOwned(sibling, other.stackId),
            ),
            other,
          );
        }),
    );
  },
);
