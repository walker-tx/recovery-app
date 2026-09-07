import { it } from "@effect/vitest";
import { Cause, Effect, Schema } from "effect";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigurationError } from "../../src/server/config.ts";
import { startProvider } from "../../src/server/provider.ts";
it.live(
  "bootstrap-owned generation and port survive restart and reject mismatched state",
  () =>
    Effect.gen(function* () {
      const dir = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "workos-startup-"))),
        (resource) =>
          Effect.promise(() => rm(resource, { recursive: true, force: true })),
      );
      const generation = randomUUID();
      const options = {
        database: join(dir, "state.sqlite"),
        apiKey: `sk_test_local_${"02".repeat(32)}`,
        providerGeneration: generation,
      };
      let provider = yield* Effect.acquireRelease(
        Effect.promise(() => startProvider(options)),
        (resource) => Effect.promise(() => resource.close()),
      );
      assert.equal(
        provider.issuer,
        `https://local-workos.invalid/instances/${generation}`,
      );
      assert.equal(provider.providerGeneration, generation);
      const infoResponse = yield* HttpClient.get(
        `http://127.0.0.1:${provider.port}/instance-info`,
      );
      assert.equal(infoResponse.status, 200);
      const info = yield* infoResponse.json;
      assert.deepEqual(info, {
        providerGeneration: generation,
        issuer: provider.issuer,
        clientId: provider.clientId,
        port: provider.port,
      });
      assert.ok(
        !(yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
          info,
        )).includes(options.apiKey),
      );
      const port = provider.port;
      yield* Effect.promise(() => provider.close());
      yield* Effect.promise(() =>
        assert.rejects(
          startProvider({ ...options, providerGeneration: randomUUID() }),
          /generation/i,
        ),
      );
      provider = yield* Effect.acquireRelease(
        Effect.promise(() => startProvider({ ...options, port })),
        (resource) => Effect.promise(() => resource.close()),
      );
      assert.equal(provider.port, port);
      assert.equal(
        provider.issuer,
        `https://local-workos.invalid/instances/${generation}`,
      );
      yield* Effect.promise(() =>
        assert.rejects(
          startProvider({ ...options, port }),
          (error: unknown) =>
            error instanceof Error &&
            error.cause instanceof Error &&
            "code" in error.cause &&
            error.cause.code === "EADDRINUSE",
        ),
      );
    }).pipe(
      // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Test entrypoint owns the HTTP client layer.
      Effect.provide(FetchHttpClient.layer),
    ),
);
it.live("invalid explicit startup generation and ports are rejected", () =>
  Effect.gen(function* () {
    const dir = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "workos-startup-invalid-"))),
      (resource) =>
        Effect.promise(() => rm(resource, { recursive: true, force: true })),
    );
    const options = {
      database: join(dir, "state.sqlite"),
      apiKey: `sk_test_local_${"02".repeat(32)}`,
    };
    const context = yield* Effect.context();
    for (const port of [-1, 65536, 0.5, NaN]) {
      yield* Effect.promise(() =>
        assert.rejects(
          Effect.runPromiseWith(context)(
            Effect.gen(function* () {
              const unexpected = yield* Effect.tryPromise(() =>
                startProvider({ ...options, port }),
              );
              yield* Effect.promise(() => unexpected.close());
            }),
          ),
          (error: unknown) => {
            assert.ok(Cause.isUnknownError(error));
            assert.ok(error.cause instanceof ConfigurationError);
            assert.match(error.cause.message, /port/i);
            return true;
          },
        ),
      );
    }
    yield* Effect.promise(() =>
      assert.rejects(
        Effect.runPromiseWith(context)(
          Effect.gen(function* () {
            const unexpected = yield* Effect.tryPromise(() =>
              startProvider({
                ...options,
                providerGeneration: "not-a-uuid",
              }),
            );
            yield* Effect.promise(() => unexpected.close());
          }),
        ),
        (error: unknown) => {
          assert.ok(Cause.isUnknownError(error));
          assert.ok(error.cause instanceof ConfigurationError);
          assert.match(error.cause.message, /generation/i);
          return true;
        },
      ),
    );
  }),
);
