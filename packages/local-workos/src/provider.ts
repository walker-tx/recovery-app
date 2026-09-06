import * as SqliteClient from "@effect/sql-sqlite-node/SqliteClient";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { lstatSync, openSync, closeSync, constants } from "node:fs";
import { isAbsolute, dirname } from "node:path";
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
  ConfigProvider,
  Effect,
  Scope,
  Exit,
  Redacted,
  Layer,
  Context,
} from "effect";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { makeHttpApp } from "./http.ts";
import { type User, type Jwks } from "./contracts.ts";
import { workosLayer } from "./workos-service.ts";
const generationPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Explicit absolute state path; caller owns its directory and lifecycle. No environment fallback. */
export async function startProvider(options: {
  database: string;
  apiKey: string;
  port?: number;
  providerGeneration?: string;
}) {
  if (
    options.port !== undefined &&
    (!Number.isInteger(options.port) ||
      options.port < 0 ||
      options.port > 65535)
  )
    throw new Error("Invalid provider port");
  if (
    options.providerGeneration !== undefined &&
    !generationPattern.test(options.providerGeneration)
  )
    throw new Error("Invalid provider generation UUID");
  if (!isAbsolute(options.database) || !options.apiKey.startsWith("sk_test_"))
    throw new Error(
      "Explicit absolute database and synthetic sk_test_ key required",
    );
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
  const scope = Scope.makeUnsafe();
  try {
    const databaseContext = await Effect.runPromise(
      Layer.buildWithScope(
        SqliteClient.layer({
          filename: options.database,
          busyTimeout: 50,
          disableWAL: true,
        }),
        scope,
      ),
    );
    const sql = Context.get(databaseContext, SqlClient.SqlClient);
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* sql`PRAGMA foreign_keys=ON`;
        yield* sql`CREATE TABLE IF NOT EXISTS instance (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)`;
        yield* sql`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,body TEXT NOT NULL,salt TEXT,verifier TEXT,identities TEXT NOT NULL)`;
        yield* sql`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,refresh_hash TEXT NOT NULL,expires_at INTEGER NOT NULL)`;
        yield* sql`CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,pending_hash TEXT NOT NULL,expires_at INTEGER NOT NULL)`;
      }),
    );
    let [saved] = await Effect.runPromise(
      sql<{ body: string }>`SELECT body FROM instance WHERE id=1`,
    );
    if (!saved) {
      const keys = await generateKeyPair("RS256", { extractable: true });
      const body = JSON.stringify({
        generation: options.providerGeneration ?? randomUUID(),
        privateKey: await exportJWK(keys.privateKey),
        publicKey: await exportJWK(keys.publicKey),
      });
      saved = await Effect.runPromise(
        sql.withTransaction(
          Effect.gen(function* () {
            const [winner] = yield* sql<{
              body: string;
            }>`SELECT body FROM instance WHERE id=1`;
            if (winner) return winner;
            yield* sql`INSERT INTO instance VALUES(1,${body})`;
            return { body };
          }),
        ),
      );
    }
    let identity: { generation: string; privateKey: JWK; publicKey: JWK };
    let key;
    try {
      identity = JSON.parse(saved.body);
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
        throw new Error("Invalid persisted signing identity");
      const publicKey = await importJWK(identity.publicKey, "RS256");
      key = await importJWK(identity.privateKey, "RS256");
      // Import alone does not prove that persisted RSA components can sign.
      await compactVerify(
        await new CompactSign(new Uint8Array())
          .setProtectedHeader({ alg: "RS256" })
          .sign(key),
        publicKey,
      );
    } catch {
      throw new Error("Invalid persisted signing identity");
    }
    if (
      options.providerGeneration !== undefined &&
      identity.generation !== options.providerGeneration
    )
      throw new Error("Provider generation does not match persisted state");
    const issuer = `https://local-workos.invalid/instances/${identity.generation}`;
    const clientId = `client_local${identity.generation.replaceAll("-", "")}`;
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
    const server = await Effect.runPromise(
      NodeHttpServer.make(createServer, {
        host: "127.0.0.1",
        port: options.port ?? 0,
      }).pipe(Effect.provideService(Scope.Scope, scope)),
    );
    const app = await Effect.runPromise(
      makeHttpApp(scope).pipe(
        Effect.provide(
          workosLayer(key, jwks, Redacted.make(options.apiKey)).pipe(
            Layer.provide(Layer.succeedContext(databaseContext)),
          ),
        ),
        // Persisted generation owns identity; never fall back to ambient env.
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown({
            clientId,
            issuer,
            providerGeneration: identity.generation,
            port:
              server.address._tag === "TcpAddress" ? server.address.port : 0,
          }),
        ),
      ),
    );
    await Effect.runPromise(
      server.serve(app).pipe(Effect.provideService(Scope.Scope, scope)),
    );
    if (server.address._tag !== "TcpAddress")
      throw new Error("Expected loopback TCP address");
    let closePromise: Promise<void> | undefined;
    return {
      port: server.address.port,
      providerGeneration: identity.generation as string,
      issuer,
      clientId,
      async createIdentityFixture(input: {
        email: string;
        provider: "GoogleOAuth" | "AppleOAuth";
      }) {
        const email = input.email.trim().toLowerCase();
        if (
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          email.length > 254 ||
          !["GoogleOAuth", "AppleOAuth"].includes(input.provider)
        )
          throw new Error("Invalid fixture");
        const now = new Date().toISOString();
        const user: User = {
          id: `user_${randomUUID()}`,
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
        try {
          await Effect.runPromise(
            sql`INSERT INTO users VALUES(${user.id},${email},${JSON.stringify(user)},${null},${null},${JSON.stringify(identities)})`,
          );
        } catch {
          throw new Error("Unable to create identity fixture");
        }
        return user;
      },
      close() {
        return (closePromise ??= Effect.runPromise(
          Scope.close(scope, Exit.void),
        ));
      },
    };
  } catch (e) {
    await Effect.runPromise(Scope.close(scope, Exit.void));
    throw e;
  }
}
