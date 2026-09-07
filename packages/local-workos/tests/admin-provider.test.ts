import { assert, it } from "@effect/vitest";
import { Effect, Schema, Data, Exit } from "effect";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Real socket fixture filesystem ownership checks.
import { mkdtemp, rm, stat, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Pure fixture path construction.
import { join } from "node:path";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Exercise real Unix HTTP transport.
import { request } from "node:http";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Test adversarial socket path replacement with native filesystem operations.
import * as fs from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { WorkOS } from "@workos-inc/node";
import { decodeJwt } from "jose";
import { acquireProvider } from "../src/provider.ts";

import {
  AdminResponse,
  AdminUser,
  AdminSessionList,
  AdminUserList,
} from "../src/admin-contract.ts";
class TransportError extends Data.TaggedError("TransportError") {}
const send = Effect.fn("send")(function* (socketPath: string, body: unknown) {
  const encoded = yield* Schema.encodeEffect(
    Schema.fromJsonString(Schema.Unknown),
  )(body);
  return yield* Effect.callback<
    AdminResponse,
    TransportError | Schema.SchemaError
  >((resume) => {
    const req = request(
      {
        socketPath,
        path: "/v1/admin",
        method: "POST",
        headers: { "content-type": "application/json" },
      },
      (res) => {
        let text = "";
        res.on("data", (chunk: Buffer) => {
          text += chunk.toString();
        });
        res.on("end", () => {
          resume(
            Schema.decodeUnknownEffect(Schema.fromJsonString(AdminResponse))(
              text,
            ),
          );
        });
      },
    );
    req.on("error", () => resume(Effect.fail(new TransportError())));
    req.end(encoded);
    return Effect.sync(() => req.destroy());
  });
});

it.live(
  "private admin status, users and guarded mutations share real provider state",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dir = yield* Effect.acquireRelease(
          Effect.promise(() =>
            mkdtemp(join(tmpdir(), "admin-")).then((path) => realpath(path)),
          ),
          (path) =>
            Effect.promise(() => rm(path, { recursive: true, force: true })),
        );
        const socketPath = join(dir, "admin.sock");
        const provider = yield* acquireProvider({
          database: join(dir, "state.sqlite"),
          apiKey: `sk_test_local_${"a".repeat(64)}`,
          admin: {
            socketPath,
            stackId: "11111111-1111-4111-8111-111111111111",
            worktree: dir,
          },
        });
        const call = (
          operation: string,
          input: unknown = {},
          generation = provider.providerGeneration,
        ) =>
          send(socketPath, {
            stackId: "11111111-1111-4111-8111-111111111111",
            providerGeneration: generation,
            operation,
            input,
          });
        assert.equal((yield* call("status")).ok, true);
        for (const field of ["stackId", "providerGeneration"]) {
          for (const value of [undefined, "", "not-a-uuid", "x".repeat(4097)]) {
            const invalid = yield* send(socketPath, {
              stackId: "11111111-1111-4111-8111-111111111111",
              providerGeneration: provider.providerGeneration,
              [field]: value,
              operation: "users.create",
              input: {
                email: "invalid@example.test",
                password: "Password123!",
              },
            });
            assert.ok(!invalid.ok);
            assert.equal(invalid.error.code, "INVALID_INPUT");
          }
        }

        assert.equal(
          (yield* Effect.promise(() => stat(socketPath))).mode & 0o777,
          0o600,
        );
        const empty = yield* call("users.list");
        assert.ok(empty.ok);
        assert.deepEqual(empty.data, {
          users: [],
          nextCursor: null,
        });
        const created = yield* call("users.create", {
          email: "admin@example.test",
          password: "Password123!",
          firstName: "Test",
        });
        assert.equal(created.ok, true);
        assert.ok(created.ok);
        const user = yield* Schema.decodeUnknownEffect(AdminUser)(created.data);
        assert.ok(user.id);
        assert.equal(
          (yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
            created,
          )).includes("Password123!"),
          false,
        );
        assert.equal((yield* call("users.get", { userId: user.id })).ok, true);
        assert.equal(
          (yield* call("users.update", {
            userId: user.id,
            email: "changed@example.test",
          })).ok,
          true,
        );
        assert.equal(
          (yield* call("users.verify", { userId: user.id, verified: true })).ok,
          true,
        );
        assert.equal(
          (yield* call("users.delete", {
            userId: user.id,
            confirmEmail: "admin@example.test",
          })).ok,
          false,
        );
        assert.equal(
          (yield* call(
            "users.delete",
            { userId: user.id, confirmEmail: "changed@example.test" },
            "22222222-2222-4222-8222-222222222222",
          )).ok,
          false,
        );
        const sessions = yield* call("sessions.list", { userId: user.id });
        assert.ok(sessions.ok);
        assert.deepEqual(sessions.data, { sessions: [], nextCursor: null });
        assert.equal(
          (yield* call("sessions.revoke-all", {
            userId: user.id,
          })).ok,
          true,
        );
        assert.equal(
          (yield* call("users.delete", {
            userId: user.id,
            confirmEmail: "changed@example.test",
          })).ok,
          true,
        );
        assert.equal((yield* call("users.get", { userId: user.id })).ok, false);
      }),
    ),
  { timeout: 10000 },
);

