import { DatabaseSync } from "node:sqlite";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuthenticationException, WorkOS } from "@workos-inc/node";
import { startProvider } from "../src/provider.ts";

it.live(
  "SDK verification challenge is gateway-shaped, distinct, persistent and protected",
  () =>
    Effect.gen(function* () {
      const dir = yield* Effect.acquireRelease(
        Effect.promise(() =>
          mkdtemp(join(tmpdir(), "local-workos-verification-")),
        ),
        (ownedDir) =>
          Effect.promise(() => rm(ownedDir, { recursive: true, force: true })),
      );
      const options = {
        database: join(dir, "state.sqlite"),
        apiKey: `sk_test_local_${"48".repeat(32)}`,
      };
      const acquire = () =>
        Effect.acquireRelease(
          Effect.promise(() => startProvider(options)),
          (ownedProvider) => Effect.promise(() => ownedProvider.close()),
        );
      let provider = yield* acquire();
      const sdk = () =>
        new WorkOS(options.apiKey, {
          apiHostname: "127.0.0.1",
          port: provider.port,
          https: false,
        });
      const user = yield* Effect.promise(() =>
        sdk().userManagement.createUser({
          email: "verification@example.test",
          password: "Synthetic-password-48",
        }),
      );
      const challenge = () =>
        Effect.promise(async () => {
          try {
            await sdk().userManagement.authenticateWithPassword({
              clientId: provider.clientId,
              email: user.email,
              password: "Synthetic-password-48",
            });
            assert.fail("unverified user must not receive a session");
          } catch (error) {
            assert.ok(error instanceof AuthenticationException);
            assert.equal(error.code, "email_verification_required");
            assert.equal(error.status, 400);
            assert.equal(error.message, "Email verification required");
            assert.equal(
              error.rawData.pending_authentication_token,
              error.pendingAuthenticationToken,
            );
            assert.equal(typeof error.pendingAuthenticationToken, "string");
            assert.ok(error.pendingAuthenticationToken!.length >= 32);
            assert.equal(typeof error.rawData.email_verification_id, "string");
            return {
              id: error.rawData.email_verification_id as string,
              pending: error.pendingAuthenticationToken,
            };
          }
        });
      const db = yield* Effect.acquireRelease(
        Effect.sync(() => new DatabaseSync(options.database)),
        (ownedDb) => Effect.sync(() => ownedDb.close()),
      );
      yield* Effect.promise(() =>
        assert.rejects(
          sdk().userManagement.authenticateWithPassword({
            clientId: provider.clientId,
            email: user.email,
            password: "wrong",
          }),
        ),
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS n FROM challenges").get()?.n,
        0,
      );
      // Recreate the #47 schema shape in this owned fixture before upgrading it.
      yield* Effect.promise(() => provider.close());
      db.exec("DROP TABLE email_verifications");
      db.prepare("INSERT INTO challenges VALUES(?,?,?,?)").run(
        "legacy_challenge",
        user.id,
        "legacy_digest",
        Date.now() + 600_000,
      );
      provider = yield* acquire();
      assert.equal(
        db.prepare("SELECT COUNT(*) AS n FROM challenges").get()?.n,
        1,
      );
      const first = yield* challenge();
      const second = yield* challenge();
      assert.notEqual(first.id, second.id);
      assert.notEqual(first.pending, second.pending);
      const verification = yield* Effect.promise(() =>
        sdk().userManagement.getEmailVerification(first.id),
      );
      assert.equal(verification.object, "email_verification");
      assert.equal(verification.id, first.id);
      assert.equal(verification.userId, user.id);
      assert.equal(verification.email, user.email);
      assert.match(verification.code, /^\d{6}$/);
      assert.equal(
        Date.parse(verification.expiresAt) - Date.parse(verification.createdAt),
        600_000,
      );
      assert.equal(verification.updatedAt, verification.createdAt);
      const unauthorized = yield* Effect.promise(() =>
        fetch(
          `http://127.0.0.1:${provider.port}/user_management/email_verification/${first.id}`,
        ),
      );
      assert.equal(unauthorized.status, 401);
      const encodedPath = yield* Effect.promise(() =>
        fetch(
          `http://127.0.0.1:${provider.port}/user_management/%65mail_verification/${first.id}`,
          { headers: { Authorization: `Bearer ${options.apiKey}` } },
        ),
      );
      assert.equal(encodedPath.status, 404);
      yield* Effect.promise(() => provider.close());
      provider = yield* acquire();
      assert.deepEqual(
        yield* Effect.promise(() =>
          sdk().userManagement.getEmailVerification(first.id),
        ),
        verification,
      );
      yield* Effect.promise(() =>
        assert.rejects(
          sdk().userManagement.getEmailVerification("missing"),
          (error: unknown) =>
            error instanceof Error && "status" in error && error.status === 404,
        ),
      );
      // Past-timestamp fixture covers rejection, not actual elapsed expiry.
      db.prepare("UPDATE challenges SET expires_at=? WHERE id=?").run(
        Date.now() - 1,
        second.id,
      );
      yield* Effect.promise(() =>
        assert.rejects(sdk().userManagement.getEmailVerification(second.id)),
      );
      yield* Effect.promise(() =>
        provider.clearData({
          operation: "clear-provider-data",
          database: options.database,
          providerGeneration: provider.providerGeneration,
          affectedDomains: ["users", "sessions", "challenges"],
        }),
      );
      yield* Effect.promise(() =>
        assert.rejects(sdk().userManagement.getEmailVerification(first.id)),
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) AS n FROM email_verifications").get()?.n,
        0,
      );
    }).pipe(Effect.scoped),
);
