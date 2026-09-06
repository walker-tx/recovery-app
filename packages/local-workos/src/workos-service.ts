import { Context, Effect, Layer, Config, Redacted, Schema } from "effect";
import type { DatabaseSync } from "node:sqlite";
import {
  randomUUID,
  randomBytes,
  scrypt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import { promisify } from "node:util";
import { SignJWT, type importJWK } from "jose";
import { httpClientId } from "./config.ts";
import {
  HttpError,
  reject,
  equal,
  PasswordAuthenticationRequestSchema,
  CreateUserRequestSchema,
  type PasswordAuthenticationRequest,
  type CreateUserRequest,
  type User,
  type Authentication,
  type UserList,
  type Identities,
  type Jwks,
} from "./contracts.ts";
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
type InstanceInfo = {
  providerGeneration: string;
  issuer: string;
  clientId: string;
  port: number;
};
export class WorkOSService extends Context.Service<
  WorkOSService,
  {
    readonly apiKey: Redacted.Redacted<string>;
    readonly instanceInfo: Effect.Effect<InstanceInfo>;
    readonly jwks: Effect.Effect<Jwks>;
    readonly authenticate: (
      body: Record<string, unknown>,
    ) => Effect.Effect<Authentication, HttpError>;
    readonly createUser: (
      body: Record<string, unknown>,
    ) => Effect.Effect<User, HttpError>;
    readonly listUsers: (url: string) => Effect.Effect<UserList, HttpError>;
    readonly getUser: (id: string) => Effect.Effect<User, HttpError>;
    readonly getIdentities: (
      id: string,
    ) => Effect.Effect<Identities, HttpError>;
  }
>()("local-workos/WorkOSService") {}
const operationError = (error: unknown): HttpError =>
  error instanceof HttpError
    ? error
    : new HttpError(500, { code: "internal_error" });
// The provider owns and closes the database; this layer borrows it for its lifetime.
export function workosLayer(
  db: DatabaseSync,
  key: Awaited<ReturnType<typeof importJWK>>,
  publicJwks: Jwks,
  apiKey: Redacted.Redacted<string>,
) {
  return Layer.effect(
    WorkOSService,
    Effect.gen(function* () {
      const clientId = yield* httpClientId;
      const issuer = yield* Config.string("issuer");
      const generation = yield* Config.string("providerGeneration");
      const port = yield* Config.number("port");
      const getUser = (id: string) =>
        db.prepare("SELECT * FROM users WHERE id=?").get(id) as Row | undefined;
      // Effects are lazy; only the provider lifecycle owns database cleanup.
      const authenticate = (body: Record<string, unknown>) =>
        Effect.tryPromise({
          try: async (): Promise<Authentication> => {
            if (
              body.client_id !== clientId ||
              typeof body.client_secret !== "string" ||
              !equal(body.client_secret, Redacted.value(apiKey))
            )
              return reject(401, "invalid_client");
            if (body.grant_type !== "password")
              return reject(400, "unsupported_grant_type");
            let payload: PasswordAuthenticationRequest | undefined;
            try {
              payload = Schema.decodeUnknownSync(
                PasswordAuthenticationRequestSchema,
              )(body);
            } catch {
              // Never expose Schema issues: they can contain passwords/client secrets.
              // Still derive against a synthetic account for malformed credentials.
            }
            const email = payload?.email.trim().toLowerCase() ?? "";
            const row = db
              .prepare("SELECT * FROM users WHERE email=?")
              .get(email) as Row | undefined;
            const password = payload?.password ?? "";
            const hash = (await derive(
              password,
              row?.salt ?? "synthetic-missing-user",
              64,
            )) as Buffer;
            if (
              !payload ||
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
              .setProtectedHeader({ alg: "RS256", kid: generation })
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
          },
          catch: operationError,
        });
      const createUser = (body: Record<string, unknown>) =>
        Effect.tryPromise({
          try: async () => {
            let payload: CreateUserRequest;
            try {
              payload = Schema.decodeUnknownSync(CreateUserRequestSchema)(body);
            } catch {
              return reject(422, "invalid_user");
            }
            const email = payload.email.trim().toLowerCase();
            const salt = randomBytes(16).toString("hex");
            const verifier = (
              (await derive(payload.password, salt, 64)) as Buffer
            ).toString("hex");
            const now = new Date().toISOString();
            const user: User = {
              id: `user_${randomUUID()}`,
              object: "user",
              email,
              email_verified: payload.email_verified === true,
              first_name: payload.first_name ?? null,
              last_name: payload.last_name ?? null,
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
          },
          catch: operationError,
        });
      const listUsers = (rawUrl: string) =>
        Effect.try({
          try: (): UserList => {
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
              .all(
                email ?? null,
                email ?? null,
                after,
                after,
                limit + 1,
              ) as Row[];
            return {
              object: "list",
              data: rows.slice(0, limit).map((r) => JSON.parse(r.body)),
              list_metadata: {
                before: null,
                after: rows.length > limit ? rows[limit - 1].id : null,
              },
            };
          },
          catch: operationError,
        });
      function readUser(id: string, field: "body" | "identities") {
        const row = getUser(id);
        if (!row) return reject(404, "not_found");
        return JSON.parse(row[field]);
      }

      return WorkOSService.of({
        apiKey,
        authenticate,
        createUser,
        listUsers,
        instanceInfo: Effect.succeed({
          clientId,
          issuer,
          providerGeneration: generation,
          port,
        }),
        jwks: Effect.succeed(publicJwks),
        getUser: (id) =>
          Effect.try({
            try: (): User => readUser(id, "body"),
            catch: operationError,
          }),
        getIdentities: (id) =>
          Effect.try({
            try: (): Identities => readUser(id, "identities"),
            catch: operationError,
          }),
      });
    }),
  );
}