it.live(
  "duplicate email update fails safely and cannot change either user",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dir = yield* Effect.acquireRelease(
          Effect.promise(() =>
            mkdtemp(join(tmpdir(), "admin-")).then((path) => realpath(path)),
          ),
          (path) =>
            Effect.promise(() => rm(path, { recursive: true, force: true })),
        );
        const socketPath = join(dir, "a.sock");
        const provider = yield* acquireProvider({
          database: join(dir, "s.sqlite"),
          apiKey: `sk_test_local_${"a".repeat(64)}`,
          admin: {
            socketPath,
            stackId: "11111111-1111-4111-8111-111111111111",
            worktree: dir,
          },
        });
        const call = (operation: string, input: unknown) =>
          send(socketPath, {
            stackId: "11111111-1111-4111-8111-111111111111",
            providerGeneration: provider.providerGeneration,
            operation,
            input,
          });
        const a = yield* call("users.create", {
          email: "a@example.test",
          password: "Password123!",
        });
        yield* call("users.create", {
          email: "b@example.test",
          password: "Password123!",
        });
        assert.ok(a.ok);
        const user = yield* Schema.decodeUnknownEffect(AdminUser)(a.data);
        const update = yield* call("users.update", {
          userId: user.id,
          email: "b@example.test",
        });
        assert.ok(!update.ok);
        assert.equal(update.error.code, "INVALID_INPUT");
        const unchanged = yield* call("users.get", { userId: user.id });
        assert.ok(unchanged.ok);
        assert.equal(
          (yield* Schema.decodeUnknownEffect(AdminUser)(unchanged.data)).email,
          "a@example.test",
        );
      }),
    ),
  { timeout: 10000 },
);

