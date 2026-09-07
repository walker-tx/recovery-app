import * as NodePath from "@effect/platform-node/NodePath";
import {
  LocalWorkOSApiKey,
  ProviderGeneration,
  AdminStackId,
  AdminWorktree,
  type ClientId,
} from "../contracts/identity.ts";
import {
  Layer,
  Config,
  Context,
  Data,
  Effect,
  Path,
  Redacted,
  Schema,
} from "effect";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Canonical admin ownership is checked before database acquisition.
import { realpathSync } from "node:fs";
import type { importJWK } from "jose";
import type { Jwks } from "../contracts/workos.ts";

// NodePath.layer is a resource-free synchronous layer using the host path implementation.
const hostPath = Context.get(
  Effect.runSync(Effect.scoped(Layer.build(NodePath.layer))),
  Path.Path,
);

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
                hostPath.isAbsolute(path) &&
                !path.includes("\0") &&
                Buffer.byteLength(path) <= 100 &&
                Buffer.byteLength(hostPath.dirname(path)) + 16 <= 100,
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
      Schema.String.check(Schema.makeFilter(hostPath.isAbsolute)),
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
