import { Context, Effect, Layer, Redacted, Schema, Clock } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { randomUUID, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { SignJWT } from "jose";
import { ConfigService, SigningIdentity } from "./config.ts";
import {
  RequestRejected,
  VerificationRequired,
  type RequestFailure,
  UserId,
  UserSchema,
  IdentitiesSchema,
  SessionId,
  digest,
  equal,
  PasswordAuthenticationRequestSchema,
  CreateUserRequestSchema,
  type User,
  type Authentication,
  type UserList,
  type Identities,
  type Jwks,
} from "./contracts.ts";
const derive = promisify(scrypt);
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
    ) => Effect.Effect<Authentication, RequestFailure>;
    readonly createUser: (
      body: Record<string, unknown>,
    ) => Effect.Effect<User, RequestFailure>;
    readonly listUsers: (
      url: string,
    ) => Effect.Effect<UserList, RequestFailure>;
    readonly getUser: (id: string) => Effect.Effect<User, RequestFailure>;
    readonly getIdentities: (
      id: string,
    ) => Effect.Effect<Identities, RequestFailure>;
  }
>()("local-workos/WorkOSService") {}
const operationFailure = (error: unknown) =>
  error instanceof RequestRejected || error instanceof VerificationRequired
    ? Effect.fail(error)
    : Effect.die(error);
