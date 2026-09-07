import { it } from "@effect/vitest";
import { Effect } from "effect";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { WorkOS } from "@workos-inc/node";
import { decodeJwt, createLocalJWKSet, jwtVerify } from "jose";
import { startProvider } from "../src/provider.ts";
const fixture = (sessionSeconds = 604800, accessTokenSeconds = 300) =>
  Effect.gen(function* () {
    const dir = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "refresh-fixture-"))),
      (ownedDir) =>
        Effect.promise(() => rm(ownedDir, { recursive: true, force: true })),
    );
    const options = {
      database: join(dir, "state.sqlite"),
      apiKey: `sk_test_local_${"58".repeat(32)}`,
      lifetimes: { sessionSeconds, accessTokenSeconds },
    };
    const acquire = () =>
      Effect.acquireRelease(
        Effect.promise(() => startProvider(options)),
        (ownedProvider) => Effect.promise(() => ownedProvider.close()),
      );
    let provider = yield* acquire();
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
    const user = yield* Effect.promise(() =>
      sdk().userManagement.createUser({
        email: "refresh@example.test",
        password: "Synthetic-password-refresh-48",
        emailVerified: true,
      }),
    );
    const signIn = () =>
      sdk().userManagement.authenticateWithPassword({
        clientId: provider.clientId,
        email: user.email,
        password: "Synthetic-password-refresh-48",
      });
    return {
      db,
      sdk,
      user,
      options,
      signIn,
      refresh: (refreshToken: string, maxRetries?: number) =>
        sdk(maxRetries).userManagement.authenticateWithRefreshToken({
          clientId: provider.clientId,
          refreshToken,
        }),
      provider: () => provider,
      stop: () => Effect.promise(() => provider.close()),
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
const invalid = (error: unknown) =>
  error instanceof Error && "error" in error && error.error === "invalid_grant";
it.live(
  "refresh rotation returns identical concurrent/restart replay through the actual fixed thirty-second grace",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const original = yield* Effect.promise(f.signIn);
      const started = performance.now();
      const pairs = yield* Effect.promise(() =>
        Promise.all([1, 2, 3].map(() => f.refresh(original.refreshToken))),
      );
      assert.ok(pairs[0].refreshToken !== original.refreshToken);
      assert.deepEqual(pairs[1], pairs[0]);
      assert.deepEqual(pairs[2], pairs[0]);
      const bytes = yield* Effect.promise(() => readFile(f.options.database));
      assert.equal(bytes.includes(Buffer.from(pairs[0].refreshToken)), false);
      assert.equal(bytes.includes(Buffer.from(pairs[0].accessToken)), false);
      yield* f.restart();
      assert.deepEqual(
        yield* Effect.promise(() => f.refresh(original.refreshToken)),
        pairs[0],
      );
      const expiry = Number(
        f.db.prepare("SELECT expires_at FROM refresh_replays").get()!
          .expires_at,
      );
      yield* Effect.sleep(Math.max(1, expiry - Date.now() + 1250));
      assert.ok(performance.now() - started >= 30000);
      // No HTTP request may account for this deletion: the scoped idle worker must.
      assert.equal(
        f.db.prepare("SELECT COUNT(*) AS n FROM refresh_replays").get()?.n,
        0,
      );
      yield* Effect.promise(() =>
        assert.rejects(f.refresh(original.refreshToken), invalid),
      );
      const next = yield* Effect.promise(() =>
        f.refresh(pairs[0].refreshToken),
      );
      assert.ok(next.refreshToken !== pairs[0].refreshToken);
    }),
  45000,
);
it.live(
  "absolute session expiry overrides replay and bounds refreshed JWT expiry without extending the session",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture(3, 2);
      const original = yield* Effect.promise(f.signIn);
      const sid = decodeJwt(original.accessToken).sid as string;
      const expiry = Number(
        f.db.prepare("SELECT expires_at FROM sessions WHERE id=?").get(sid)!
          .expires_at,
      );
      yield* Effect.sleep(1100);
      const rotated = yield* Effect.promise(() =>
        f.refresh(original.refreshToken),
      );
      assert.equal(
        Number(
          f.db.prepare("SELECT expires_at FROM sessions WHERE id=?").get(sid)!
            .expires_at,
        ),
        expiry,
      );
      assert.ok(decodeJwt(rotated.accessToken).exp! * 1000 <= expiry);
      yield* Effect.sleep(Math.max(1, expiry - Date.now() + 100));
      yield* f.restart();
      for (const token of [original.refreshToken, rotated.refreshToken]) {
        yield* Effect.promise(() => assert.rejects(f.refresh(token), invalid));
      }
      assert.equal(
        f.db.prepare("SELECT COUNT(*) AS n FROM refresh_replays").get()?.n,
        0,
      );
    }),
);
it.live(
  "replay janitor stops with its provider scope and startup prunes before requests",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const original = yield* Effect.promise(f.signIn);
      yield* Effect.promise(() => f.refresh(original.refreshToken));
      yield* f.stop();
      // Past timestamp isolates cleanup lifecycle, not a substitute for real grace proof.
      f.db
        .prepare("UPDATE refresh_replays SET expires_at=?")
        .run(Date.now() - 1);
      yield* Effect.sleep(1150);
      assert.equal(
        f.db.prepare("SELECT COUNT(*) AS n FROM refresh_replays").get()?.n,
        1,
      );
      yield* f.restart();
      assert.equal(
        f.db.prepare("SELECT COUNT(*) AS n FROM refresh_replays").get()?.n,
        0,
      );
    }),
);

