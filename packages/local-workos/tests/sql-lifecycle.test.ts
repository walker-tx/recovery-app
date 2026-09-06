import {
  ConfigProvider,
  Context,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Redacted,
  Scope,
} from "effect";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { generateKeyPair, SignJWT } from "jose";
import { WorkOSService, workosLayer } from "../src/workos-service.ts";
import { it } from "@effect/vitest";
import { vi } from "vitest";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startProvider } from "../src/provider.ts";

const directory = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "workos-sql-scope-"))),
  (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
);
const closeSpy = Effect.acquireRelease(
  Effect.sync(() => vi.spyOn(DatabaseSync.prototype, "close")),
  (spy) => Effect.sync(() => spy.mockRestore()),
);

it.live(
  "owns one configured connection and shares concurrent close completion",
  () =>
    Effect.gen(function* () {
      const dir = yield* directory;
      const connections = new Set<DatabaseSync>();
      const originalExec = DatabaseSync.prototype.exec;
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
            this: DatabaseSync,
            text: string,
          ) {
            connections.add(this);
            return originalExec.call(this, text);
          }),
        ),
        (spy) => Effect.sync(() => spy.mockRestore()),
      );
      const close = yield* closeSpy;
      const provider = yield* Effect.acquireRelease(
        Effect.promise(() =>
          startProvider({
            database: join(dir, "state.sqlite"),
            apiKey: "sk_test_sql_scope",
          }),
        ),
        (provider) => Effect.promise(() => provider.close()),
      );
      assert.equal(connections.size, 1);
      const [db] = connections;
      assert.equal(db.prepare("PRAGMA foreign_keys").get()?.foreign_keys, 1);
      assert.equal(db.prepare("PRAGMA busy_timeout").get()?.timeout, 50);
      assert.equal(
        db.prepare("PRAGMA journal_mode").get()?.journal_mode,
        "delete",
      );
      yield* Effect.promise(() =>
        provider.createIdentityFixture({
          email: "sql@example.test",
          provider: "GoogleOAuth",
        }),
      );
      const first = provider.close();
      assert.equal(provider.close(), first);
      yield* Effect.promise(() => first);
      assert.equal(close.mock.calls.length, 1);
      yield* Effect.promise(() =>
        assert.rejects(
          provider.createIdentityFixture({
            email: "closed@example.test",
            provider: "AppleOAuth",
          }),
          /Unable to create identity fixture/,
        ),
      );
    }),
);

it.live(
  "closes the acquired connection when adapter configuration defects",
  () =>
    Effect.gen(function* () {
      const dir = yield* directory;
      const originalExec = DatabaseSync.prototype.exec;
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          vi.spyOn(DatabaseSync.prototype, "exec").mockImplementation(function (
            this: DatabaseSync,
            text: string,
          ) {
            if (text.startsWith("PRAGMA busy_timeout"))
              throw new Error("synthetic configuration failure");
            return originalExec.call(this, text);
          }),
        ),
        (spy) => Effect.sync(() => spy.mockRestore()),
      );
      const close = yield* closeSpy;
      yield* Effect.promise(() =>
        assert.rejects(
          startProvider({
            database: join(dir, "state.sqlite"),
            apiKey: "sk_test_sql_scope",
          }),
          /synthetic configuration failure/,
        ),
      );
      assert.equal(close.mock.calls.length, 1);
    }),
);

it.live("interrupted signing cannot continue into a session write", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    // SignJWT.sign is a Promise API; only its completion is controlled here.
    let finishSigning!: (token: string) => void;
    const signing = new Promise<string>((resolve) => {
      finishSigning = resolve;
    });
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        vi.spyOn(SignJWT.prototype, "sign").mockImplementation(() => {
          Deferred.doneUnsafe(started, Effect.void);
          return signing;
        }),
      ),
      (spy) =>
        Effect.sync(() => {
          finishSigning("synthetic-token");
          spy.mockRestore();
        }),
    );
    const close = yield* closeSpy;
    yield* Effect.scoped(
      Effect.gen(function* () {
        const scope = yield* Scope.Scope;
        const database = yield* Layer.buildWithScope(
          SqliteClient.layer({
            filename: ":memory:",
            busyTimeout: 50,
            disableWAL: true,
          }),
          scope,
        );
        const sql = Context.get(database, SqlClient.SqlClient);
        yield* sql`CREATE TABLE users (id TEXT PRIMARY KEY,email TEXT UNIQUE,body TEXT,salt TEXT,verifier TEXT,identities TEXT)`;
        yield* sql`CREATE TABLE sessions (id TEXT PRIMARY KEY,user_id TEXT,refresh_hash TEXT,expires_at INTEGER)`;
        const { privateKey } = yield* Effect.promise(() =>
          generateKeyPair("RS256"),
        );
        const serviceContext = yield* Layer.buildWithScope(
          workosLayer(
            privateKey,
            { keys: [] },
            Redacted.make("sk_test_cancel"),
          ).pipe(Layer.provide(Layer.succeedContext(database))),
          scope,
        ).pipe(
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromUnknown({
              clientId: "client_cancel",
              issuer: "https://cancel.invalid",
              providerGeneration: "cancel",
              port: 0,
            }),
          ),
        );
        const service = Context.get(serviceContext, WorkOSService);
        yield* service.createUser({
          email: "cancel@example.test",
          password: "Synthetic-password-42",
          email_verified: true,
        });
        const authentication = yield* service
          .authenticate({
            client_id: "client_cancel",
            client_secret: "sk_test_cancel",
            grant_type: "password",
            email: "cancel@example.test",
            password: "Synthetic-password-42",
          })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(started);
        yield* Fiber.interrupt(authentication);
        finishSigning("synthetic-token");
        yield* Effect.yieldNow;
        const [row] = yield* sql<{
          n: number;
        }>`SELECT count(*) AS n FROM sessions`;
        assert.equal(row.n, 0);
      }),
    );
    assert.equal(close.mock.calls.length, 1);
  }),
);

it.live("interrupting the owning scope closes its SQLite connection", () =>
  Effect.gen(function* () {
    const close = yield* closeSpy;
    const acquired = yield* Deferred.make<void>();
    const owner = yield* Effect.scoped(
      Effect.gen(function* () {
        const scope = yield* Scope.Scope;
        yield* Layer.buildWithScope(
          SqliteClient.layer({
            filename: ":memory:",
            busyTimeout: 50,
            disableWAL: true,
          }),
          scope,
        );
        yield* Deferred.succeed(acquired, undefined);
        yield* Effect.never;
      }),
    ).pipe(Effect.forkScoped);
    yield* Deferred.await(acquired);
    yield* Fiber.interrupt(owner);
    assert.equal(close.mock.calls.length, 1);
  }),
);
