import { UserId, SessionId } from "../src/contracts.ts";
import { it } from "@effect/vitest";
import { ConfigProvider, Effect, Exit, Redacted, Schema } from "effect";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startProvider } from "../src/provider.ts";
import {
  bootstrapApiKey,
  LocalWorkOSApiKey,
  ProviderGeneration,
  ClientId,
  ConfigService,
  decodeProviderConfig,
  loadProviderConfig,
} from "../src/config.ts";

const key = `sk_test_local_${"a".repeat(64)}`;
const provide = (values: Record<string, string>) =>
  Effect.provideService(
    ConfigProvider.ConfigProvider,
    ConfigProvider.fromUnknown(values),
  );

it.effect(
  "loads an exact local credential as redacted scoped configuration",
  () =>
    Effect.gen(function* () {
      const value = yield* bootstrapApiKey.pipe(
        provide({ LOCAL_WORKOS_API_KEY: key }),
      );
      assert.equal(Redacted.value(value), key);
      assert.ok(!JSON.stringify(value).includes(key));
    }),
);

for (const [description, value] of [
  ["missing credential", undefined],
  ["empty credential", ""],
  ["leading whitespace", ` ${key}`],
  ["trailing newline", `${key}\n`],
  ["non-local key format", "sk_test_other"],
  ["uppercase key", key.toUpperCase()],
] as const) {
  it.effect(`rejects ${description}`, () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        bootstrapApiKey.pipe(
          provide(value === undefined ? {} : { LOCAL_WORKOS_API_KEY: value }),
        ),
      );
      assert.ok(Exit.isFailure(exit));
      assert.ok(!JSON.stringify(exit).includes(key));
    }),
  );
}

it.effect("rejects invalid branded identifiers and credentials", () =>
  Effect.gen(function* () {
    for (const [schema, value] of [
      [LocalWorkOSApiKey, "sk_test_short"],
      [ProviderGeneration, "00000000-0000-1000-8000-000000000000"],
      [ClientId, "client_other"],
      [UserId, "user_00000000-0000-1000-8000-000000000000"],
      [SessionId, "session_00000000-0000-4000-0000-000000000000"],
      [UserId, "user_00000000-0000-4000-8000-000000000000\n"],
    ] as const) {
      assert.ok(
        Exit.isFailure(
          yield* Effect.exit(Schema.decodeUnknownEffect(schema)(value)),
        ),
      );
    }
  }),
);
it.effect(
  "isolates app-scoped configuration without ambient environment handoff",
  () =>
    Effect.gen(function* () {
      const configs = yield* Effect.all(
        ["a", "b"].map((letter) =>
          decodeProviderConfig({
            database: "/tmp/synthetic.sqlite",
            apiKey: `sk_test_local_${letter.repeat(64)}`,
          }),
        ),
      );
      const values = yield* Effect.all(
        configs.map((config) =>
          Effect.gen(function* () {
            return Redacted.value((yield* ConfigService).apiKey);
          }).pipe(Effect.provideService(ConfigService, config)),
        ),
        { concurrency: "unbounded" },
      );
      assert.deepEqual(
        values,
        configs.map((config) => Redacted.value(config.apiKey)),
      );
    }),
);

it.live(
  "concurrent HTTP providers expose only their persisted generation identity",
  () =>
    Effect.gen(function* () {
      const dir = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "workos-config-"))),
        (dir) =>
          Effect.promise(() => rm(dir, { recursive: true, force: true })),
      );
      const providers = yield* Effect.all(
        ["first", "second"].map((name) =>
          Effect.acquireRelease(
            Effect.promise(() =>
              startProvider({
                database: join(dir, `${name}.sqlite`),
                apiKey: key,
              }),
            ),
            (provider) => Effect.promise(() => provider.close()),
          ),
        ),
        { concurrency: "unbounded" },
      );
      assert.notEqual(providers[0].clientId, providers[1].clientId);
      for (const [index, provider] of providers.entries()) {
        const base = `http://127.0.0.1:${provider.port}`;
        const info = yield* Effect.promise(async () =>
          (await fetch(`${base}/instance-info`)).json(),
        );
        assert.equal(
          info.clientId,
          `client_local${provider.providerGeneration.replaceAll("-", "")}`,
        );
        const own = yield* Effect.promise(() =>
          fetch(`${base}/sso/jwks/${provider.clientId}`),
        );
        assert.equal(own.status, 200);
        const other = yield* Effect.promise(() =>
          fetch(`${base}/sso/jwks/${providers[1 - index].clientId}`, {
            headers: { authorization: `Bearer ${key}` },
          }),
        );
        assert.equal(other.status, 404);
      }
    }),
);

it.effect("isolates concurrent bootstrap ConfigProviders without a global handoff", () =>
  Effect.gen(function* () {
    const keys = ["a", "b"].map((letter) => `sk_test_local_${letter.repeat(64)}`);
    const configs = yield* Effect.all(
      keys.map((apiKey) =>
        loadProviderConfig({ database: "/tmp/synthetic.sqlite" }).pipe(
          provide({ LOCAL_WORKOS_API_KEY: apiKey }),
        ),
      ),
      { concurrency: "unbounded" },
    );
    assert.deepEqual(configs.map((config) => Redacted.value(config.apiKey)), keys);
    for (const apiKey of keys) assert.ok(!JSON.stringify(configs).includes(apiKey));
  }),
);