it.live(
  "concurrent reset or revocation wins over both refresh generations",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      for (const action of ["reset", "revoke"]) {
        const original = yield* Effect.promise(f.signIn);
        const reset =
          action === "reset"
            ? yield* Effect.promise(() =>
                f
                  .sdk()
                  .userManagement.createPasswordReset({ email: f.user.email }),
              )
            : null;
        const outcomes = yield* Effect.promise(() =>
          Promise.allSettled([
            f.refresh(original.refreshToken),
            reset !== null
              ? f.sdk().userManagement.resetPassword({
                  token: reset.passwordResetToken,
                  newPassword: "Synthetic-password-refresh-48",
                })
              : f.sdk().userManagement.revokeSession({
                  sessionId: decodeJwt(original.accessToken).sid as string,
                }),
          ]),
        );
        assert.equal(outcomes[1].status, "fulfilled");
        yield* Effect.promise(() =>
          assert.rejects(f.refresh(original.refreshToken), invalid),
        );
        const refresh = outcomes[0];
        if (
          refresh.status === "fulfilled" &&
          refresh.value &&
          "refreshToken" in refresh.value
        ) {
          yield* Effect.promise(() =>
            assert.rejects(
              f.refresh(refresh.value.refreshToken as string),
              invalid,
            ),
          );
        } else if (refresh.status === "rejected") {
          assert.ok(invalid(refresh.reason));
        }
        assert.equal(
          f.db.prepare("SELECT COUNT(*) AS n FROM refresh_replays").get()?.n,
          0,
        );
      }
    }),
);

it.live(
  "replay storage has a hard capacity without evicting promised grace results",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const original = yield* Effect.promise(f.signIn);
      let current = original;
      let first = original;
      for (let i = 0; i < 256; i++) {
        current = yield* Effect.promise(() => f.refresh(current.refreshToken));
        if (i === 0) {
          first = current;
        }
      }
      assert.equal(
        f.db.prepare("SELECT COUNT(*) AS n FROM refresh_replays").get()?.n,
        256,
      );
      // Only this expected429 suppresses SDK backoff; no global retry override.
      yield* Effect.promise(() =>
        assert.rejects(
          f.refresh(current.refreshToken, 0),
          (error: unknown) =>
            error instanceof Error && "status" in error && error.status === 429,
        ),
      );
      assert.deepEqual(
        yield* Effect.promise(() => f.refresh(original.refreshToken)),
        first,
      );
      yield* Effect.promise(() =>
        f.sdk().userManagement.revokeSession({
          sessionId: decodeJwt(original.accessToken).sid as string,
        }),
      );
      assert.equal(
        f.db.prepare("SELECT COUNT(*) AS n FROM refresh_replays").get()?.n,
        0,
      );
    }),
  15000,
);