it.live(
  "real password sessions paginate, revoke and retain the JWT caveat without secrets",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dir = yield* Effect.acquireRelease(
          Effect.promise(() =>
            mkdtemp(join(tmpdir(), "admin-")).then((path) => realpath(path)),
          ),
          (path) =>
            Effect.promise(() => rm(path, { recursive: true, force: true })),
        );
        const socketPath = join(dir, "a.sock");
        const apiKey = `sk_test_local_${"a".repeat(64)}`;
        const provider = yield* acquireProvider({
          database: join(dir, "s.sqlite"),
          apiKey,
          admin: {
            socketPath,
            stackId: "11111111-1111-4111-8111-111111111111",
            worktree: dir,
          },
        });
        const call = (operation: string, input: unknown) =>
          send(socketPath, {
            stackId: "11111111-1111-4111-8111-111111111111",
            providerGeneration: provider.providerGeneration,
            operation,
            input,
          });
        const sdk = new WorkOS(apiKey, {
          apiHostname: "127.0.0.1",
          port: provider.port,
          https: false,
          maxRetries: 0,
        });
        const user = yield* Effect.promise(() =>
          sdk.userManagement.createUser({
            email: "session@example.test",
            password: "Password123!",
            emailVerified: true,
          }),
        );
        const auth = () =>
          Effect.promise(() =>
            sdk.userManagement.authenticateWithPassword({
              clientId: provider.clientId,
              email: user.email,
              password: "Password123!",
            }),
          );
        const a = yield* auth();
        const b = yield* auth();
        const listed = yield* call("sessions.list", {
          userId: user.id,
          limit: 1,
        });
        assert.ok(listed.ok);
        const page = yield* Schema.decodeUnknownEffect(AdminSessionList)(
          listed.data,
        );
        assert.equal(page.sessions.length, 1);
        assert.deepEqual(page.sessions[0], {
          id: page.sessions[0].id,
          userId: user.id,
          expiresAt: page.sessions[0].expiresAt,
          metadataStatus: "unavailable",
        });
        assert.ok(page.nextCursor);
        const second = yield* call("sessions.list", {
          userId: user.id,
          limit: 1,
          cursor: page.nextCursor,
        });
        assert.ok(second.ok);
        const next = yield* Schema.decodeUnknownEffect(AdminSessionList)(
          second.data,
        );
        assert.equal(next.sessions.length, 1);
        assert.notEqual(next.sessions[0].id, page.sessions[0].id);
        assert.equal(next.nextCursor, null);
        assert.equal(
          (yield* call("sessions.list", {
            userId: user.id,
            limit: 2,
            cursor: page.nextCursor,
          })).ok,
          false,
        );
        const sid = yield* Schema.decodeUnknownEffect(Schema.String)(
          decodeJwt(a.accessToken).sid,
        );
        const revoked = yield* call("sessions.revoke", { sessionId: sid });
        assert.ok(revoked.ok);
        const text = yield* Schema.encodeEffect(
          Schema.fromJsonString(Schema.Unknown),
        )(listed);
        for (const secret of [
          apiKey,
          a.accessToken,
          a.refreshToken,
          b.refreshToken,
          "refresh_hash",
          "verifier",
          "salt",
        ]) {
          assert.equal(text.includes(secret), false);
        }
        const refresh = yield* Effect.tryPromise(() =>
          sdk.userManagement.authenticateWithRefreshToken({
            clientId: provider.clientId,
            refreshToken: a.refreshToken,
          }),
        ).pipe(Effect.exit);
        assert.ok(Exit.isFailure(refresh));
        assert.equal(
          (yield* call("sessions.revoke-all", {
            userId: "user_00000000-0000-4000-8000-000000000000",
          })).ok,
          false,
        );
        assert.equal(
          (yield* call("sessions.revoke-all", {
            userId: user.id,
          })).ok,
          true,
        );
        const after = yield* call("sessions.list", { userId: user.id });
        assert.ok(after.ok);
        assert.deepEqual(after.data, { sessions: [], nextCursor: null });
      }),
    ),
  { timeout: 10000 },
);

