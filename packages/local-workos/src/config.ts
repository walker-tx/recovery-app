import { Config, Context, Data, Effect, Redacted, Schema } from "effect";
// Pure schema predicate; no filesystem access or Effect service is needed.
// oxlint-disable-next-line effecttsgo/node-builtin-import
import { isAbsolute, dirname, normalize } from "node:path";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Canonical admin ownership is checked before database acquisition.
import { realpathSync } from "node:fs";
import type { importJWK } from "jose";
import type { Jwks } from "./contracts.ts";

export const LocalWorkOSApiKey = Schema.String.check(
  Schema.isPattern(/^sk_test_local_[0-9a-f]{64}$/),
  Schema.isLengthBetween(78, 78),
).pipe(Schema.brand("LocalWorkOSApiKey"));
const IdentityUuid = Schema.String.check(
  Schema.isPattern(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  ),
  Schema.isLengthBetween(36, 36),
);
export const ProviderGeneration = IdentityUuid.pipe(
  Schema.brand("ProviderGeneration"),
);
export const AdminStackId = IdentityUuid;
export const AdminWorktree = Schema.String.check(
  Schema.makeFilter(
    (path) =>
      isAbsolute(path) &&
      normalize(path) === path &&
      !path.includes("\0") &&
      Buffer.byteLength(path, "utf8") <= 4096,
  ),
);
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
const LifetimeSeconds = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 30 * 86400 }),
).pipe(Schema.brand("LifetimeSeconds"));
const LifetimesSchema = Schema.Struct({
  accessTokenSeconds: LifetimeSeconds,
  sessionSeconds: LifetimeSeconds,
  verificationSeconds: LifetimeSeconds,
  passwordResetSeconds: LifetimeSeconds,
});
export type ProviderOptions = {
  admin?: { socketPath: string; stackId: string; worktree: string };
  database: string;
  apiKey: string;
  port?: number;
  providerGeneration?: string;
  lifetimes?: Partial<{
    accessTokenSeconds: number;
    sessionSeconds: number;
    verificationSeconds: number;
    passwordResetSeconds: number;
  }>;
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
    const admin = yield* Schema.decodeUnknownEffect(
      Schema.optional(
        Schema.Struct({
          socketPath: Schema.String.check(
            Schema.makeFilter(
              (path) =>
                isAbsolute(path) &&
                Buffer.byteLength(path) <= 100 &&
                Buffer.byteLength(dirname(path)) + 16 <= 100,
            ),
          ),
          stackId: AdminStackId,
          worktree: AdminWorktree,
        }),
      ),
    )(options.admin).pipe(
      Effect.mapError(
        () =>
          new ConfigurationError({
            message:
              "Invalid private admin configuration; require a short absolute socket path, stack UUID and bounded canonical worktree",
          }),
      ),
    );
    if (admin !== undefined) {
      yield* Effect.try({
        try: () => {
          if (realpathSync(admin.worktree) !== admin.worktree) {
            throw new Error("Noncanonical admin worktree");
          }
        },
        catch: () =>
          new ConfigurationError({
            message:
              "Admin worktree must be an existing canonical absolute path",
          }),
      });
    }
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
    const lifetimes = yield* Schema.decodeUnknownEffect(LifetimesSchema)({
      accessTokenSeconds: 300,
      sessionSeconds: 7 * 86400,
      verificationSeconds: 600,
      passwordResetSeconds: 1800,
      ...options.lifetimes,
    }).pipe(
      Effect.mapError(
        () => new ConfigurationError({ message: "Invalid provider lifetimes" }),
      ),
    );
    if (lifetimes.accessTokenSeconds > lifetimes.sessionSeconds) {
      return yield* Effect.fail(
        new ConfigurationError({
          message: "Access lifetime exceeds session lifetime",
        }),
      );
    }
    return {
      admin,
      lifetimes,
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
    readonly replayKey: Redacted.Redacted<Uint8Array>;
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
