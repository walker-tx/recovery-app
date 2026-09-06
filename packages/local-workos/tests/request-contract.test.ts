import { it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PasswordAuthenticationRequestSchema,
  CreateUserRequestSchema,
} from "../src/http.ts";
import { startProvider } from "../src/provider.ts";

const fixture = Effect.gen(function* () {
  const dir = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "workos-request-"))),
    (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
  );
  const apiKey = "sk_test_SENTINEL_KEY";
  const provider = yield* Effect.acquireRelease(
    Effect.promise(() =>
      startProvider({ database: join(dir, "state.sqlite"), apiKey }),
    ),
    (provider) => Effect.promise(() => provider.close()),
  );
  return {
    provider,
    base: `http://127.0.0.1:${provider.port}`,
    headers: { authorization: `Bearer ${apiKey}` },
  };
});

it.live("request validation preserves ordering and never echoes secrets", () =>
  Effect.gen(function* () {
    const { provider, base, headers } = yield* fixture;
    const password = "SENTINEL_PASSWORD_12345";
    const auth = {
      client_id: provider.clientId,
      client_secret: "sk_test_SENTINEL_KEY",
      grant_type: "password",
      email: "request@example.test",
      password,
    };
    const cases: {
      path: string;
      body: unknown;
      authorized: boolean;
      status: number;
      code: string;
    }[] = [
      {
        path: "authenticate",
        body: [],
        authorized: false,
        status: 422,
        code: "invalid_request",
      },
      {
        path: "authenticate",
        body: {
          ...auth,
          client_secret: "wrong",
          grant_type: "other",
          password: 123,
        },
        authorized: false,
        status: 401,
        code: "invalid_client",
      },
      {
        path: "authenticate",
        body: { ...auth, grant_type: "other", password: 123 },
        authorized: false,
        status: 400,
        code: "unsupported_grant_type",
      },
      ...[null, 123, {}, "x".repeat(1025)].map((password) => ({
        path: "authenticate",
        body: { ...auth, password },
        authorized: false,
        status: 400,
        code: "invalid_grant",
      })),
      {
        path: "authenticate",
        body: { ...auth, email: 123 },
        authorized: false,
        status: 400,
        code: "invalid_grant",
      },
      {
        path: "users",
        body: { email: 123, password },
        authorized: false,
        status: 401,
        code: "unauthorized",
      },
      {
        path: "users",
        body: null,
        authorized: false,
        status: 422,
        code: "invalid_request",
      },
      ...[
        { email: 123 },
        { password: 123 },
        { password: "short" },
        { password: "x".repeat(129) },
        { email_verified: "true" },
        { first_name: null },
        { last_name: "x".repeat(257) },
      ].map((invalid) => ({
        path: "users",
        body: { email: auth.email, password, ...invalid },
        authorized: true,
        status: 422,
        code: "invalid_user",
      })),
    ];
    for (const test of cases) {
      const response = yield* Effect.promise(() =>
        fetch(`${base}/user_management/${test.path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(test.authorized ? headers : {}),
          },
          body: JSON.stringify(test.body),
        }),
      );
      const text = yield* Effect.promise(() => response.text());
      assert.equal(response.status, test.status, text);
      const result = JSON.parse(text);
      assert.equal(result.code ?? result.error, test.code);
      assert.ok(!text.includes(password));
      assert.ok(!text.includes("sk_test_SENTINEL_KEY"));
    }
  }),
);

it.live("declared schemas validate supported request fields", () =>
  Effect.sync(() => {
    assert.equal(
      Schema.decodeUnknownSync(PasswordAuthenticationRequestSchema)({
        client_id: "client",
        client_secret: "key",
        grant_type: "password",
        email: "valid@example.test",
        password: "SENTINEL_PASSWORD_12345",
        invitation_token: "ignored-sdk-field",
      }).grant_type,
      "password",
    );
    assert.equal(
      Schema.decodeUnknownSync(CreateUserRequestSchema)({
        email: " valid@example.test ",
        password: "😀".repeat(128),
        metadata: { ignored: "sdk-field" },
      }).password,
      "😀".repeat(128),
    );
    assert.equal(
      Schema.decodeUnknownSync(CreateUserRequestSchema)({
        email: "valid@example.test",
        password: "SENTINEL_PASSWORD_12345",
      }).email,
      "valid@example.test",
    );
    assert.throws(() =>
      Schema.decodeUnknownSync(PasswordAuthenticationRequestSchema)({
        grant_type: "password",
        client_id: "client",
        client_secret: "key",
        email: "e",
        password: 123,
      }),
    );
    assert.throws(() =>
      Schema.decodeUnknownSync(CreateUserRequestSchema)({
        email: "bad",
        password: "SENTINEL_PASSWORD_12345",
      }),
    );
  }),
);
