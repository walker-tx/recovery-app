import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { lstatSync, openSync, closeSync, constants } from "node:fs";
import { dirname } from "node:path";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  generateKeyPair,
  exportJWK,
  importJWK,
  CompactSign,
  compactVerify,
  type JWK,
} from "jose";
import {
  Effect,
  Scope,
  Exit,
  Layer,
  Context,
  Clock,
  Data,
  Schema,
} from "effect";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { makeHttpApp } from "./http.ts";
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
  yield* Effect.try({
    try: () => {
      const parent = lstatSync(dirname(options.database));
      if (
        !parent.isDirectory() ||
        parent.uid !== process.getuid?.() ||
        (parent.mode & 0o077) !== 0
      )
        throw new Error("State parent must be an owner-only directory");
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
            file.uid !== process.getuid?.() ||
            (file.mode & 0o077) !== 0
          )
            throw new Error("State must be an owner-only regular file");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
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
  let [saved] = yield* sql<{
    body: string;
  }>`SELECT body FROM instance WHERE id=1`;
  if (!saved) {
    const keys = yield* Effect.tryPromise(() =>
      generateKeyPair("RS256", { extractable: true }),
    );
    const body = JSON.stringify({
      generation: options.providerGeneration ?? randomUUID(),
      privateKey: yield* Effect.tryPromise(() => exportJWK(keys.privateKey)),
      publicKey: yield* Effect.tryPromise(() => exportJWK(keys.publicKey)),
    });
    saved = yield* sql.withTransaction(
      Effect.gen(function* () {
        const [winner] = yield* sql<{
          body: string;
        }>`SELECT body FROM instance WHERE id=1`;
        if (winner) return winner;
        yield* sql`INSERT INTO instance VALUES(1,${body})`;
        return { body };
      }),
    );
  }
  const identity = yield* Effect.try({
    try: () => {
      const identity: {
        generation: string;
        privateKey: JWK;
        publicKey: JWK;
      } = JSON.parse(saved.body);
      if (
        !identity ||
        typeof identity.generation !== "string" ||
        !generationPattern.test(identity.generation) ||
        identity.privateKey?.kty !== "RSA" ||
        identity.publicKey?.kty !== "RSA" ||
        typeof identity.privateKey.d !== "string" ||
        typeof identity.publicKey.n !== "string" ||
        typeof identity.publicKey.e !== "string" ||
        identity.privateKey.n !== identity.publicKey.n ||
        identity.privateKey.e !== identity.publicKey.e ||
        ["d", "p", "q", "dp", "dq", "qi", "oth"].some(
          (field) => field in identity.publicKey,
        )
      )
        throw new ProviderStartupError({
          message: "Invalid persisted signing identity",
        });
      return {
        ...identity,
        publicKey: {
          ...identity.publicKey,
          n: identity.publicKey.n,
          e: identity.publicKey.e,
        },
      };
    },
    catch: () =>
      new ProviderStartupError({
        message: "Invalid persisted signing identity",
      }),
  });
  const { key } = yield* Effect.gen(function* () {
    const publicKey = yield* Effect.tryPromise(() =>
      importJWK(identity.publicKey, "RS256"),
    );
    const key = yield* Effect.tryPromise(() =>
      importJWK(identity.privateKey, "RS256"),
    );
    const signature = yield* Effect.tryPromise(() =>
      new CompactSign(new Uint8Array())
        .setProtectedHeader({ alg: "RS256" })
        .sign(key),
    );
    yield* Effect.tryPromise(() => compactVerify(signature, publicKey));
    return { key };
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
  )
    return yield* Effect.fail(
      new ProviderStartupError({
        message: "Provider generation does not match persisted state",
      }),
    );
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
    Effect.provide(
      workosLayer.pipe(
        Layer.provide(Layer.succeedContext(databaseContext)),
        Layer.provide(Layer.succeed(ConfigService, options)),
        Layer.provide(
          Layer.succeed(SigningIdentity, {
            key,
            jwks,
            clientId,
            providerGeneration,
            issuer,
            port:
              server.address._tag === "TcpAddress" ? server.address.port : 0,
          }),
        ),
      ),
    ),
  );
  yield* server.serve(app);
  if (server.address._tag !== "TcpAddress")
    return yield* Effect.fail(
      new ProviderStartupError({ message: "Expected loopback TCP address" }),
    );
  return {
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
        )
          return yield* Effect.fail(
            new FixtureError({ message: "Invalid fixture" }),
          );
        const now = new Date(yield* Clock.currentTimeMillis).toISOString();
        const user: User = {
          id: yield* Schema.decodeUnknownEffect(UserId)(
            `user_${randomUUID()}`,
          ).pipe(Effect.orDie),
          object: "user",
          email,
          email_verified: true,
          first_name: null,
          last_name: null,
          created_at: now,
          updated_at: now,
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
        yield* sql`INSERT INTO users VALUES(${user.id},${email},${JSON.stringify(user)},${null},${null},${JSON.stringify(identities)})`.pipe(
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
      createIdentityFixture: (
        input: Parameters<typeof provider.createIdentityFixture>[0],
      ) =>
        Effect.runPromise(
          provider
            .createIdentityFixture(input)
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
