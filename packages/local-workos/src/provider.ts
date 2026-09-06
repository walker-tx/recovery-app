import { DatabaseSync } from "node:sqlite";
import { lstatSync, openSync, closeSync, constants } from "node:fs";
import { isAbsolute, dirname } from "node:path";
import { createServer } from "node:http";
import {
  randomUUID,
  randomBytes,
  scrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { generateKeyPair, exportJWK, importJWK, SignJWT } from "jose";
import { ConfigProvider, Effect, Scope, Exit } from "effect";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import {
  makeHttpApp,
  HttpError,
  reject,
  equal,
  type User,
  type Authentication,
  type UserList,
  type Jwks,
} from "./http.ts";
const derive = promisify(scrypt);
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
type Row = {
  id: string;
  email: string;
  body: string;
  salt: string | null;
  verifier: string | null;
  identities: string;
};
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
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      options.providerGeneration,
    )
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
  const db = new DatabaseSync(options.database);
  const scope = Scope.makeUnsafe();
  try {
    db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=50;
 CREATE TABLE IF NOT EXISTS instance (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,body TEXT NOT NULL,salt TEXT,verifier TEXT,identities TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,refresh_hash TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,pending_hash TEXT NOT NULL,expires_at INTEGER NOT NULL);`);
    let saved = db.prepare("SELECT body FROM instance WHERE id=1").get() as
      | {
          body: string;
        }
      | undefined;
    if (!saved) {
      const keys = await generateKeyPair("RS256", { extractable: true });
      const generation = options.providerGeneration ?? randomUUID();
      const body = JSON.stringify({
        generation,
        privateKey: await exportJWK(keys.privateKey),
        publicKey: await exportJWK(keys.publicKey),
      });
      db.prepare("INSERT OR IGNORE INTO instance VALUES(1,?)").run(body);
      saved = db.prepare("SELECT body FROM instance WHERE id=1").get() as {
        body: string;
      };
    }
    const identity = JSON.parse(saved.body);
    if (
      !identity ||
      typeof identity.generation !== "string" ||
      !/^[0-9a-f-]{36}$/.test(identity.generation) ||
      identity.privateKey?.kty !== "RSA" ||
      identity.publicKey?.kty !== "RSA"
    )
      throw new Error("Invalid persisted signing identity");
    if (
      options.providerGeneration !== undefined &&
      identity.generation !== options.providerGeneration
    )
      throw new Error("Provider generation does not match persisted state");
    await importJWK(identity.publicKey, "RS256");
    const issuer = `https://local-workos.invalid/instances/${identity.generation}`;
    const clientId = `client_local${identity.generation.replaceAll("-", "")}`;
    const key = await importJWK(identity.privateKey, "RS256");
    const jwks: Jwks = {
      keys: [
        {
          ...identity.publicKey,
          kid: identity.generation,
          alg: "RS256",
          use: "sig",
        },
      ],
    };
    const getUser = (id: string) =>
      db.prepare("SELECT * FROM users WHERE id=?").get(id) as Row | undefined;
    // WorkOS operations: database ownership stays inside this lifecycle.
    async function authenticate(
      body: Record<string, unknown>,
    ): Promise<Authentication> {
      if (
        body.client_id !== clientId ||
        typeof body.client_secret !== "string" ||
        !equal(body.client_secret, options.apiKey)
      )
        return reject(401, "invalid_client");
      if (body.grant_type !== "password")
        return reject(400, "unsupported_grant_type");
      const email =
        typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      const row = db.prepare("SELECT * FROM users WHERE email=?").get(email) as
        Row | undefined;
      const password =
        typeof body.password === "string" && body.password.length <= 1024
          ? body.password
          : "";
      const hash = (await derive(
        password,
        row?.salt ?? "synthetic-missing-user",
        64,
      )) as Buffer;
      if (
        !row?.verifier ||
        !timingSafeEqual(hash, Buffer.from(row.verifier, "hex"))
      )
        throw new HttpError(400, {
          error: "invalid_grant",
          error_description: "Invalid credentials",
        });
      const user: User = JSON.parse(row.body);
      if (!user.email_verified) {
        const id = `email_verification_${randomUUID()}`,
          pending = randomBytes(32).toString("base64url");
        db.prepare("INSERT INTO challenges VALUES(?,?,?,?)").run(
          id,
          user.id,
          digest(pending),
          Date.now() + 600000,
        );
        throw new HttpError(400, {
          code: "email_verification_required",
          message: "Email verification required",
          email_verification_id: id,
          pending_authentication_token: pending,
        });
      }
      const sid = `session_${randomUUID()}`,
        refresh = randomBytes(32).toString("base64url");
      const access = await new SignJWT({ client_id: clientId, sid })
        .setProtectedHeader({ alg: "RS256", kid: identity.generation })
        .setIssuer(issuer)
        .setAudience(clientId)
        .setSubject(user.id)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(key);
      db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
        sid,
        user.id,
        digest(refresh),
        Date.now() + 7 * 86400000,
      );
      return {
        user,
        access_token: access,
        refresh_token: refresh,
        authentication_method: "Password",
        organization_id: null,
      };
    }
    async function createUser(body: Record<string, unknown>) {
      const email =
        typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        email.length > 254 ||
        typeof body.password !== "string" ||
        [...body.password].length < 12 ||
        [...body.password].length > 128 ||
        (body.email_verified !== undefined &&
          typeof body.email_verified !== "boolean") ||
        [body.first_name, body.last_name].some(
          (v) => v !== undefined && (typeof v !== "string" || v.length > 256),
        )
      )
        return reject(422, "invalid_user");
      const salt = randomBytes(16).toString("hex");
      const verifier = (
        (await derive(body.password, salt, 64)) as Buffer
      ).toString("hex");
      const now = new Date().toISOString();
      const user: User = {
        id: `user_${randomUUID()}`,
        object: "user",
        email,
        email_verified: body.email_verified === true,
        first_name: (body.first_name as string) ?? null,
        last_name: (body.last_name as string) ?? null,
        created_at: now,
        updated_at: now,
        profile_picture_url: null,
        external_id: null,
        metadata: {},
      };
      try {
        db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?)").run(
          user.id,
          email,
          JSON.stringify(user),
          salt,
          verifier,
          "[]",
        );
      } catch (e) {
        if (db.prepare("SELECT id FROM users WHERE email=?").get(email))
          return reject(409, "email_exists");
        throw e;
      }
      return user;
    }
    async function listUsers(rawUrl: string): Promise<UserList> {
      const url = new URL(rawUrl, "http://127.0.0.1");
      if (
        url.searchParams.has("before") ||
        (url.searchParams.has("order") &&
          !["asc", "desc"].includes(url.searchParams.get("order")!))
      )
        return reject(422, "unsupported_pagination");
      const after = url.searchParams.get("after");
      if (
        after !== null &&
        (!/^user_[0-9a-f-]{36}$/.test(after) || !getUser(after))
      )
        return reject(422, "invalid_cursor");
      const limit = Number(url.searchParams.get("limit") ?? 10);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        return reject(422, "invalid_limit");
      const email = url.searchParams.get("email")?.trim().toLowerCase();
      const descending = url.searchParams.get("order") === "desc";
      const rows = db
        .prepare(
          `SELECT * FROM users WHERE (? IS NULL OR email=?) AND (? IS NULL OR id ${descending ? "<" : ">"} ?) ORDER BY id ${descending ? "DESC" : "ASC"} LIMIT ?`,
        )
        .all(email ?? null, email ?? null, after, after, limit + 1) as Row[];
      return {
        object: "list",
        data: rows.slice(0, limit).map((r) => JSON.parse(r.body)),
        list_metadata: {
          before: null,
          after: rows.length > limit ? rows[limit - 1].id : null,
        },
      };
    }
    function readUser(id: string, field: "body" | "identities") {
      const row = getUser(id);
      if (!row) return reject(404, "not_found");
      return JSON.parse(row[field]);
    }
    // HTTP wiring: endpoint definitions own routing; handlers own wire behavior.
    const server = await Effect.runPromise(
      NodeHttpServer.make(createServer, {
        host: "127.0.0.1",
        port: options.port ?? 0,
      }).pipe(Effect.provideService(Scope.Scope, scope)),
    );
    const app = await Effect.runPromise(
      makeHttpApp(
        {
          apiKey: options.apiKey,
          issuer,
          providerGeneration: identity.generation,
          port: server.address._tag === "TcpAddress" ? server.address.port : 0,
          jwks,
          authenticate,
          createUser,
          listUsers,
          getUser: (id) => readUser(id, "body"),
          getIdentities: (id) => readUser(id, "identities"),
        },
        scope,
      ).pipe(
        // Persisted generation owns identity; never fall back to ambient env.
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown({ clientId }),
        ),
      ),
    );
    await Effect.runPromise(
      server.serve(app).pipe(Effect.provideService(Scope.Scope, scope)),
    );
    if (server.address._tag !== "TcpAddress")
      throw new Error("Expected loopback TCP address");
    let closed = false;
    return {
      port: server.address.port,
      providerGeneration: identity.generation as string,
      issuer,
      clientId,
      createIdentityFixture(input: {
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
        db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?)").run(
          user.id,
          email,
          JSON.stringify(user),
          null,
          null,
          JSON.stringify(identities),
        );
        return user;
      },
      async close() {
        if (!closed) {
          closed = true;
          try {
            await Effect.runPromise(Scope.close(scope, Exit.void));
          } finally {
            db.close();
          }
        }
      },
    };
  } catch (e) {
    try {
      await Effect.runPromise(Scope.close(scope, Exit.void));
    } finally {
      db.close();
    }
    throw e;
  }
}
