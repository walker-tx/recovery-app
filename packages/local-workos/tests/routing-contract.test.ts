import { it } from "@effect/vitest";
import { Effect } from "effect";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startProvider } from "../src/provider.ts";

const fixture = Effect.gen(function* () {
  const dir = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "workos-routing-"))),
    (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
  );
  const apiKey = "sk_test_routing";
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

// node:http sends `path` verbatim; fetch removes dot segments before the wire.
function rawRequest(
  base: string,
  path: string,
  headers: Record<string, string>,
) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const req = request(base, { path, headers }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        try {
          resolve({ status: response.statusCode!, body: JSON.parse(body) });
        } catch (error) {
          reject(error);
        }
      });
      response.on("error", reject);
    });
    req.setTimeout(5000, () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
    req.end();
  });
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
        const response = yield* Effect.promise(() =>
          rawRequest(base, path, authorized ? headers : {}),
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
        const response = yield* Effect.promise(() =>
          rawRequest(base, `/user_management/users/${id}${suffix}`, headers),
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
        const response = yield* Effect.promise(() =>
          fetch(base + path, {
            method: "HEAD",
            headers: authorized ? headers : {},
          }),
        );
        assert.equal(response.status, authorized ? 404 : 401);
        assert.equal(yield* Effect.promise(() => response.text()), "");
      }
    }
  }),
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
        const response = yield* Effect.promise(() =>
          rawRequest(
            base,
            `/user_management/users/prefix/${dot}/${user.id}${suffix}`,
            headers,
          ),
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
    const info = yield* Effect.promise(() =>
      rawRequest(base, "/instance-info?path=/../%2e%2e", {}),
    );
    assert.equal(info.status, 200);
    const response = yield* Effect.promise(() =>
      rawRequest(
        base,
        `/user_management/users/${user.id}?path=/../%2e%2e`,
        headers,
      ),
    );
    assert.equal(response.status, 200);
    assert.equal((response.body as { id: string }).id, user.id);
  }),
);
