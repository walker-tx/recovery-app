import { it } from "@effect/vitest";
import { Effect } from "effect";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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

for (const path of ["/instance-info/", "/INSTANCE-INFO", "/%69nstance-info"]) {
  it.live(`does not normalize public path ${path}`, () =>
    Effect.gen(function* () {
      const { base, headers } = yield* fixture;
      for (const authorized of [false, true]) {
        const response = yield* Effect.promise(() =>
          fetch(base + path, { headers: authorized ? headers : {} }),
        );
        const code = authorized ? "unsupported_operation" : "unauthorized";
        assert.equal(response.status, authorized ? 404 : 401);
        assert.deepEqual(yield* Effect.promise(() => response.json()), {
          code,
          message: code,
        });
      }
    }),
  );
}

for (const kind of ["encoded", "long"] as const) {
  it.live(`user lookup preserves ${kind} raw identifiers`, () =>
    Effect.gen(function* () {
      const { provider, base, headers } = yield* fixture;
      const user = provider.createIdentityFixture({
        email: "routing@example.test",
        provider: "GoogleOAuth",
      });
      const id =
        kind === "encoded"
          ? user.id.replace("user_", "%75ser_")
          : "x".repeat(101);
      for (const suffix of ["", "/identities"]) {
        const response = yield* Effect.promise(() =>
          fetch(`${base}/user_management/users/${id}${suffix}`, { headers }),
        );
        assert.equal(response.status, 404);
        assert.deepEqual(yield* Effect.promise(() => response.json()), {
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