it.live(
  "users cursors are bound to exact filters and limits with deterministic order",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dir = yield* Effect.acquireRelease(
          Effect.promise(() =>
            mkdtemp(join(tmpdir(), "admin-")).then((path) => realpath(path)),
          ),
          (path) =>
            Effect.promise(() => rm(path, { recursive: true, force: true })),
        );
        const socketPath = join(dir, "a.sock");
        const provider = yield* acquireProvider({
          database: join(dir, "s.sqlite"),
          apiKey: `sk_test_local_${"a".repeat(64)}`,
          admin: {
            socketPath,
            stackId: "11111111-1111-4111-8111-111111111111",
            worktree: dir,
          },
        });
        const call = (operation: string, input: unknown) =>
          send(socketPath, {
            stackId: "11111111-1111-4111-8111-111111111111",
            providerGeneration: provider.providerGeneration,
            operation,
            input,
          });
        for (const email of [
          "a@example.test",
          "b@example.test",
          "other@else.test",
        ]) {
          yield* call("users.create", { email, password: "Password123!" });
        }
        const first = yield* call("users.list", {
          limit: 1,
          search: "example",
        });
        assert.ok(first.ok);
        const page = yield* Schema.decodeUnknownEffect(AdminUserList)(
          first.data,
        );
        assert.ok(page.nextCursor);
        const second = yield* call("users.list", {
          limit: 1,
          search: "example",
          cursor: page.nextCursor,
        });
        assert.ok(second.ok);
        const next = yield* Schema.decodeUnknownEffect(AdminUserList)(
          second.data,
        );
        assert.equal(next.users.length, 1);
        assert.ok(page.users[0].id < next.users[0].id);
        assert.equal(next.nextCursor, null);
        for (const input of [
          { limit: 0 },
          { limit: 101 },
          { limit: 1, search: "else", cursor: page.nextCursor },
          { limit: 1, cursor: "broken" },
        ]) {
          assert.equal((yield* call("users.list", input)).ok, false);
        }
      }),
    ),
  { timeout: 10000 },
);

it.live(
  "scope cleanup preserves replacement paths and unrelated siblings",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dir = yield* Effect.acquireRelease(
          Effect.promise(() =>
            mkdtemp(join(tmpdir(), "admin-")).then((path) => realpath(path)),
          ),
          (path) =>
            Effect.promise(() => rm(path, { recursive: true, force: true })),
        );
        const socketPath = join(dir, "a.sock");
        const options = {
          database: join(dir, "s.sqlite"),
          apiKey: `sk_test_local_${"a".repeat(64)}`,
          admin: {
            socketPath,
            stackId: "11111111-1111-4111-8111-111111111111",
            worktree: dir,
          },
        };
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* acquireProvider(options);
            yield* Effect.promise(() =>
              fs.rename(socketPath, socketPath + ".moved"),
            );
            yield* Effect.promise(() =>
              fs.writeFile(socketPath, "unrelated replacement", {
                mode: 0o600,
              }),
            );
          }),
        );
        assert.equal(
          yield* Effect.promise(() => fs.readFile(socketPath, "utf8")),
          "unrelated replacement",
        );
        assert.ok(
          (yield* Effect.promise(() => stat(socketPath + ".moved"))).isSocket(),
        );
        const occupied = yield* Effect.scoped(acquireProvider(options)).pipe(
          Effect.exit,
        );
        assert.ok(Exit.isFailure(occupied));
        assert.equal(
          yield* Effect.promise(() => fs.readFile(socketPath, "utf8")),
          "unrelated replacement",
        );
        yield* Effect.promise(() => fs.unlink(socketPath));
        yield* Effect.scoped(acquireProvider(options));
        assert.ok(
          Exit.isFailure(
            yield* Effect.tryPromise(() => stat(socketPath)).pipe(Effect.exit),
          ),
        );
        assert.ok(
          (yield* Effect.promise(() => stat(options.database))).isFile(),
        );
      }),
    ),
  { timeout: 10000 },
);