it.live(
  "revocation/reset/clear override replay; encrypted result tampering fails closed",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const original = yield* Effect.promise(f.signIn);
      const originalHash = f.db
        .prepare("SELECT refresh_hash FROM sessions")
        .get()!.refresh_hash;
      f.db.exec(
        "CREATE TRIGGER reject_replay BEFORE INSERT ON refresh_replays BEGIN SELECT RAISE(ABORT, 'synthetic-sensitive-replay'); END",
      );
      yield* Effect.promise(() =>
        assert.rejects(
          f.refresh(original.refreshToken, 0),
          (error: unknown) => {
            assert.ok(
              error instanceof Error &&
                !error.message.includes("synthetic-sensitive-replay"),
            );
            return "status" in error && error.status === 500;
          },
        ),
      );
      assert.equal(
        f.db.prepare("SELECT refresh_hash FROM sessions").get()!.refresh_hash,
        originalHash,
      );
      f.db.exec("DROP TRIGGER reject_replay");
      const rotated = yield* Effect.promise(() =>
        f.refresh(original.refreshToken),
      );
      const saved = String(
        f.db.prepare("SELECT encrypted_result FROM refresh_replays").get()!
          .encrypted_result,
      );
      f.db
        .prepare("UPDATE refresh_replays SET encrypted_result=?")
        .run("invalid-ciphertext");
      yield* Effect.promise(() =>
        assert.rejects(
          f.refresh(original.refreshToken, 0),
          (error: unknown) =>
            error instanceof Error && "status" in error && error.status === 500,
        ),
      );
      f.db.prepare("UPDATE refresh_replays SET encrypted_result=?").run(saved);
      const deadline = Number(
        f.db.prepare("SELECT expires_at FROM refresh_replays").get()!
          .expires_at,
      );
      f.db
        .prepare("UPDATE refresh_replays SET expires_at=expires_at+1000")
        .run();
      yield* Effect.promise(() =>
        assert.rejects(
          f.refresh(original.refreshToken, 0),
          (error: unknown) =>
            error instanceof Error && "status" in error && error.status === 500,
        ),
      );
      f.db.prepare("UPDATE refresh_replays SET expires_at=?").run(deadline);
      yield* Effect.promise(() =>
        f.sdk().userManagement.revokeSession({
          sessionId: decodeJwt(original.accessToken).sid as string,
        }),
      );
      for (const token of [original.refreshToken, rotated.refreshToken]) {
        yield* Effect.promise(() => assert.rejects(f.refresh(token), invalid));
      }
      assert.equal(
        f.db.prepare("SELECT COUNT(*) AS n FROM refresh_replays").get()?.n,
        0,
      );
      const second = yield* Effect.promise(f.signIn);
      const secondRotated = yield* Effect.promise(() =>
        f.refresh(second.refreshToken),
      );
      const reset = yield* Effect.promise(() =>
        f.sdk().userManagement.createPasswordReset({ email: f.user.email }),
      );
      yield* Effect.promise(() =>
        f.sdk().userManagement.resetPassword({
          token: reset.passwordResetToken,
          newPassword: "Synthetic-password-refresh-48",
        }),
      );
      yield* f.restart();
      for (const token of [second.refreshToken, secondRotated.refreshToken]) {
        yield* Effect.promise(() => assert.rejects(f.refresh(token), invalid));
      }
      const third = yield* Effect.promise(f.signIn);
      const thirdRotated = yield* Effect.promise(() =>
        f.refresh(third.refreshToken),
      );
      yield* f.clear();
      yield* f.restart();
      for (const token of [third.refreshToken, thirdRotated.refreshToken]) {
        yield* Effect.promise(() => assert.rejects(f.refresh(token), invalid));
      }
      assert.equal(
        f.db.prepare("SELECT COUNT(*) AS n FROM refresh_replays").get()?.n,
        0,
      );
    }),
);

