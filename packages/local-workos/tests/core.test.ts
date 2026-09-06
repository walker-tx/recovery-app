import { DatabaseSync } from "node:sqlite";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkOS } from "@workos-inc/node";
import { createLocalJWKSet, jwtVerify } from "jose";
import { startProvider } from "../src/provider.ts";
it.live(
  "SDK core persists identities, rejects credentials, signs verified sessions",
  () =>
    Effect.gen(function* () {
      const dir = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "local-workos-"))),
        (dir) =>
          Effect.promise(() => rm(dir, { recursive: true, force: true })),
      );
      const options = {
        database: join(dir, "state.sqlite"),
        apiKey: "sk_test_synthetic",
      };
      let provider = yield* Effect.acquireRelease(
        Effect.promise(() => startProvider(options)),
        (provider) => Effect.promise(() => provider.close()),
      );
      const sdk = () =>
        new WorkOS(options.apiKey, {
          apiHostname: "127.0.0.1",
          port: provider.port,
          https: false,
        });
      yield* Effect.promise(() =>
        assert.rejects(
          sdk().userManagement.createUser({
            email: "short@example.test",
            password: "shortpass",
          }),
        ),
      );
      const unverifiedUser = yield* Effect.promise(() =>
        sdk().userManagement.createUser({
          email: "person@example.test",
          password: "Synthetic-password-42",
        }),
      );
      assert.equal(unverifiedUser.emailVerified, false);
      const matchingUsers = yield* Effect.promise(() =>
        sdk().userManagement.listUsers({ email: unverifiedUser.email }),
      );
      assert.equal(matchingUsers.data[0]?.id, unverifiedUser.id);
      const userIdentities = yield* Effect.promise(() =>
        sdk().userManagement.getUserIdentities(unverifiedUser.id),
      );
      assert.deepEqual(userIdentities, []);
      yield* Effect.promise(() =>
        assert.rejects(
          sdk().userManagement.authenticateWithPassword({
            clientId: provider.clientId,
            email: unverifiedUser.email,
            password: "wrong",
          }),
        ),
      );
      yield* Effect.promise(() =>
        assert.rejects(
          sdk().userManagement.authenticateWithPassword({
            clientId: provider.clientId,
            email: unverifiedUser.email,
            password: "Synthetic-password-42",
          }),
          (e: any) => e.code === "email_verification_required",
        ),
      );
      yield* Effect.promise(() =>
        assert.rejects(
          sdk().userManagement.authenticateWithPassword({
            clientId: "wrong",
            email: unverifiedUser.email,
            password: "Synthetic-password-42",
          }),
        ),
      );
      yield* Effect.promise(() =>
        assert.rejects(
          new WorkOS("wrong", {
            apiHostname: "127.0.0.1",
            port: provider.port,
            https: false,
          }).userManagement.listUsers(),
        ),
      );
      const verifiedUser = yield* Effect.promise(() =>
        sdk().userManagement.createUser({
          email: "verified@example.test",
          password: "Synthetic-password-42",
          emailVerified: true,
        }),
      );
      const session = yield* Effect.promise(() =>
        sdk().userManagement.authenticateWithPassword({
          clientId: provider.clientId,
          email: verifiedUser.email,
          password: "Synthetic-password-42",
        }),
      );
      const jwks = yield* Effect.promise(async () =>
        (
          await fetch(
            `http://127.0.0.1:${provider.port}/sso/jwks/${provider.clientId}`,
          )
        ).json(),
      );
      const { payload } = yield* Effect.promise(() =>
        jwtVerify(session.accessToken, createLocalJWKSet(jwks), {
          issuer: provider.issuer,
          audience: provider.clientId,
        }),
      );
      assert.equal(payload.sub, verifiedUser.id);
      assert.equal(payload.client_id, provider.clientId);
      assert.ok(payload.sid);
      assert.equal(payload.exp! - payload.iat!, 300);
      yield* Effect.promise(() =>
        assert.rejects(
          jwtVerify(session.accessToken, createLocalJWKSet(jwks), {
            currentDate: new Date((payload.exp! + 1) * 1000),
          }),
        ),
      );
      const databaseInspection = new DatabaseSync(options.database);
      const stored = databaseInspection
        .prepare("SELECT * FROM sessions WHERE id=?")
        .get(payload.sid as string)!;
      assert.ok(
        Math.abs(Number(stored.expires_at) - Date.now() - 7 * 86400000) < 5000,
      );
      assert.ok(
        !JSON.stringify(
          databaseInspection.prepare("SELECT * FROM users").all(),
        ).includes("Synthetic-password-42"),
      );
      assert.ok(!JSON.stringify(stored).includes(session.refreshToken));
      databaseInspection.close();
      const issuer = provider.issuer;
      yield* Effect.promise(() => provider.close());
      provider = yield* Effect.acquireRelease(
        Effect.promise(() => startProvider(options)),
        (provider) => Effect.promise(() => provider.close()),
      );
      const reopenedDatabase = new DatabaseSync(options.database);
      assert.deepEqual(
        reopenedDatabase
          .prepare("SELECT * FROM sessions WHERE id=?")
          .get(payload.sid as string),
        stored,
      );
      reopenedDatabase.close();
      assert.equal(provider.issuer, issuer);
      const persistedUser = yield* Effect.promise(() =>
        sdk().userManagement.getUser(unverifiedUser.id),
      );
      assert.equal(persistedUser.id, unverifiedUser.id);
      yield* Effect.promise(async () =>
        jwtVerify(
          session.accessToken,
          createLocalJWKSet(
            await (
              await fetch(
                `http://127.0.0.1:${provider.port}/sso/jwks/${provider.clientId}`,
              )
            ).json(),
          ),
        ),
      );
      const sibling = yield* Effect.acquireRelease(
        Effect.promise(() =>
          startProvider({ ...options, database: join(dir, "sibling.sqlite") }),
        ),
        (provider) => Effect.promise(() => provider.close()),
      );
      assert.notEqual(sibling.issuer, provider.issuer);
      const siblingSdk = new WorkOS(options.apiKey, {
        apiHostname: "127.0.0.1",
        port: sibling.port,
        https: false,
      });
      const siblingUsers = yield* Effect.promise(() =>
        siblingSdk.userManagement.listUsers(),
      );
      assert.equal(siblingUsers.data.length, 0);
      yield* Effect.promise(() =>
        assert.rejects(siblingSdk.userManagement.getUser(unverifiedUser.id)),
      );
    }),
);
