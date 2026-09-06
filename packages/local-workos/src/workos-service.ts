import { Context, Effect, Layer, Config, Redacted, Schema } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
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
// The provider scope owns the SQL client; operations share that one connection.
export function workosLayer(
  key: Awaited<ReturnType<typeof importJWK>>,
  publicJwks: Jwks,
  apiKey: Redacted.Redacted<string>,
) {
  return Layer.effect(
    WorkOSService,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const clientId = yield* httpClientId;
      const issuer = yield* Config.string("issuer");
      const generation = yield* Config.string("providerGeneration");
      const port = yield* Config.number("port");
      const getUser = (id: string) =>
        sql<Row>`SELECT * FROM users WHERE id=${id}`.pipe(
          Effect.map((rows) => rows[0]),
        );
      // Effects are lazy; only the provider lifecycle owns database cleanup.
      const authenticate = (body: Record<string, unknown>) =>
        Effect.gen(function* () {
          if (
            body.client_id !== clientId ||
            typeof body.client_secret !== "string" ||
            !equal(body.client_secret, Redacted.value(apiKey))
          )
            return yield* Effect.fail(
              new HttpError(401, {
                code: "invalid_client",
                message: "invalid_client",
              }),
            );
          if (body.grant_type !== "password")
            return yield* Effect.fail(
              new HttpError(400, {
                code: "unsupported_grant_type",
                message: "unsupported_grant_type",
              }),
            );
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
          const [row] =
            yield* sql<Row>`SELECT * FROM users WHERE email=${email}`;
          const password = payload?.password ?? "";
          const hash = (yield* Effect.tryPromise({
            try: () =>
              derive(password, row?.salt ?? "synthetic-missing-user", 64),
            catch: operationError,
          })) as Buffer;
          if (
            !payload ||
            !row?.verifier ||
            !timingSafeEqual(hash, Buffer.from(row.verifier, "hex"))
          )
            return yield* Effect.fail(
              new HttpError(400, {
                error: "invalid_grant",
                error_description: "Invalid credentials",
              }),
            );
          const user: User = JSON.parse(row.body);
          if (!user.email_verified) {
            const id = `email_verification_${randomUUID()}`,
              pending = randomBytes(32).toString("base64url");
            yield* sql`INSERT INTO challenges VALUES(${id},${user.id},${digest(pending)},${Date.now() + 600000})`;
            return yield* Effect.fail(
              new HttpError(400, {
                code: "email_verification_required",
                message: "Email verification required",
                email_verification_id: id,
                pending_authentication_token: pending,
              }),
            );
          }
          const sid = `session_${randomUUID()}`,
            refresh = randomBytes(32).toString("base64url");
          const access = yield* Effect.tryPromise({
            try: () =>
              new SignJWT({ client_id: clientId, sid })
                .setProtectedHeader({ alg: "RS256", kid: generation })
                .setIssuer(issuer)
                .setAudience(clientId)
                .setSubject(user.id)
                .setIssuedAt()
                .setExpirationTime("5m")
                .sign(key),
            catch: operationError,
          });
          yield* sql`INSERT INTO sessions VALUES(${sid},${user.id},${digest(refresh)},${Date.now() + 7 * 86400000})`;
          return {
            user,
            access_token: access,
            refresh_token: refresh,
            authentication_method: "Password" as const,
            organization_id: null,
          };
        }).pipe(
          Effect.mapError(operationError),
          Effect.catchDefect((error) => Effect.fail(operationError(error))),
        );
      const createUser = (body: Record<string, unknown>) =>
        Effect.gen(function* () {
          let payload: CreateUserRequest;
          try {
            payload = Schema.decodeUnknownSync(CreateUserRequestSchema)(body);
          } catch {
            return yield* Effect.fail(
              new HttpError(422, {
                code: "invalid_user",
                message: "invalid_user",
              }),
            );
          }
          const email = payload.email.trim().toLowerCase();
          const salt = randomBytes(16).toString("hex");
          const verifier = (
            (yield* Effect.tryPromise({
              try: () => derive(payload.password, salt, 64),
              catch: operationError,
            })) as Buffer
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
          yield* sql`INSERT INTO users VALUES(${user.id},${email},${JSON.stringify(user)},${salt},${verifier},${"[]"})`.pipe(
            Effect.catch((error) =>
              Effect.gen(function* () {
                const rows =
                  yield* sql`SELECT id FROM users WHERE email=${email}`;
                if (rows.length)
                  return yield* Effect.fail(
                    new HttpError(409, {
                      code: "email_exists",
                      message: "email_exists",
                    }),
                  );
                return yield* Effect.fail(error);
              }),
            ),
          );
          return user;
        }).pipe(
          Effect.mapError(operationError),
          Effect.catchDefect((error) => Effect.fail(operationError(error))),
        );
      const listUsers = (rawUrl: string) =>
        Effect.gen(function* () {
          const url = new URL(rawUrl, "http://127.0.0.1");
          if (
            url.searchParams.has("before") ||
            (url.searchParams.has("order") &&
              !["asc", "desc"].includes(url.searchParams.get("order")!))
          )
            return yield* Effect.fail(
              new HttpError(422, {
                code: "unsupported_pagination",
                message: "unsupported_pagination",
              }),
            );
          const after = url.searchParams.get("after");
          if (
            after !== null &&
            (!/^user_[0-9a-f-]{36}$/.test(after) || !(yield* getUser(after)))
          )
            return yield* Effect.fail(
              new HttpError(422, {
                code: "invalid_cursor",
                message: "invalid_cursor",
              }),
            );
          const limit = Number(url.searchParams.get("limit") ?? 10);
          if (!Number.isInteger(limit) || limit < 1 || limit > 100)
            return yield* Effect.fail(
              new HttpError(422, {
                code: "invalid_limit",
                message: "invalid_limit",
              }),
            );
          const email = url.searchParams.get("email")?.trim().toLowerCase();
          const descending = url.searchParams.get("order") === "desc";
          const rows = yield* sql.unsafe<Row>(
            `SELECT * FROM users WHERE (? IS NULL OR email=?) AND (? IS NULL OR id ${descending ? "<" : ">"} ?) ORDER BY id ${descending ? "DESC" : "ASC"} LIMIT ?`,
            [email ?? null, email ?? null, after, after, limit + 1],
          );
          return {
            object: "list" as const,
            data: rows.slice(0, limit).map((r) => JSON.parse(r.body)),
            list_metadata: {
              before: null,
              after: rows.length > limit ? rows[limit - 1].id : null,
            },
          };
        }).pipe(
          Effect.mapError(operationError),
          Effect.catchDefect((error) => Effect.fail(operationError(error))),
        );
      function readUser<A>(id: string, field: "body" | "identities") {
        return Effect.gen(function* () {
          const row = yield* getUser(id);
          if (!row)
            return yield* Effect.fail(
              new HttpError(404, { code: "not_found", message: "not_found" }),
            );
          return yield* Effect.try({
            try: (): A => JSON.parse(row[field]),
            catch: operationError,
          });
        }).pipe(Effect.mapError(operationError));
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
        getUser: (id) => readUser<User>(id, "body"),
        getIdentities: (id) => readUser<Identities>(id, "identities"),
      });
    }),
  );
}