it.live(
  "SDK deletion cascades replay and reset state, preserves other users and never reuses subjects",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const original = yield* Effect.promise(f.signIn);
      const rotated = yield* Effect.promise(() =>
        f.refresh(original.refreshToken),
      );
      const reset = yield* Effect.promise(() =>
        f.sdk().userManagement.createPasswordReset({ email: f.user.email }),
      );
      const other = yield* Effect.promise(() =>
        f.sdk().userManagement.createUser({
          email: "other@example.test",
          password: "Synthetic-password-refresh-48",
          emailVerified: true,
        }),
      );
      const jwks = yield* Effect.promise(async () =>
        (
          await fetch(
            `http://127.0.0.1:${f.provider().port}/sso/jwks/${f.provider().clientId}`,
          )
        ).json(),
      );
      const target = `http://127.0.0.1:${f.provider().port}/user_management/users/${f.user.id}`;
      const unauthorized = yield* Effect.promise(() =>
        fetch(target, { method: "DELETE" }),
      );
      assert.equal(unauthorized.status, 401);
      const alias = yield* Effect.promise(() =>
        fetch(target.replace("/users/", "/%75sers/"), {
          method: "DELETE",
          headers: { Authorization: `Bearer ${f.options.apiKey}` },
        }),
      );
      assert.equal(alias.status, 404);
      f.db.exec(
        "CREATE TRIGGER reject_delete AFTER DELETE ON users BEGIN SELECT RAISE(ABORT, 'synthetic-private-delete'); END",
      );
      yield* Effect.promise(() =>
        assert.rejects(
          f.sdk(0).userManagement.deleteUser(f.user.id),
          (e: unknown) =>
            e instanceof Error &&
            !e.message.includes("synthetic-private-delete") &&
            "status" in e &&
            e.status === 500,
        ),
      );
      assert.equal(
        f.db.prepare("SELECT COUNT(*) AS n FROM refresh_replays").get()?.n,
        1,
      );
      assert.deepEqual(
        yield* Effect.promise(() => f.refresh(original.refreshToken)),
        rotated,
      );
      f.db.exec("DROP TRIGGER reject_delete");
      yield* Effect.promise(() => f.sdk().userManagement.deleteUser(f.user.id));
      yield* f.restart();
      for (const token of [original.refreshToken, rotated.refreshToken]) {
        yield* Effect.promise(() => assert.rejects(f.refresh(token), invalid));
      }
      yield* Effect.promise(() =>
        assert.rejects(
          f.sdk().userManagement.resetPassword({
            token: reset.passwordResetToken,
            newPassword: "Synthetic-password-refresh-49",
          }),
        ),
      );
      yield* Effect.promise(() =>
        assert.rejects(
          f.sdk().userManagement.deleteUser(f.user.id),
          (e: unknown) =>
            e instanceof Error && "status" in e && e.status === 404,
        ),
      );
      assert.equal(
        (yield* Effect.promise(() => f.sdk().userManagement.getUser(other.id)))
          .id,
        other.id,
      );
      for (const table of ["sessions", "challenges", "refresh_replays"]) {
        assert.equal(
          f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n,
          0,
        );
      }
      const replacement = yield* Effect.promise(() =>
        f.sdk().userManagement.createUser({
          email: f.user.email,
          password: "Synthetic-password-refresh-48",
          emailVerified: true,
        }),
      );
      assert.notEqual(replacement.id, f.user.id);
      const verified = yield* Effect.promise(() =>
        jwtVerify(original.accessToken, createLocalJWKSet(jwks), {
          issuer: f.provider().issuer,
          audience: f.provider().clientId,
        }),
      );
      assert.equal(verified.payload.sub, f.user.id); // Provider deletion is not immediate JWT/Convex/device erasure.
    }),
);
it.live(
  "valid ciphertext swapped between live replay rows fails closed without losing legitimate current tokens",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const originals = yield* Effect.promise(() =>
        Promise.all([f.signIn(), f.signIn()]),
      );
      const rotated = yield* Effect.promise(() =>
        Promise.all(originals.map((pair) => f.refresh(pair.refreshToken))),
      );
      const rows = f.db
        .prepare(
          "SELECT old_hash, encrypted_result FROM refresh_replays ORDER BY old_hash",
        )
        .all();
      assert.equal(rows.length, 2);
      f.db
        .prepare(
          "UPDATE refresh_replays SET encrypted_result=? WHERE old_hash=?",
        )
        .run(rows[1].encrypted_result!, rows[0].old_hash!);
      f.db
        .prepare(
          "UPDATE refresh_replays SET encrypted_result=? WHERE old_hash=?",
        )
        .run(rows[0].encrypted_result!, rows[1].old_hash!);
      yield* f.restart();
      for (const pair of originals) {
        yield* Effect.promise(() =>
          assert.rejects(
            f.refresh(pair.refreshToken, 0),
            (e: unknown) =>
              e instanceof Error && "status" in e && e.status === 500,
          ),
        );
      }
      for (const pair of rotated) {
        yield* Effect.promise(() => f.refresh(pair.refreshToken));
      }
    }),
);
it.live(
  "owner revoke-all is user-bound and atomic for present sessions while later sign-in remains allowed",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const originals = yield* Effect.promise(() =>
        Promise.all([f.signIn(), f.signIn()]),
      );
      const rotated = yield* Effect.promise(() =>
        Promise.all(originals.map((pair) => f.refresh(pair.refreshToken))),
      );
      const other = yield* Effect.promise(() =>
        f.sdk().userManagement.createUser({
          email: "other@example.test",
          password: "Synthetic-password-refresh-48",
          emailVerified: true,
        }),
      );
      const otherSession = yield* Effect.promise(() =>
        f.sdk().userManagement.authenticateWithPassword({
          clientId: f.provider().clientId,
          email: other.email,
          password: "Synthetic-password-refresh-48",
        }),
      );
      const confirmation = {
        operation: "revoke-user-sessions",
        database: f.options.database,
        providerGeneration: f.provider().providerGeneration,
        userId: f.user.id,
      };
      for (const input of [
        undefined,
        { ...confirmation, userId: "invalid" },
        { ...confirmation, database: "/foreign" },
        { ...confirmation, providerGeneration: "foreign" },
      ]) {
        yield* Effect.promise(() =>
          assert.rejects(f.provider().revokeUserSessions(input)),
        );
        assert.equal(
          f.db.prepare("SELECT COUNT(*) AS n FROM sessions").get()?.n,
          3,
        );
      }
      f.db.exec(
        "CREATE TRIGGER reject_revoke AFTER DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'synthetic-private'); END",
      );
      yield* Effect.promise(() =>
        assert.rejects(
          f.provider().revokeUserSessions(confirmation),
          (e: unknown) =>
            e instanceof Error && !e.message.includes("synthetic-private"),
        ),
      );
      assert.equal(
        f.db.prepare("SELECT COUNT(*) AS n FROM refresh_replays").get()?.n,
        2,
      );
      f.db.exec("DROP TRIGGER reject_revoke");
      const savedIdentity = f.db
        .prepare("SELECT body FROM instance WHERE id=1")
        .get()!.body!;
      f.db.prepare("UPDATE instance SET body=? WHERE id=1").run("{}");
      yield* Effect.promise(() =>
        assert.rejects(f.provider().revokeUserSessions(confirmation)),
      );
      assert.equal(
        f.db.prepare("SELECT COUNT(*) AS n FROM sessions").get()?.n,
        3,
      );
      f.db.prepare("UPDATE instance SET body=? WHERE id=1").run(savedIdentity);
      const result = yield* Effect.promise(() =>
        f.provider().revokeUserSessions(confirmation),
      );
      assert.equal(result.issuedAccessTokens, "valid-until-expiry");
      yield* f.restart();
      for (const pair of [...originals, ...rotated]) {
        yield* Effect.promise(() =>
          assert.rejects(f.refresh(pair.refreshToken), invalid),
        );
      }
      assert.equal(
        f.db.prepare("SELECT COUNT(*) AS n FROM refresh_replays").get()?.n,
        0,
      );
      yield* Effect.promise(() => f.refresh(otherSession.refreshToken));
      const later = yield* Effect.promise(f.signIn);
      yield* Effect.promise(() => f.refresh(later.refreshToken));
    }),
);

