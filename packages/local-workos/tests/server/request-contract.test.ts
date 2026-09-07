import { it } from "@effect/vitest";
import { Effect, Exit, Schema } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PasswordAuthenticationRequestSchema,
  CreateUserRequestSchema,
} from "../../src/server/workos-http.ts";
import { startProvider } from "../../src/server/provider.ts";
import { ResetPasswordRequestSchema } from "../../src/contracts/workos.ts";

const fixture = Effect.gen(function* () {
  const dir = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "workos-request-"))),
    (resource) =>
      Effect.promise(() => rm(resource, { recursive: true, force: true })),
  );
  const apiKey = `sk_test_local_${"04".repeat(32)}`;
  const provider = yield* Effect.acquireRelease(
    Effect.promise(() =>
      startProvider({ database: join(dir, "state.sqlite"), apiKey }),
    ),
    (resource) => Effect.promise(() => resource.close()),
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
      client_secret: `sk_test_local_${"04".repeat(32)}`,
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
      ...[null, 123, {}, "x".repeat(1025)].map((invalidPassword) => ({
        path: "authenticate",
        body: { ...auth, password: invalidPassword },
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
      const request = yield* HttpClientRequest.post(
        `${base}/user_management/${test.path}`,
        {
          headers: test.authorized ? headers : {},
        },
      ).pipe(HttpClientRequest.bodyJson(test.body));
      const response = yield* HttpClient.execute(request);
      const text = yield* response.text;
      assert.equal(response.status, test.status, text);
      const result = yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(
          Schema.Struct({
            code: Schema.optional(Schema.String),
            error: Schema.optional(Schema.String),
          }),
        ),
      )(text);
      assert.equal(result.code ?? result.error, test.code);
      assert.ok(!text.includes(password));
      assert.ok(!text.includes(`sk_test_local_${"04".repeat(32)}`));
    }
  }).pipe(
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- The live test is the HTTP client layer entry point.
    Effect.provide(FetchHttpClient.layer),
  ),
);

it.live("declared schemas validate supported request fields", () =>
  Effect.gen(function* () {
    assert.equal(
      (yield* Schema.decodeUnknownEffect(PasswordAuthenticationRequestSchema)({
        client_id: "client",
        client_secret: "key",
        grant_type: "password",
        email: "valid@example.test",
        password: "SENTINEL_PASSWORD_12345",
        invitation_token: "ignored-sdk-field",
      })).grant_type,
      "password",
    );
    assert.equal(
      (yield* Schema.decodeUnknownEffect(CreateUserRequestSchema)({
        email: " valid@example.test ",
        password: "😀".repeat(128),
        metadata: { ignored: "sdk-field" },
      })).password,
      "😀".repeat(128),
    );
    assert.equal(
      (yield* Schema.decodeUnknownEffect(CreateUserRequestSchema)({
        email: "valid@example.test",
        password: "SENTINEL_PASSWORD_12345",
      })).email,
      "valid@example.test",
    );
    assert.ok(
      Exit.isFailure(
        yield* Effect.exit(
          Schema.decodeUnknownEffect(PasswordAuthenticationRequestSchema)({
            grant_type: "password",
            client_id: "client",
            client_secret: "key",
            email: "e",
            password: 123,
          }),
        ),
      ),
    );
    assert.ok(
      Exit.isFailure(
        yield* Effect.exit(
          Schema.decodeUnknownEffect(CreateUserRequestSchema)({
            email: "bad",
            password: "SENTINEL_PASSWORD_12345",
          }),
        ),
      ),
    );
  }),
);

it.effect("create and reset share Unicode code-point password boundaries", () =>
  Effect.gen(function* () {
    for (const length of [11, 12, 128, 129]) {
      const password = "😀".repeat(length);
      const create = yield* Effect.exit(
        Schema.decodeUnknownEffect(CreateUserRequestSchema)({
          email: "unicode@example.test",
          password,
        }),
      );
      const reset = yield* Effect.exit(
        Schema.decodeUnknownEffect(ResetPasswordRequestSchema)({
          token: "synthetic-reset-token",
          new_password: password,
        }),
      );
      assert.equal(Exit.isSuccess(create), length >= 12 && length <= 128);
      assert.equal(Exit.isSuccess(reset), Exit.isSuccess(create));
    }
  }),
);
