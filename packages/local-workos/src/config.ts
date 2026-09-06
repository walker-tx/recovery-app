import { Config, ConfigProvider, Effect, Redacted } from "effect";

export const bootstrapApiKey = Effect.gen(function* () {
  const key = yield* Config.redacted("LOCAL_WORKOS_API_KEY");
  const value = Redacted.value(key);
  if (value.length !== 78 || !/^sk_test_local_[0-9a-f]{64}$/.test(value)) {
    return yield* Effect.fail(new Error("Invalid bootstrap inputs"));
  }
  return key;
}).pipe(Effect.catch(() => Effect.fail(new Error("Invalid bootstrap inputs"))));

// Consume only the process environment, never an inherited ConfigProvider.
// Snapshot then erase before parsing so malformed credentials are erased too.
export const consumeBootstrapApiKey = Effect.suspend(() => {
  const value = process.env.LOCAL_WORKOS_API_KEY;
  delete process.env.LOCAL_WORKOS_API_KEY;
  return bootstrapApiKey.pipe(
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromEnvRecord({ LOCAL_WORKOS_API_KEY: value }),
    ),
  );
});

export const httpClientId = Config.string("clientId");