// The provider scope owns the SQL client; operations share that one connection.
export const workosLayer = Layer.effect(
  WorkOSService,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const { apiKey } = yield* ConfigService;
    const {
      key,
      jwks: publicJwks,
      clientId,
      issuer,
      providerGeneration: generation,
      port,
    } = yield* SigningIdentity;
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
            new RequestRejected({ reason: "invalid_client" }),
          );
        if (body.grant_type !== "password")
          return yield* Effect.fail(
            new RequestRejected({ reason: "unsupported_grant_type" }),
          );
        // Invalid credentials still incur the synthetic-account derivation.
        const payload = yield* Schema.decodeUnknownEffect(
          PasswordAuthenticationRequestSchema,
        )(body).pipe(Effect.catch(() => Effect.succeed(undefined)));
        const email = payload?.email.trim().toLowerCase() ?? "";
        const [row] = yield* sql<Row>`SELECT * FROM users WHERE email=${email}`;
        const password = payload?.password ?? "";
        const hash = (yield* Effect.tryPromise({
          try: () =>
            derive(password, row?.salt ?? "synthetic-missing-user", 64),
          catch: (error) => error,
        })) as Buffer;
        if (
          !payload ||
          !row?.verifier ||
          !timingSafeEqual(hash, Buffer.from(row.verifier, "hex"))
        )
          return yield* Effect.fail(
            new RequestRejected({ reason: "invalid_grant" }),
          );
        const now = yield* Clock.currentTimeMillis;
        const user = yield* Schema.decodeUnknownEffect(UserSchema)(
          JSON.parse(row.body),
        ).pipe(Effect.orDie);
        if (!user.email_verified) {
          const id = `email_verification_${randomUUID()}`,
            pending = randomBytes(32).toString("base64url");
          yield* sql`INSERT INTO challenges VALUES(${id},${user.id},${digest(pending)},${now + 600000})`;
          return yield* Effect.fail(
            new VerificationRequired({ id, pending: Redacted.make(pending) }),
          );
        }
        const sid = yield* Schema.decodeUnknownEffect(SessionId)(
          `session_${randomUUID()}`,
        ).pipe(Effect.orDie);
        const refresh = randomBytes(32).toString("base64url");
        const access = yield* Effect.tryPromise({
          try: () =>
            new SignJWT({ client_id: clientId, sid })
              .setProtectedHeader({ alg: "RS256", kid: generation })
              .setIssuer(issuer)
              .setAudience(clientId)
              .setSubject(user.id)
              .setIssuedAt(Math.floor(now / 1000))
              .setExpirationTime(Math.floor(now / 1000) + 300)
              .sign(key),
          catch: (error) => error,
        });
        yield* sql`INSERT INTO sessions VALUES(${sid},${user.id},${digest(refresh)},${now + 7 * 86400000})`;
        return {
          user,
          access_token: access,
          refresh_token: refresh,
          authentication_method: "Password" as const,
          organization_id: null,
        };
      }).pipe(Effect.catch(operationFailure));
    const createUser = (body: Record<string, unknown>) =>
      Effect.gen(function* () {
        const payload = yield* Schema.decodeUnknownEffect(
          CreateUserRequestSchema,
        )(body).pipe(
          Effect.mapError(
            () => new RequestRejected({ reason: "invalid_user" }),
          ),
        );
        const email = payload.email.trim().toLowerCase();
        const salt = randomBytes(16).toString("hex");
        const verifier = (
          (yield* Effect.tryPromise({
            try: () => derive(payload.password, salt, 64),
            catch: (error) => error,
          })) as Buffer
        ).toString("hex");
        const now = new Date(yield* Clock.currentTimeMillis).toISOString();
        const user: User = {
          id: yield* Schema.decodeUnknownEffect(UserId)(
            `user_${randomUUID()}`,
          ).pipe(Effect.orDie),
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
                  new RequestRejected({ reason: "email_exists" }),
                );
              return yield* Effect.fail(error);
            }),
          ),
        );
        return user;
      }).pipe(Effect.catch(operationFailure));
    const listUsers = (rawUrl: string) =>
      Effect.gen(function* () {
        const url = new URL(rawUrl, "http://127.0.0.1");
        if (
          url.searchParams.has("before") ||
          (url.searchParams.has("order") &&
            !["asc", "desc"].includes(url.searchParams.get("order")!))
        )
          return yield* Effect.fail(
            new RequestRejected({ reason: "unsupported_pagination" }),
          );
        const after = url.searchParams.get("after");
        if (
          after !== null &&
          (!(yield* Schema.decodeUnknownEffect(UserId)(after).pipe(
            Effect.map(() => true),
            Effect.catch(() => Effect.succeed(false)),
          )) ||
            !(yield* getUser(after)))
        )
          return yield* Effect.fail(
            new RequestRejected({ reason: "invalid_cursor" }),
          );
        const limit = Number(url.searchParams.get("limit") ?? 10);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100)
          return yield* Effect.fail(
            new RequestRejected({ reason: "invalid_limit" }),
          );
        const email = url.searchParams.get("email")?.trim().toLowerCase();
        const descending = url.searchParams.get("order") === "desc";
        const rows = yield* sql.unsafe<Row>(
          `SELECT * FROM users WHERE (? IS NULL OR email=?) AND (? IS NULL OR id ${descending ? "<" : ">"} ?) ORDER BY id ${descending ? "DESC" : "ASC"} LIMIT ?`,
          [email ?? null, email ?? null, after, after, limit + 1],
        );
        return {
          object: "list" as const,
          data: yield* Effect.forEach(rows.slice(0, limit), (row) =>
            Schema.decodeUnknownEffect(UserSchema)(JSON.parse(row.body)).pipe(
              Effect.orDie,
            ),
          ),
          list_metadata: {
            before: null,
            after: rows.length > limit ? rows[limit - 1].id : null,
          },
        };
      }).pipe(Effect.catch(operationFailure));
    function readUser(id: string, field: "body" | "identities") {
      return Effect.gen(function* () {
        const userId = yield* Schema.decodeUnknownEffect(UserId)(id).pipe(
          Effect.mapError(() => new RequestRejected({ reason: "not_found" })),
        );
        const row = yield* getUser(userId);
        if (!row)
          return yield* Effect.fail(
            new RequestRejected({ reason: "not_found" }),
          );
        return yield* Effect.try({
          try: (): unknown => JSON.parse(row[field]),
          catch: (error) => error,
        });
      }).pipe(Effect.catch(operationFailure));
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
        readUser(id, "body").pipe(
          Effect.flatMap((value) =>
            Schema.decodeUnknownEffect(UserSchema)(value).pipe(Effect.orDie),
          ),
        ),
      getIdentities: (id) =>
        readUser(id, "identities").pipe(
          Effect.flatMap((value) =>
            Schema.decodeUnknownEffect(IdentitiesSchema)(value).pipe(
              Effect.orDie,
            ),
          ),
        ),
    });
  }),
);