it.live(
  "identity inode and persisted generation replacement reject every operation without mutation",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dir = yield* Effect.acquireRelease(
          Effect.promise(() =>
            mkdtemp(join(tmpdir(), "admin-")).then((path) => realpath(path)),
          ),
          (path) =>
            Effect.promise(() => rm(path, { recursive: true, force: true })),
        );
        const socketPath = join(dir, "a.sock");
        const database = join(dir, "s.sqlite");
        const provider = yield* acquireProvider({
          database,
          apiKey: `sk_test_local_${"a".repeat(64)}`,
          admin: {
            socketPath,
            stackId: "11111111-1111-4111-8111-111111111111",
            worktree: dir,
          },
        });
        const call = (
          operation: string,
          input: unknown,
          stackId = "11111111-1111-4111-8111-111111111111",
        ) =>
          send(socketPath, {
            stackId,
            providerGeneration: provider.providerGeneration,
            operation,
            input,
          });
        const wrong = yield* call(
          "users.create",
          { email: "wrong@example.test", password: "Password123!" },
          "22222222-2222-4222-8222-222222222222",
        );
        assert.ok(!wrong.ok);
        assert.equal(wrong.error.code, "TARGET_MISMATCH");
        // Synthetic identity corruption only: sessions are always created through supported authentication.
        const db = yield* Effect.acquireRelease(
          Effect.sync(() => new DatabaseSync(database)),
          (connection) => Effect.sync(() => connection.close()),
        );
        yield* Effect.sync(() =>
          db.prepare("UPDATE instance SET body=? WHERE id=1").run("{}"),
        );
        const stale = yield* call("users.create", {
          email: "stale@example.test",
          password: "Password123!",
        });
        assert.ok(!stale.ok);
        assert.equal(stale.error.code, "TARGET_MISMATCH");
        assert.equal(
          yield* Effect.sync(
            () => db.prepare("SELECT count(*) AS n FROM users").get()?.n,
          ),
          0,
        );
        yield* Effect.promise(() => fs.rename(database, database + ".moved"));
        yield* Effect.promise(() =>
          fs.writeFile(database, "replacement", { mode: 0o600 }),
        );
        const inode = yield* call("status", {});
        assert.ok(!inode.ok);
        assert.equal(inode.error.code, "TARGET_MISMATCH");
      }),
    ),
  { timeout: 10000 },
);

it.live(
  "private socket rejects symlink parents, public modes and oversized request bodies",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dir = yield* Effect.acquireRelease(
          Effect.promise(() =>
            mkdtemp(join(tmpdir(), "admin-")).then((path) => realpath(path)),
          ),
          (path) =>
            Effect.promise(() => rm(path, { recursive: true, force: true })),
        );
        const socketPath = join(dir, "a.sock");
        const options = {
          database: join(dir, "s.sqlite"),
          apiKey: `sk_test_local_${"a".repeat(64)}`,
          admin: {
            socketPath,
            stackId: "11111111-1111-4111-8111-111111111111",
            worktree: dir,
          },
        };
        yield* Effect.promise(() =>
          fs.mkdir(join(dir, "public"), { mode: 0o755 }),
        );
        assert.ok(
          Exit.isFailure(
            yield* Effect.scoped(
              acquireProvider({
                ...options,
                admin: {
                  ...options.admin,
                  socketPath: join(dir, "public", "a.sock"),
                },
              }),
            ).pipe(Effect.exit),
          ),
        );
        yield* Effect.promise(() => fs.symlink(dir, join(dir, "link")));
        assert.ok(
          Exit.isFailure(
            yield* Effect.scoped(
              acquireProvider({
                ...options,
                admin: {
                  ...options.admin,
                  socketPath: join(dir, "link", "a.sock"),
                },
              }),
            ).pipe(Effect.exit),
          ),
        );
        const provider = yield* acquireProvider(options);
        // The pinned Node body reader destroys an over-limit stream rather than
        // attempting to keep an unbounded body alive to send an error response.
        const result = yield* send(socketPath, {
          stackId: "11111111-1111-4111-8111-111111111111",
          providerGeneration: provider.providerGeneration,
          operation: "users.create",
          input: { email: "big@example.test", password: "a".repeat(1048576) },
        }).pipe(Effect.exit);
        assert.ok(Exit.isFailure(result));
        const status = yield* send(socketPath, {
          stackId: "11111111-1111-4111-8111-111111111111",
          providerGeneration: provider.providerGeneration,
          operation: "users.list",
          input: {},
        });
        assert.ok(status.ok);
        assert.deepEqual(status.data, { users: [], nextCursor: null });
      }),
    ),
  { timeout: 10000 },
);

