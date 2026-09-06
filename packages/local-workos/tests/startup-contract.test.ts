import { it } from "@effect/vitest";
import { Effect } from "effect";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startProvider } from "../src/provider.ts";
it.live(
  "bootstrap-owned generation and port survive restart and reject mismatched state",
  () =>
    Effect.gen(function* () {
      const dir = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "workos-startup-"))),
        (dir) =>
          Effect.promise(() => rm(dir, { recursive: true, force: true })),
      );
      const generation = randomUUID();
      const options = {
        database: join(dir, "state.sqlite"),
        apiKey: "sk_test_startup",
        providerGeneration: generation,
      };
      let provider = yield* Effect.acquireRelease(
        Effect.promise(() => startProvider(options)),
        (provider) => Effect.promise(() => provider.close()),
      );
      assert.equal(
        provider.issuer,
        `https://local-workos.invalid/instances/${generation}`,
      );
      assert.equal(provider.providerGeneration, generation);
      const infoResponse = yield* Effect.promise(() =>
        fetch(`http://127.0.0.1:${provider.port}/instance-info`),
      );
      assert.equal(infoResponse.status, 200);
      const info = yield* Effect.promise(() => infoResponse.json());
      assert.deepEqual(info, {
        providerGeneration: generation,
        issuer: provider.issuer,
        clientId: provider.clientId,
        port: provider.port,
      });
      assert.ok(!JSON.stringify(info).includes(options.apiKey));
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
        (provider) => Effect.promise(() => provider.close()),
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
            (error.cause as NodeJS.ErrnoException)?.code === "EADDRINUSE",
        ),
      );
    }),
);
it.live("invalid explicit startup generation and ports are rejected", () =>
  Effect.gen(function* () {
    const dir = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "workos-startup-invalid-"))),
      (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
    );
    const options = {
      database: join(dir, "state.sqlite"),
      apiKey: "sk_test_startup",
    };
    for (const port of [-1, 65536, 0.5, NaN]) {
      yield* Effect.promise(() =>
        assert.rejects(async () => {
          const unexpected = await startProvider({ ...options, port });
          await unexpected.close();
        }, /port/i),
      );
    }
    yield* Effect.promise(() =>
      assert.rejects(async () => {
        const unexpected = await startProvider({
          ...options,
          providerGeneration: "not-a-uuid",
        });
        await unexpected.close();
      }, /generation/i),
    );
  }),
);
