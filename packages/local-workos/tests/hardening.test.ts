import { it, vi } from "@effect/vitest";
import { Effect } from "effect";
import assert from "node:assert/strict";
import { mkdtemp, rm, chmod, symlink, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WorkOS } from "@workos-inc/node";
import { startProvider } from "../src/provider.ts";
const fixture = () =>
  Effect.gen(function* () {
    const dir = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "workos-core-"))),
      (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
    );
    return {
      dir,
      options: {
        database: join(dir, "state.sqlite"),
        apiKey: `sk_test_local_${"03".repeat(32)}`,
      },
    };
  });
it.live("reject unsafe state paths without changing targets", () =>
  Effect.gen(function* () {
    const { dir, options } = yield* fixture();
    yield* Effect.promise(() => chmod(dir, 0o777));
    yield* Effect.promise(() => assert.rejects(startProvider(options)));
    yield* Effect.promise(() => chmod(dir, 0o700));
    const target = join(dir, "target");
    const db = new DatabaseSync(target);
    db.close();
    yield* Effect.promise(() => chmod(target, 0o644));
    yield* Effect.promise(() => symlink(target, options.database));
    yield* Effect.promise(() => assert.rejects(startProvider(options)));
    const targetInfo = yield* Effect.promise(() => stat(target));
    assert.equal(targetInfo.mode & 0o777, 0o644);
  }),
);
it.live("lock failures are bounded and corrupt startup can recover", () =>
  Effect.gen(function* () {
    const close = yield* Effect.acquireRelease(
      Effect.sync(() => vi.spyOn(DatabaseSync.prototype, "close")),
      (spy) => Effect.sync(() => spy.mockRestore()),
    );
    const { dir, options } = yield* fixture();
    let p = yield* Effect.acquireRelease(
      Effect.promise(() => startProvider(options)),
      (provider) => Effect.promise(() => provider.close()),
    );
    yield* Effect.promise(() => p.close());
    const db = new DatabaseSync(options.database);
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (db.isTransaction) db.exec("ROLLBACK");
        db.close();
      }),
    );
    db.exec("BEGIN EXCLUSIVE");
    const start = performance.now();
    yield* Effect.promise(() => assert.rejects(startProvider(options)));
    assert.ok(
      performance.now() - start < 1000,
      "synchronous lock wait must be short",
    );
    db.exec("ROLLBACK");
    const original = (
      db.prepare("SELECT body FROM instance").get() as {
        body: string;
      }
    ).body;
    for (const body of [
      "{",
      "null",
      "{}",
      JSON.stringify({ ...JSON.parse(original), privateKey: { kty: "RSA" } }),
    ]) {
      db.prepare("UPDATE instance SET body=?").run(body);
      const closedBefore = close.mock.calls.length;
      yield* Effect.promise(() => assert.rejects(startProvider(options)));
      assert.equal(close.mock.calls.length, closedBefore + 1);
      db.prepare("UPDATE instance SET body=?").run(original);
      p = yield* Effect.acquireRelease(
        Effect.promise(() => startProvider(options)),
        (provider) => Effect.promise(() => provider.close()),
      );
      yield* Effect.promise(() => p.close());
    }
  }),
);
it.live("bounded requests, explicit paging and trusted social fixtures", () =>
  Effect.gen(function* () {
    const { dir, options } = yield* fixture();
    const p = yield* Effect.acquireRelease(
      Effect.promise(() => startProvider(options)),
      (provider) => Effect.promise(() => provider.close()),
    );
    const sdk = new WorkOS(options.apiKey, {
      apiHostname: "127.0.0.1",
      port: p.port,
      https: false,
    });
    const request = (path: string, init: RequestInit = {}) =>
      fetch(`http://127.0.0.1:${p.port}${path}`, {
        ...init,
        signal: AbortSignal.timeout(3000),
      });
    for (const body of [
      "",
      "{",
      "null",
      "[]",
      '"secret-marker"',
      "x".repeat(17000),
    ]) {
      const r = yield* Effect.promise(() =>
        request("/user_management/users", { method: "POST", body }),
      );
      assert.ok(r.status >= 400 && r.status < 500);
      const responseBody = yield* Effect.promise(() => r.text());
      assert.ok(!responseBody.includes("secret-marker"));
    }
    for (const secret of [undefined, "wrong"]) {
      const authenticationResponse = yield* Effect.promise(() =>
        request("/user_management/authenticate", {
          method: "POST",
          body: JSON.stringify({
            client_id: p.clientId,
            client_secret: secret,
            grant_type: "password",
          }),
        }),
      );
      assert.equal(authenticationResponse.status, 401);
    }
    for (const authorization of ["", "Bearer wrong"]) {
      for (const method of ["GET", "POST", "DELETE"]) {
        const unauthorizedResponse = yield* Effect.promise(() =>
          request("/user_management/users", {
            method,
            headers: { authorization },
            ...(method === "POST" ? { body: "{}" } : {}),
          }),
        );
        assert.equal(unauthorizedResponse.status, 401);
      }
    }
    for (const query of [
      "before=user_bad",
      "order=invalid",
      "after=bad",
      "limit=0",
      "limit=101",
      "limit=no",
    ]) {
      const pagingResponse = yield* Effect.promise(() =>
        request("/user_management/users?" + query, {
          headers: { authorization: `Bearer ${options.apiKey}` },
        }),
      );
      assert.equal(pagingResponse.status, 422);
    }
    const password = "Synthetic-password-42";
    const u = yield* Effect.promise(() =>
      sdk.userManagement.createUser({
        email: "unverified@example.test",
        password,
      }),
    );
    yield* Effect.promise(() =>
      assert.rejects(
        sdk.userManagement.authenticateWithPassword({
          clientId: p.clientId,
          email: u.email,
          password,
        }),
      ),
    );
    const db = yield* Effect.acquireRelease(
      Effect.sync(() => new DatabaseSync(options.database)),
      (db) => Effect.sync(() => db.close()),
    );
    assert.equal(db.prepare("SELECT count(*) AS n FROM sessions").get()?.n, 0);
    for (const provider of ["GoogleOAuth", "AppleOAuth"] as const) {
      const user = yield* Effect.promise(() =>
        p.createIdentityFixture({
          email: provider + "@example.test",
          provider,
        }),
      );
      const identities = yield* Effect.promise(() =>
        sdk.userManagement.getUserIdentities(user.id),
      );
      assert.equal(identities.length, 1);
      assert.equal(identities[0].type, provider);
      assert.equal(identities[0].provider, provider);
      yield* Effect.promise(() =>
        assert.rejects(
          sdk.userManagement.authenticateWithPassword({
            clientId: p.clientId,
            email: user.email,
            password,
          }),
        ),
      );
    }
    const ids: string[] = [];
    let after: string | undefined;
    do {
      const page = yield* Effect.promise(() =>
        sdk.userManagement.listUsers({ limit: 1, after }),
      );
      ids.push(...page.data.map((u) => u.id));
      after = page.listMetadata.after ?? undefined;
    } while (after);
    assert.equal(new Set(ids).size, 3);
    assert.equal(ids.length, 3);
    const duplicates = yield* Effect.promise(() =>
      Promise.allSettled(
        [1, 2].map(() =>
          sdk.userManagement.createUser({
            email: "race@example.test",
            password,
          }),
        ),
      ),
    );
    assert.equal(duplicates.filter((r) => r.status === "fulfilled").length, 1);
    const databaseInfo = yield* Effect.promise(() => stat(options.database));
    assert.equal(databaseInfo.mode & 0o777, 0o600);
  }),
);
it.live(
  "existing sidecars require owner-only permissions and concurrent initialization agrees",
  () =>
    Effect.gen(function* () {
      const { dir, options } = yield* fixture();
      for (const suffix of ["-journal", "-wal", "-shm"]) {
        yield* Effect.promise(() =>
          writeFile(options.database + suffix, "", { mode: 0o644 }),
        );
        yield* Effect.promise(() => assert.rejects(startProvider(options)));
        const sidecarInfo = yield* Effect.promise(() =>
          stat(options.database + suffix),
        );
        assert.equal(sidecarInfo.mode & 0o777, 0o644);
        yield* Effect.promise(() => rm(options.database + suffix));
      }
      const providers = yield* Effect.all(
        [1, 2].map(() =>
          Effect.acquireRelease(
            Effect.promise(() => startProvider(options)),
            (provider) => Effect.promise(() => provider.close()),
          ),
        ),
        { concurrency: "unbounded" },
      );
      assert.equal(providers[0].issuer, providers[1].issuer);
    }),
);