it.live(
  "email-update and deletion race validates confirmation atomically",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dir = yield* Effect.acquireRelease(
          Effect.promise(() =>
            mkdtemp(join(tmpdir(), "admin-")).then((path) => realpath(path)),
          ),
          (path) =>
            Effect.promise(() => rm(path, { recursive: true, force: true })),
        );
        const socketPath = join(dir, "a.sock");
        const provider = yield* acquireProvider({
          database: join(dir, "s.sqlite"),
          apiKey: `sk_test_local_${"a".repeat(64)}`,
          admin: {
            socketPath,
            stackId: "11111111-1111-4111-8111-111111111111",
            worktree: dir,
          },
        });
        const call = (operation: string, input: unknown) =>
          send(socketPath, {
            stackId: "11111111-1111-4111-8111-111111111111",
            providerGeneration: provider.providerGeneration,
            operation,
            input,
          });
        for (let iteration = 0; iteration < 8; iteration++) {
          const created = yield* call("users.create", {
            email: "race@example.test",
            password: "Password123!",
          });
          assert.ok(created.ok);
          const user = yield* Schema.decodeUnknownEffect(AdminUser)(
            created.data,
          );
          const [updated, deleted] = yield* Effect.all(
            [
              call("users.update", {
                userId: user.id,
                email: "new@example.test",
              }),
              call("users.delete", {
                userId: user.id,
                confirmEmail: "race@example.test",
              }),
            ],
            { concurrency: "unbounded" },
          );
          assert.notEqual(updated.ok, deleted.ok);
          if (updated.ok) {
            assert.ok(!deleted.ok);
            assert.equal(deleted.error.code, "CONFIRMATION_REQUIRED");
            assert.equal(
              (yield* call("users.delete", {
                userId: user.id,
                confirmEmail: "new@example.test",
              })).ok,
              true,
            );
          } else {
            assert.equal(updated.error.code, "NOT_FOUND");
            assert.equal(
              (yield* call("users.get", { userId: user.id })).ok,
              false,
            );
          }
        }
      }),
    ),
  { timeout: 10000 },
);

it.live(
  "overlong socket paths fail before creating provider state",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dir = yield* Effect.acquireRelease(
          Effect.promise(() =>
            mkdtemp(join(tmpdir(), "admin-")).then((path) => realpath(path)),
          ),
          (path) =>
            Effect.promise(() => rm(path, { recursive: true, force: true })),
        );
        const database = join(dir, "s.sqlite");
        const result = yield* Effect.scoped(
          acquireProvider({
            database,
            apiKey: `sk_test_local_${"a".repeat(64)}`,
            admin: {
              socketPath: join(dir, "x".repeat(101)),
              stackId: "11111111-1111-4111-8111-111111111111",
              worktree: dir,
            },
          }),
        ).pipe(Effect.exit);
        assert.ok(Exit.isFailure(result));
        assert.ok(
          Exit.isFailure(
            yield* Effect.tryPromise(() => stat(database)).pipe(Effect.exit),
          ),
        );
      }),
    ),
  { timeout: 10000 },
);

it.live(
  "single-session revocation preserves the real service expired-session refusal",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dir = yield* Effect.acquireRelease(
          Effect.promise(() =>
            mkdtemp(join(tmpdir(), "admin-")).then((path) => realpath(path)),
          ),
          (path) =>
            Effect.promise(() => rm(path, { recursive: true, force: true })),
        );
        const socketPath = join(dir, "a.sock");
        const apiKey = `sk_test_local_${"a".repeat(64)}`;
        const provider = yield* acquireProvider({
          database: join(dir, "s.sqlite"),
          apiKey,
          lifetimes: { accessTokenSeconds: 1, sessionSeconds: 1 },
          admin: {
            socketPath,
            stackId: "11111111-1111-4111-8111-111111111111",
            worktree: dir,
          },
        });
        const sdk = new WorkOS(apiKey, {
          apiHostname: "127.0.0.1",
          port: provider.port,
          https: false,
          maxRetries: 0,
        });
        yield* Effect.promise(() =>
          sdk.userManagement.createUser({
            email: "expired@example.test",
            password: "Password123!",
            emailVerified: true,
          }),
        );
        const auth = yield* Effect.promise(() =>
          sdk.userManagement.authenticateWithPassword({
            clientId: provider.clientId,
            email: "expired@example.test",
            password: "Password123!",
          }),
        );
        const sessionId = yield* Schema.decodeUnknownEffect(Schema.String)(
          decodeJwt(auth.accessToken).sid,
        );
        yield* Effect.sleep("1100 millis");
        const result = yield* send(socketPath, {
          stackId: "11111111-1111-4111-8111-111111111111",
          providerGeneration: provider.providerGeneration,
          operation: "sessions.revoke",
          input: { sessionId },
        });
        assert.ok(!result.ok);
        assert.equal(result.error.code, "NOT_FOUND");
      }),
    ),
  { timeout: 10000 },
);

