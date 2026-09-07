import { Predicate } from "effect";
import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as SqlClient from "effect/unstable/sql/SqlClient";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Owner/mode checks and O_NOFOLLOW require the low-level Node filesystem boundary.
import { lstatSync, openSync, closeSync, constants } from "node:fs";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- dirname is pure; no filesystem service is needed.
import { dirname } from "node:path";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- NodeHttpServer.make requires the native server factory.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  generateKeyPair,
  exportJWK,
  importJWK,
  CompactSign,
  compactVerify,
} from "jose";
import {
  Effect,
  Scope,
  Exit,
  Layer,
  Context,
  Clock,
  DateTime,
  Data,
  Schema,
} from "effect";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { makeHttpApp } from "./http.ts";
import { deriveReplayKey } from "./replay-crypto.ts";
import { type User, type Jwks, UserId } from "./contracts.ts";
import {
  ConfigService,
  SigningIdentity,
  decodeProviderConfig,
  ProviderGeneration,
  ClientId,
  type ProviderOptions,
} from "./config.ts";
import { workosLayer } from "./workos-service.ts";
export class ProviderStartupError extends Data.TaggedError(
  "ProviderStartupError",
)<{ message: string }> {}

export class FixtureError extends Data.TaggedError("FixtureError")<{
  message: string;
}> {}

export class ProviderClearError extends Data.TaggedError("ProviderClearError")<{
  reason: "confirmation" | "identity" | "storage";
}> {}
export class ProviderSessionError extends Schema.TaggedError<ProviderSessionError>()(
  "ProviderSessionError",
  {
    reason: Schema.Literals([
      "confirmation",
      "identity",
      "storage",
      "not_found",
    ]),
  },
) {}
const RevokeUserConfirmation = Schema.Struct({
  operation: Schema.Literal("revoke-user-sessions"),
  database: Schema.String,
  providerGeneration: ProviderGeneration,
  userId: UserId,
});
const ClearConfirmation = Schema.Struct({
  operation: Schema.Literal("clear-provider-data"),
  database: Schema.String,
  providerGeneration: ProviderGeneration,
  affectedDomains: Schema.Array(
    Schema.Literals(["users", "sessions", "challenges"]),
  ).check(
    Schema.makeFilter(
      (domains) => domains.length === 3 && new Set(domains).size === 3,
    ),
  ),
});

const generationPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Explicit absolute state path; caller owns its directory and lifecycle. No environment fallback. */
export function acquireProvider(options: ProviderOptions) {
  return decodeProviderConfig(options).pipe(
    Effect.flatMap((config) =>
      acquireConfiguredProvider.pipe(
        Effect.provideService(ConfigService, config),
      ),
    ),
  );
}
export const acquireConfiguredProvider = Effect.gen(function* () {
  const options = yield* ConfigService;
  const ownedDatabase = yield* Effect.try({
    try: () => {
      const parent = lstatSync(dirname(options.database));
      if (
        !parent.isDirectory() ||
        parent.uid !== process.getuid?.() ||
        (parent.mode & 0o077) !== 0
      ) {
        throw new Error("State parent must be an owner-only directory");
      }
      for (const path of [
        options.database,
        options.database + "-journal",
        options.database + "-wal",
        options.database + "-shm",
      ]) {
        try {
          const file = lstatSync(path);
          if (
            !file.isFile() ||
            file.nlink !== 1 ||
            file.uid !== process.getuid?.() ||
            (file.mode & 0o077) !== 0
          ) {
            throw new Error("State must be an owner-only regular file");
          }
        } catch (error) {
          if (
            !(
              error instanceof Error &&
              "code" in error &&
              error.code === "ENOENT"
            )
          ) {
            throw error;
          }
        }
      }
      closeSync(
        openSync(
          options.database,
          constants.O_CREAT |
            constants.O_APPEND |
            constants.O_WRONLY |
            constants.O_NOFOLLOW,
          0o600,
        ),
      );
      return lstatSync(options.database);
    },
    catch: (error) =>
      new ProviderStartupError({
        message:
          error instanceof Error ? error.message : "Invalid provider state",
      }),
  });
  const scope = yield* Scope.Scope;
  const databaseContext = yield* Layer.buildWithScope(
    SqliteClient.layer({
      filename: options.database,
      busyTimeout: 50,
      disableWAL: true,
    }),
    scope,
  );
  const sql = Context.get(databaseContext, SqlClient.SqlClient);
  yield* Effect.gen(function* () {
    yield* sql`PRAGMA foreign_keys=ON`;
    yield* sql`CREATE TABLE IF NOT EXISTS instance (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)`;
    yield* sql`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,body TEXT NOT NULL,salt TEXT,verifier TEXT,identities TEXT NOT NULL)`;
    yield* sql`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,refresh_hash TEXT NOT NULL,expires_at INTEGER NOT NULL)`;
    yield* sql`CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,pending_hash TEXT NOT NULL,expires_at INTEGER NOT NULL)`;
  });
  // A dependent table preserves the original challenge row layout and #47's
  // acquired-transaction clear semantics, including existing persistent databases.
  yield* sql`CREATE TABLE IF NOT EXISTS email_verifications (challenge_id TEXT PRIMARY KEY REFERENCES challenges(id) ON DELETE CASCADE, body TEXT NOT NULL)`;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      const columns = yield* sql<{
        name: string;
      }>`PRAGMA table_info(email_verifications)`;
      if (!columns.some((column) => column.name === "failed_attempts")) {
        yield* sql`ALTER TABLE email_verifications ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0`;
      }
      yield* sql`CREATE INDEX IF NOT EXISTS challenges_pending_hash ON challenges(pending_hash)`;
    }),
  );
  yield* sql`CREATE TABLE IF NOT EXISTS password_resets (challenge_id TEXT PRIMARY KEY REFERENCES challenges(id) ON DELETE CASCADE)`;
  yield* sql`CREATE TABLE IF NOT EXISTS refresh_replays (old_hash TEXT PRIMARY KEY,session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL,encrypted_result TEXT NOT NULL)`;
  yield* sql`CREATE INDEX IF NOT EXISTS sessions_refresh_hash ON sessions(refresh_hash)`;
  const pruneReplays = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    yield* sql`DELETE FROM refresh_replays WHERE expires_at<=${now} OR session_id IN (SELECT id FROM sessions WHERE expires_at<=${now})`;
  });
  yield* pruneReplays;
  yield* Effect.forkScoped(
    Effect.forever(
      Effect.sleep(1000).pipe(
        Effect.andThen(pruneReplays),
        Effect.catch(() =>
          Effect.logWarning("Local refresh replay cleanup failed"),
        ),
      ),
    ),
  );
  let [saved] = yield* sql<{
    body: string;
  }>`SELECT body FROM instance WHERE id=1`;
  if (!saved) {
    const keys = yield* Effect.tryPromise(() =>
      generateKeyPair("RS256", { extractable: true }),
    );
    const body = yield* Schema.encodeEffect(
      Schema.fromJsonString(Schema.Unknown),
    )({
      generation: options.providerGeneration ?? randomUUID(),
      privateKey: yield* Effect.tryPromise(() => exportJWK(keys.privateKey)),
      publicKey: yield* Effect.tryPromise(() => exportJWK(keys.publicKey)),
    });
    saved = yield* sql.withTransaction(
      Effect.gen(function* () {
        const [winner] = yield* sql<{
          body: string;
        }>`SELECT body FROM instance WHERE id=1`;
        if (winner) {
          return winner;
        }
        yield* sql`INSERT INTO instance VALUES(1,${body})`;
        return { body };
      }),
    );
  }
  const identity = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(
      Schema.Struct({
        generation: Schema.String.check(Schema.isPattern(generationPattern)),
        privateKey: Schema.Struct({
          kty: Schema.Literal("RSA"),
          n: Schema.String,
          e: Schema.String,
          d: Schema.String,
        }),
        publicKey: Schema.Struct({
          kty: Schema.Literal("RSA"),
          n: Schema.String,
          e: Schema.String,
        }),
      }).check(
        Schema.makeFilter(
          (persisted) =>
            persisted.privateKey.n === persisted.publicKey.n &&
            persisted.privateKey.e === persisted.publicKey.e &&
            !["d", "p", "q", "dp", "dq", "qi", "oth"].some(
              (field) => field in persisted.publicKey,
            ),
        ),
      ),
    ),
    // Retain all signing parameters and expose private public-key material to the check.
    { onExcessProperty: "preserve" },
  )(saved.body).pipe(
    Effect.mapError(
      () =>
        new ProviderStartupError({
          message: "Invalid persisted signing identity",
        }),
    ),
  );
  const { key } = yield* Effect.gen(function* () {
    const publicKey = yield* Effect.tryPromise(() =>
      importJWK(identity.publicKey, "RS256"),
    );
    const privateKey = yield* Effect.tryPromise(() =>
      importJWK(identity.privateKey, "RS256"),
    );
    const signature = yield* Effect.tryPromise(() =>
      new CompactSign(new Uint8Array())
        .setProtectedHeader({ alg: "RS256" })
        .sign(privateKey),
    );
    yield* Effect.tryPromise(() => compactVerify(signature, publicKey));
    return { key: privateKey };
  }).pipe(
    Effect.mapError(
      () =>
        new ProviderStartupError({
          message: "Invalid persisted signing identity",
        }),
    ),
  );
  if (
    options.providerGeneration !== undefined &&
    identity.generation !== options.providerGeneration
  ) {
    return yield* Effect.fail(
      new ProviderStartupError({
        message: "Provider generation does not match persisted state",
      }),
    );
  }
  const providerGeneration = yield* Schema.decodeUnknownEffect(
    ProviderGeneration,
  )(identity.generation);
  const issuer = `https://local-workos.invalid/instances/${identity.generation}`;
  const clientId = yield* Schema.decodeUnknownEffect(ClientId)(
    `client_local${identity.generation.replaceAll("-", "")}`,
  );
  const jwks: Jwks = {
    keys: [
      {
        kty: "RSA",
        n: identity.publicKey.n,
        e: identity.publicKey.e,
        kid: identity.generation,
        alg: "RS256",
        use: "sig",
      },
    ],
  };
  // HTTP wiring: endpoint definitions own routing; handlers own wire behavior.
  // Mask rc.112 acquisition until listen settles, preventing a cached no-op shutdown.
  const server = yield* NodeHttpServer.make(createServer, {
    host: "127.0.0.1",
    port: options.port ?? 0,
  }).pipe(Effect.uninterruptible);
  const app = yield* makeHttpApp(scope).pipe(
    // oxlint-disable-next-line effecttsgo/strict-effect-provide -- Server entrypoint assembles services in the caller-owned scope.
    Effect.provide(
      workosLayer.pipe(
        Layer.provide(Layer.succeedContext(databaseContext)),
        Layer.provide(Layer.succeed(ConfigService, options)),
        Layer.provide(
          Layer.succeed(SigningIdentity, {
            key,
            replayKey: deriveReplayKey(
              identity.privateKey.d,
              identity.generation,
            ),
            jwks,
            clientId,
            providerGeneration,
            issuer,
            port: Predicate.isTagged(server.address, "TcpAddress")
              ? server.address.port
              : 0,
          }),
        ),
      ),
    ),
  );
  yield* server.serve(app);
  if (!Predicate.isTagged(server.address, "TcpAddress")) {
    return yield* Effect.fail(
      new ProviderStartupError({ message: "Expected loopback TCP address" }),
    );
  }
  const requireOwnedIdentity = Effect.gen(function* () {
    yield* Effect.try({
      try: () => {
        const file = lstatSync(options.database);
        if (
          !file.isFile() ||
          file.isSymbolicLink() ||
          file.nlink !== 1 ||
          file.uid !== process.getuid?.() ||
          (file.mode & 0o077) !== 0 ||
          file.dev !== ownedDatabase.dev ||
          file.ino !== ownedDatabase.ino
        ) {
          throw Error();
        }
      },
      catch: () => new ProviderClearError({ reason: "identity" }),
    });
    const [persisted] = yield* sql<{
      body: string;
    }>`SELECT body FROM instance WHERE id=1`;
    // Compare the already-acquired signing identity without serializing it.
    if (persisted?.body !== saved.body) {
      return yield* Effect.fail(new ProviderClearError({ reason: "identity" }));
    }
    return undefined;
  });
  return {
    // Local acquired-resource API only. No HTTP/console reset endpoint and no
    // new connection, credentials, signing identity or ambient configuration.
    revokeUserSessions: Effect.fn("revokeUserSessions")(function* (
      input: unknown,
    ) {
      const confirmation = yield* Schema.decodeUnknownEffect(
        RevokeUserConfirmation,
      )(input).pipe(
        Effect.mapError(
          () => new ProviderSessionError({ reason: "confirmation" }),
        ),
      );
      if (
        confirmation.database !== options.database ||
        confirmation.providerGeneration !== providerGeneration
      ) {
        return yield* Effect.fail(
          new ProviderSessionError({ reason: "confirmation" }),
        );
      }
      return yield* sql
        .withTransaction(
          Effect.gen(function* () {
            yield* requireOwnedIdentity;
            const [user] =
              yield* sql`SELECT id FROM users WHERE id=${confirmation.userId}`;
            if (!user) {
              return yield* Effect.fail(
                new ProviderSessionError({ reason: "not_found" }),
              );
            }
            yield* sql`DELETE FROM sessions WHERE user_id=${confirmation.userId}`;
            return {
              userId: confirmation.userId,
              issuedAccessTokens: "valid-until-expiry" as const,
            };
          }),
        )
        .pipe(
          Effect.mapError((error) =>
            Schema.is(ProviderSessionError)(error)
              ? error
              : new ProviderSessionError({
                  reason:
                    error instanceof ProviderClearError
                      ? error.reason
                      : "storage",
                }),
          ),
        );
    }),
    clearData(input: unknown) {
      return Effect.gen(function* () {
        const confirmation = yield* Schema.decodeUnknownEffect(
          ClearConfirmation,
        )(input).pipe(
          Effect.mapError(
            () => new ProviderClearError({ reason: "confirmation" }),
          ),
        );
        if (
          confirmation.database !== options.database ||
          confirmation.providerGeneration !== providerGeneration
        ) {
          return yield* Effect.fail(
            new ProviderClearError({ reason: "confirmation" }),
          );
        }
        return yield* sql
          .withTransaction(
            Effect.gen(function* () {
              yield* requireOwnedIdentity;
              yield* sql`DELETE FROM sessions`;
              yield* sql`DELETE FROM challenges`;
              yield* sql`DELETE FROM users`;
              return {
                operation: "clear-provider-data" as const,
                providerGeneration,
                cleared: ["users", "sessions", "challenges"] as const,
                issuedAccessTokens: "valid-until-expiry" as const,
              };
            }),
          )
          .pipe(
            Effect.mapError((error) =>
              error instanceof ProviderClearError
                ? error
                : new ProviderClearError({ reason: "storage" }),
            ),
          );
      });
    },
    port: server.address.port,
    providerGeneration: identity.generation,
    issuer,
    clientId,
    createIdentityFixture(input: {
      email: string;
      provider: "GoogleOAuth" | "AppleOAuth";
    }) {
      return Effect.gen(function* () {
        const email = input.email.trim().toLowerCase();
        if (
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          email.length > 254 ||
          !["GoogleOAuth", "AppleOAuth"].includes(input.provider)
        ) {
          return yield* Effect.fail(
            new FixtureError({ message: "Invalid fixture" }),
          );
        }
        const now = yield* Clock.currentTimeMillis;
        const timestamp = DateTime.formatIso(DateTime.makeUnsafe(now));
        const user: User = {
          id: yield* Schema.decodeUnknownEffect(UserId)(
            `user_${randomUUID()}`,
          ).pipe(Effect.orDie),
          object: "user",
          email,
          email_verified: true,
          first_name: null,
          last_name: null,
          created_at: timestamp,
          updated_at: timestamp,
          profile_picture_url: null,
          external_id: null,
          metadata: {},
        };
        const identities = [
          {
            object: "identity",
            id: `identity_${randomUUID()}`,
            type: input.provider,
            provider: input.provider,
          },
        ];
        const userBody = yield* Schema.encodeEffect(
          Schema.fromJsonString(Schema.Unknown),
        )(user);
        const identitiesBody = yield* Schema.encodeEffect(
          Schema.fromJsonString(Schema.Unknown),
        )(identities);
        yield* sql`INSERT INTO users VALUES(${user.id},${email},${userBody},${null},${null},${identitiesBody})`.pipe(
          Effect.mapError(
            () =>
              new FixtureError({
                message: "Unable to create identity fixture",
              }),
          ),
        );
        return user;
      });
    },
  };
});

