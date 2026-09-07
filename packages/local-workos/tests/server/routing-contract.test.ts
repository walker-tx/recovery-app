import { it } from "@effect/vitest";
import { Data, Effect, Schema } from "effect";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startProvider } from "../../src/server/provider.ts";

const fixture = Effect.gen(function* () {
  const dir = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "workos-routing-"))),
    (resource) =>
      Effect.promise(() => rm(resource, { recursive: true, force: true })),
  );
  const apiKey = `sk_test_local_${"06".repeat(32)}`;
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

class RawRequestError extends Data.TaggedError("RawRequestError")<{
  cause: unknown;
}> {}

// node:http sends `path` verbatim; fetch removes dot segments before the wire.
function rawRequest(
  base: string,
  path: string,
  headers: Record<string, string>,
) {
  return Effect.callback<{ status: number; body: string }, RawRequestError>(
    (resume) => {
      const reject = (error: Error) =>
        resume(Effect.fail(new RawRequestError({ cause: error })));
      const req = request(base, { path, headers }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resume(Effect.succeed({ status: response.statusCode!, body }));
        });
        response.on("error", reject);
      });
      req.setTimeout(5000, () =>
        req.destroy(new RawRequestError({ cause: "Request timed out" })),
      );
      req.on("error", reject);
      req.end();
      return Effect.sync(() => {
        req.destroy();
      });
    },
  ).pipe(
    Effect.flatMap((response) =>
      Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown))(
        response.body,
      ).pipe(Effect.map((body) => ({ status: response.status, body }))),
    ),
  );
}

for (const path of [
  "/instance-info/",
  "/INSTANCE-INFO",
  "/%69nstance-info",
  "/prefix/../instance-info",
  "/prefix/%2e%2e/instance-info",
  "/%2e/instance-info",
  "/./instance-info",
  "//instance-info",
  "/prefix//../instance-info?ignored=1",
]) {
  it.live(`does not normalize public path ${path}`, () =>
    Effect.gen(function* () {
      const { base, headers } = yield* fixture;
      for (const authorized of [false, true]) {
        const response = yield* rawRequest(
          base,
          path,
          authorized ? headers : {},
        );
        const code = authorized ? "unsupported_operation" : "unauthorized";
        assert.equal(response.status, authorized ? 404 : 401);
        assert.deepEqual(response.body, {
          code,
          message: code,
        });
      }
    }),
  );
}

for (const kind of ["encoded", "long", "dot", "encoded-dot"] as const) {
  it.live(`user lookup preserves ${kind} raw identifiers`, () =>
    Effect.gen(function* () {
      const { provider, base, headers } = yield* fixture;
      const user = yield* Effect.promise(() =>
        provider.createIdentityFixture({
          email: "routing@example.test",
          provider: "GoogleOAuth",
        }),
      );
      const id =
        kind === "encoded"
          ? user.id.replace("user_", "%75ser_")
          : kind === "dot"
            ? ".."
            : kind === "encoded-dot"
              ? "%2e%2e"
              : "x".repeat(101);
      for (const suffix of ["", "/identities"]) {
        const response = yield* rawRequest(
          base,
          `/user_management/users/${id}${suffix}`,
          headers,
        );
        assert.equal(response.status, 404);
        assert.deepEqual(response.body, {
          code: "not_found",
          message: "not_found",
        });
      }
    }),
  );
}

it.live("HEAD retains unsupported routing and bearer precedence", () =>
  Effect.gen(function* () {
    const { base, headers } = yield* fixture;
    for (const path of [
      "/instance-info",
      "/user_management/users",
      "/missing",
    ]) {
      for (const authorized of [false, true]) {
        const response = yield* HttpClient.head(base + path, {
          headers: authorized ? headers : {},
        });
        assert.equal(response.status, authorized ? 404 : 401);
        assert.equal(yield* response.text, "");
      }
    }
  }).pipe(
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- The live test is the HTTP client layer entry point.
    Effect.provide(FetchHttpClient.layer),
  ),
);

it.live("raw dot segments cannot normalize user lookup", () =>
  Effect.gen(function* () {
    const { provider, base, headers } = yield* fixture;
    const user = yield* Effect.promise(() =>
      provider.createIdentityFixture({
        email: "dot@example.test",
        provider: "GoogleOAuth",
      }),
    );
    for (const dot of ["..", "%2e%2e", ".%2E", "%2e."]) {
      for (const suffix of ["", "/identities"]) {
        const response = yield* rawRequest(
          base,
          `/user_management/users/prefix/${dot}/${user.id}${suffix}`,
          headers,
        );
        assert.equal(response.status, 404);
        assert.deepEqual(response.body, {
          code: "unsupported_operation",
          message: "unsupported_operation",
        });
      }
    }
  }),
);

it.live("canonical raw paths ignore query dot segments", () =>
  Effect.gen(function* () {
    const { provider, base, headers } = yield* fixture;
    const user = yield* Effect.promise(() =>
      provider.createIdentityFixture({
        email: "query@example.test",
        provider: "GoogleOAuth",
      }),
    );
    const info = yield* rawRequest(base, "/instance-info?path=/../%2e%2e", {});
    assert.equal(info.status, 200);
    const response = yield* rawRequest(
      base,
      `/user_management/users/${user.id}?path=/../%2e%2e`,
      headers,
    );
    assert.equal(response.status, 200);
    assert.ok(
      typeof response.body === "object" &&
        response.body !== null &&
        "id" in response.body,
    );
    assert.equal(response.body.id, user.id);
  }),
);
