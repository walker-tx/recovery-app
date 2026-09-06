import { Config, Context, Data, Effect, Redacted, Schema } from "effect";
import { isAbsolute } from "node:path";
import type { importJWK } from "jose";
import type { Jwks } from "./contracts.ts";

export const LocalWorkOSApiKey = Schema.String.check(
  Schema.isPattern(/^sk_test_local_[0-9a-f]{64}$/),
  Schema.isLengthBetween(78, 78),
).pipe(Schema.brand("LocalWorkOSApiKey"));
export const ProviderGeneration = Schema.String.check(
  Schema.isPattern(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  ),
  Schema.isLengthBetween(36, 36),
).pipe(Schema.brand("ProviderGeneration"));
export const ClientId = Schema.String.check(
  Schema.isPattern(/^client_local[0-9a-f]{32}$/),
  Schema.isLengthBetween(44, 44),
).pipe(Schema.brand("ClientId"));
export class ConfigurationError extends Data.TaggedError("ConfigurationError")<{
  message: string;
}> {}
export const bootstrapApiKey = Effect.gen(function* () {
  const key = yield* Config.redacted("LOCAL_WORKOS_API_KEY");
  return Redacted.make(
    yield* Schema.decodeUnknownEffect(LocalWorkOSApiKey)(Redacted.value(key)),
  );
}).pipe(
  Effect.mapError(
    () => new ConfigurationError({ message: "Invalid bootstrap inputs" }),
  ),
);
export type ProviderOptions = {
  database: string;
  apiKey: string;
  port?: number;
  providerGeneration?: string;
};
export const decodeProviderConfig = (options: ProviderOptions) =>
  Effect.gen(function* () {
    const apiKey = yield* Schema.decodeUnknownEffect(LocalWorkOSApiKey)(
      options.apiKey,
    ).pipe(
      Effect.mapError(
        () => new ConfigurationError({ message: "Invalid bootstrap inputs" }),
      ),
    );
    const database = yield* Schema.decodeUnknownEffect(
      Schema.String.check(Schema.makeFilter(isAbsolute)),
    )(options.database).pipe(
      Effect.mapError(
        () =>
          new ConfigurationError({
            message: "Explicit absolute database required",
          }),
      ),
    );
    const port = yield* Schema.decodeUnknownEffect(
      Schema.Number.check(
        Schema.isInt(),
        Schema.isBetween({ minimum: 0, maximum: 65535 }),
      ),
    )(options.port ?? 0).pipe(
      Effect.mapError(
        () => new ConfigurationError({ message: "Invalid provider port" }),
      ),
    );
    const providerGeneration =
      options.providerGeneration === undefined
        ? undefined
        : yield* Schema.decodeUnknownEffect(ProviderGeneration)(
            options.providerGeneration,
          ).pipe(
            Effect.mapError(
              () =>
                new ConfigurationError({
                  message: "Invalid provider generation UUID",
                }),
            ),
          );
    return {
      database,
      port,
      providerGeneration,
      apiKey: Redacted.make(apiKey),
    };
  });
export class ConfigService extends Context.Service<
  ConfigService,
  Effect.Success<ReturnType<typeof decodeProviderConfig>>
>()("local-workos/Config") {}
export class SigningIdentity extends Context.Service<
  SigningIdentity,
  {
    readonly key: Awaited<ReturnType<typeof importJWK>>;
    readonly jwks: Jwks;
    readonly clientId: typeof ClientId.Type;
    readonly providerGeneration: typeof ProviderGeneration.Type;
    readonly issuer: string;
    readonly port: number;
  }
>()("local-workos/SigningIdentity") {}

export const loadProviderConfig = (options: Omit<ProviderOptions, "apiKey">) =>
  Effect.gen(function* () {
    const apiKey = yield* Config.redacted("LOCAL_WORKOS_API_KEY").pipe(
      Effect.mapError(
        () => new ConfigurationError({ message: "Invalid bootstrap inputs" }),
      ),
    );
    return yield* decodeProviderConfig({
      ...options,
      apiKey: Redacted.value(apiKey),
    });
  });