/** Promise compatibility boundary for launchers and non-Effect callers. */
// oxlint-disable-next-line effecttsgo/async-function -- Public Promise adapter owns acquisition-failure cleanup for non-Effect callers.
export async function startProvider(
  options: Parameters<typeof acquireProvider>[0],
) {
  const scope = Scope.makeUnsafe();
  try {
    const provider = await Effect.runPromise(
      acquireProvider(options).pipe(Effect.provideService(Scope.Scope, scope)),
    );
    let closePromise: Promise<void> | undefined;
    return {
      ...provider,
      revokeUserSessions: (input: unknown) =>
        Effect.runPromise(provider.revokeUserSessions(input)),
      clearData: (input: unknown) =>
        Effect.runPromise(provider.clearData(input)),
      createIdentityFixture: (
        input: Parameters<typeof provider.createIdentityFixture>[0],
      ) =>
        Effect.runPromise(
          provider
            .createIdentityFixture(input)
            // oxlint-disable-next-line effecttsgo/global-error-in-effect-failure -- Preserve native Error rejections for Promise API compatibility.
            .pipe(Effect.mapError((error) => new Error(error.message))),
        ),
      close: () =>
        (closePromise ??= Effect.runPromise(Scope.close(scope, Exit.void))),
    };
  } catch (error) {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    throw error;
  }
}