it.live(
  "concurrent refresh versus owner revocation or SDK deletion leaves no surviving token generation",
  () =>
    Effect.gen(function* () {
      for (const operation of ["revoke", "delete"]) {
        const f = yield* fixture();
        const original = yield* Effect.promise(f.signIn);
        const outcomes = yield* Effect.promise(() =>
          Promise.allSettled([
            f.refresh(original.refreshToken),
            operation === "delete"
              ? f.sdk().userManagement.deleteUser(f.user.id)
              : f.provider().revokeUserSessions({
                  operation: "revoke-user-sessions",
                  database: f.options.database,
                  providerGeneration: f.provider().providerGeneration,
                  userId: f.user.id,
                }),
          ]),
        );
        assert.equal(outcomes[1].status, "fulfilled");
        yield* Effect.promise(() =>
          assert.rejects(f.refresh(original.refreshToken), invalid),
        );
        const refresh = outcomes[0];
        if (
          refresh.status === "fulfilled" &&
          refresh.value &&
          "refreshToken" in refresh.value
        ) {
          yield* Effect.promise(() =>
            assert.rejects(
              f.refresh(refresh.value.refreshToken as string),
              invalid,
            ),
          );
        } else if (refresh.status === "rejected") {
          assert.ok(invalid(refresh.reason));
        }
        for (const table of ["sessions", "refresh_replays"]) {
          assert.equal(
            f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n,
            0,
          );
        }
      }
    }),
);