it.live(
  "omitted user-list limit returns all 26 real users without a cursor",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dir = yield* Effect.acquireRelease(
          Effect.promise(() =>
            mkdtemp(join(tmpdir(), "admin-")).then((path) => realpath(path)),
          ),
          (path) =>
            Effect.promise(() => rm(path, { recursive: true, force: true })),
        );
        const socketPath = join(dir, "a.sock");
        const provider = yield* acquireProvider({
          database: join(dir, "s.sqlite"),
          apiKey: `sk_test_local_${"a".repeat(64)}`,
          admin: {
            socketPath,
            stackId: "11111111-1111-4111-8111-111111111111",
            worktree: dir,
          },
        });
        const call = (operation: string, input: unknown = {}) =>
          send(socketPath, {
            stackId: "11111111-1111-4111-8111-111111111111",
            providerGeneration: provider.providerGeneration,
            operation,
            input,
          });
        for (let index = 0; index < 26; index++) {
          const created = yield* call("users.create", {
            email: `default-${index}@example.test`,
            password: "Password123!",
          });
          assert.ok(created.ok);
        }
        const listed = yield* call("users.list");
        assert.ok(listed.ok);
        const page = yield* Schema.decodeUnknownEffect(AdminUserList)(
          listed.data,
        );
        assert.equal(page.users.length, 26);
        assert.equal(page.nextCursor, null);
      }),
    ),
  { timeout: 20000 },
);

it.live(
  "empty creation names are null while empty update names still clear",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dir = yield* Effect.acquireRelease(
          Effect.promise(() =>
            mkdtemp(join(tmpdir(), "admin-")).then((path) => realpath(path)),
          ),
          (path) =>
            Effect.promise(() => rm(path, { recursive: true, force: true })),
        );
        const socketPath = join(dir, "a.sock");
        const provider = yield* acquireProvider({
          database: join(dir, "s.sqlite"),
          apiKey: `sk_test_local_${"a".repeat(64)}`,
          admin: {
            socketPath,
            stackId: "11111111-1111-4111-8111-111111111111",
            worktree: dir,
          },
        });
        const call = (operation: string, input: unknown = {}) =>
          send(socketPath, {
            stackId: "11111111-1111-4111-8111-111111111111",
            providerGeneration: provider.providerGeneration,
            operation,
            input,
          });
        const created = yield* call("users.create", {
          email: "empty-names@example.test",
          password: "Password123!",
          firstName: "",
          lastName: "",
        });
        assert.ok(created.ok);
        const user = yield* Schema.decodeUnknownEffect(AdminUser)(created.data);
        assert.equal(user.firstName, null);
        assert.equal(user.lastName, null);
        const named = yield* call("users.update", {
          userId: user.id,
          firstName: "First",
          lastName: "Last",
        });
        assert.ok(named.ok);
        const cleared = yield* call("users.update", {
          userId: user.id,
          firstName: "",
          lastName: "",
        });
        assert.ok(cleared.ok);
        const result = yield* Schema.decodeUnknownEffect(AdminUser)(
          cleared.data,
        );
        assert.equal(result.firstName, "");
        assert.equal(result.lastName, "");
      }),
    ),
  { timeout: 20000 },
);
