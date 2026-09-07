import {
  Context,
  Effect,
  Layer,
  Redacted,
  Schema,
  Clock,
  DateTime,
} from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import {
  randomUUID,
  randomBytes,
  randomInt,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { SignJWT } from "jose";
import { ConfigService, SigningIdentity } from "./config.ts";
import { sealReplay, openReplay } from "./replay-crypto.ts";
import {
  RequestRejected,
  VerificationRequired,
  type RequestFailure,
  UserId,
  UserSchema,
  AuthenticationSchema,
  RevokeSessionRequestSchema,
  EmailVerificationSchema,
  type EmailVerification,
  IdentitiesSchema,
  SessionId,
  digest,
  equal,
  PasswordAuthenticationRequestSchema,
  CreateUserRequestSchema,
  CreatePasswordResetRequestSchema,
  ResetPasswordRequestSchema,
  type PasswordReset,
  type User,
  type Authentication,
  type UserList,
  type Identities,
  type Jwks,
} from "./contracts.ts";
const derive = promisify(scrypt);
const UserJson = Schema.fromJsonString(UserSchema);
const IdentitiesJson = Schema.fromJsonString(IdentitiesSchema);
const AuthenticationJson = Schema.fromJsonString(AuthenticationSchema);
const EmailVerificationJson = Schema.fromJsonString(EmailVerificationSchema);
const ReplayAadJson = Schema.fromJsonString(
  Schema.Tuple([Schema.String, Schema.String, Schema.Number]),
);
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
    readonly apiKey: Redacted.Redacted;
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
    readonly createPasswordReset: (
      body: Record<string, unknown>,
    ) => Effect.Effect<PasswordReset, RequestFailure>;
    readonly resetPassword: (
      body: Record<string, unknown>,
    ) => Effect.Effect<{ user: User }, RequestFailure>;
    readonly revokeSession: (
      body: Record<string, unknown>,
    ) => Effect.Effect<void, RequestFailure>;
    readonly deleteUser: (id: string) => Effect.Effect<void, RequestFailure>;
    readonly getUser: (id: string) => Effect.Effect<User, RequestFailure>;
    readonly getEmailVerification: (
      id: string,
    ) => Effect.Effect<EmailVerification, RequestFailure>;
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
    const { apiKey, lifetimes } = yield* ConfigService;
    const {
      key,
      replayKey,
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
    const issueSession = Effect.fn("issueSession")(function* (
      user: User,
      now: number,
      existing?: { id: string; expires_at: number },
    ) {
      const sid = yield* Schema.decodeUnknownEffect(SessionId)(
        existing?.id ?? `session_${randomUUID()}`,
      ).pipe(Effect.orDie);
      const expires =
        existing?.expires_at ?? now + lifetimes.sessionSeconds * 1000;
      const refresh = randomBytes(32).toString("base64url");
      const access = yield* Effect.tryPromise(() =>
        new SignJWT({ client_id: clientId, sid })
          .setProtectedHeader({ alg: "RS256", kid: generation })
          .setIssuer(issuer)
          .setAudience(clientId)
          .setSubject(user.id)
          .setIssuedAt(Math.floor(now / 1000))
          .setExpirationTime(
            Math.min(
              Math.floor(expires / 1000),
              Math.floor(now / 1000) + lifetimes.accessTokenSeconds,
            ),
          )
          .sign(key),
      );
      if (existing) {
        yield* sql`UPDATE sessions SET refresh_hash=${digest(refresh)} WHERE id=${sid}`;
      } else {
        yield* sql`INSERT INTO sessions VALUES(${sid},${user.id},${digest(refresh)},${expires})`;
      }
      return {
        user,
        access_token: access,
        refresh_token: refresh,
        authentication_method: "Password" as const,
        organization_id: null,
      };
    });
    // Effects are lazy; only the provider lifecycle owns database cleanup.
    const authenticate = (body: Record<string, unknown>) =>
      Effect.gen(function* () {
        if (
          body.client_id !== clientId ||
          typeof body.client_secret !== "string" ||
          !equal(body.client_secret, Redacted.value(apiKey))
        ) {
          return yield* Effect.fail(
            new RequestRejected({ reason: "invalid_client" }),
          );
        }
        if (body.grant_type === "refresh_token") {
          if (
            typeof body.refresh_token !== "string" ||
            body.refresh_token.length > 128
          ) {
            return yield* Effect.fail(
              new RequestRejected({ reason: "invalid_grant" }),
            );
          }
          const hash = digest(body.refresh_token);
          const result = yield* sql.withTransaction(
            Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis;
              yield* sql`DELETE FROM refresh_replays WHERE expires_at<=${now} OR session_id IN (SELECT id FROM sessions WHERE expires_at<=${now})`;
              const [replay] = yield* sql<{
                session_id: string;
                expires_at: number;
                encrypted_result: string;
              }>`SELECT r.session_id,r.expires_at,r.encrypted_result FROM refresh_replays r JOIN sessions s ON s.id=r.session_id WHERE r.old_hash=${hash} AND s.expires_at>${now}`;
              if (replay) {
                const plaintext = yield* openReplay(
                  replayKey,
                  replay.encrypted_result,
                  yield* Schema.encodeEffect(ReplayAadJson)([
                    hash,
                    replay.session_id,
                    replay.expires_at,
                  ]).pipe(Effect.orDie),
                );
                return yield* Schema.decodeEffect(AuthenticationJson)(
                  plaintext,
                ).pipe(Effect.orDie);
              }
              const [session] = yield* sql<{
                id: string;
                user_id: string;
                expires_at: number;
              }>`SELECT id,user_id,expires_at FROM sessions WHERE refresh_hash=${hash}`;
              if (!session) {
                return null;
              }
              if (session.expires_at <= now) {
                yield* sql`DELETE FROM sessions WHERE id=${session.id}`;
                return null;
              }
              const [count] = yield* sql<{
                n: number;
              }>`SELECT COUNT(*) AS n FROM refresh_replays`;
              // Local capacity policy: preserve all promised grace results, reject
              // new rotations at capacity instead of evicting usable credentials.
              if (count.n >= 256) {
                return yield* Effect.fail(
                  new RequestRejected({ reason: "rate_limited" }),
                );
              }
              const row = yield* getUser(session.user_id);
              if (!row) {
                return null;
              }
              const user = yield* Schema.decodeEffect(UserJson)(row.body).pipe(
                Effect.orDie,
              );
              const pair = yield* issueSession(user, now, session);
              const expires = Math.min(now + 30000, session.expires_at);
              const encrypted = yield* sealReplay(
                replayKey,
                yield* Schema.encodeEffect(AuthenticationJson)(pair).pipe(
                  Effect.orDie,
                ),
                yield* Schema.encodeEffect(ReplayAadJson)([
                  hash,
                  session.id,
                  expires,
                ]).pipe(Effect.orDie),
              );
              yield* sql`INSERT INTO refresh_replays VALUES(${hash},${session.id},${expires},${encrypted})`;
              return pair;
            }),
          );
          return (
            result ??
            (yield* Effect.fail(
              new RequestRejected({ reason: "invalid_grant" }),
            ))
          );
        }
        if (
          body.grant_type ===
          "urn:workos:oauth:grant-type:email-verification:code"
        ) {
          if (
            typeof body.pending_authentication_token !== "string" ||
            body.pending_authentication_token.length > 128
          ) {
            return yield* Effect.fail(
              new RequestRejected({ reason: "invalid_grant" }),
            );
          }
          const pendingHash = digest(body.pending_authentication_token);
          // Return rejected outcomes rather than failing inside the transaction:
          // failed-attempt increments and expiry invalidation must commit.
          const result = yield* sql.withTransaction(
            Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis;
              const [challenge] = yield* sql<{
                id: string;
                user_id: string;
                expires_at: number;
                body: string;
                failed_attempts: number;
              }>`SELECT c.id,c.user_id,c.expires_at,v.body,v.failed_attempts FROM challenges c JOIN email_verifications v ON v.challenge_id=c.id WHERE c.pending_hash=${pendingHash}`;
              if (!challenge) {
                return null;
              }
              if (
                challenge.expires_at <= now ||
                challenge.failed_attempts >= 5
              ) {
                yield* sql`DELETE FROM challenges WHERE id=${challenge.id}`;
                return null;
              }
              const verification = yield* Schema.decodeEffect(
                EmailVerificationJson,
              )(challenge.body).pipe(Effect.orDie);
              if (
                typeof body.code !== "string" ||
                !equal(body.code, verification.code)
              ) {
                if (challenge.failed_attempts + 1 >= 5) {
                  yield* sql`DELETE FROM challenges WHERE id=${challenge.id}`;
                } else {
                  yield* sql`UPDATE email_verifications SET failed_attempts=failed_attempts+1 WHERE challenge_id=${challenge.id}`;
                }
                return null;
              }
              const row = yield* getUser(challenge.user_id);
              if (!row || verification.user_id !== challenge.user_id) {
                return null;
              }
              const saved = yield* Schema.decodeEffect(UserJson)(row.body).pipe(
                Effect.orDie,
              );
              const user = {
                ...saved,
                email_verified: true,
                updated_at: DateTime.formatIso(DateTime.makeUnsafe(now)),
              };
              yield* sql`UPDATE users SET body=${yield* Schema.encodeEffect(UserJson)(user).pipe(Effect.orDie)} WHERE id=${user.id}`;
              yield* sql`DELETE FROM challenges WHERE id=${challenge.id}`;
              return yield* issueSession(user, now);
            }),
          );
          return (
            result ??
            (yield* Effect.fail(
              new RequestRejected({ reason: "invalid_grant" }),
            ))
          );
        }
        if (body.grant_type !== "password") {
          return yield* Effect.fail(
            new RequestRejected({ reason: "unsupported_grant_type" }),
          );
        }
        // Invalid credentials still incur the synthetic-account derivation.
        const payload = yield* Schema.decodeUnknownEffect(
          PasswordAuthenticationRequestSchema,
        )(body).pipe(Effect.catch(() => Effect.succeed(undefined)));
        const email = payload?.email.trim().toLowerCase() ?? "";
        const [row] = yield* sql<Row>`SELECT * FROM users WHERE email=${email}`;
        const password = payload?.password ?? "";
        const hash = yield* Effect.tryPromise(() =>
          derive(password, row?.salt ?? "synthetic-missing-user", 64),
        ).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.instanceOf(Buffer))),
        );
        if (
          !payload ||
          !row?.verifier ||
          !timingSafeEqual(hash, Buffer.from(row.verifier, "hex"))
        ) {
          return yield* Effect.fail(
            new RequestRejected({ reason: "invalid_grant" }),
          );
        }
        // Scrypt runs outside SQLite; revalidate its exact credential snapshot
        // inside the same transaction that issues a session or challenge.
        const result = yield* sql.withTransaction(
          Effect.gen(function* () {
            const fresh = yield* getUser(row.id);
            if (
              !fresh ||
              fresh.salt !== row.salt ||
              fresh.verifier !== row.verifier
            ) {
              return null;
            }
            const now = yield* Clock.currentTimeMillis;
            const user = yield* Schema.decodeEffect(UserJson)(fresh.body).pipe(
              Effect.orDie,
            );
            if (!user.email_verified) {
              const id = `email_verification_${randomUUID()}`,
                pending = randomBytes(32).toString("base64url");
              const timestamp = DateTime.formatIso(DateTime.makeUnsafe(now));
              const verification: EmailVerification = {
                object: "email_verification",
                id,
                user_id: user.id,
                email: user.email,
                code: randomInt(1_000_000).toString().padStart(6, "0"),
                expires_at: DateTime.formatIso(
                  DateTime.makeUnsafe(
                    now + lifetimes.verificationSeconds * 1000,
                  ),
                ),
                created_at: timestamp,
                updated_at: timestamp,
              };
              yield* sql`INSERT INTO challenges VALUES(${id},${user.id},${digest(pending)},${now + lifetimes.verificationSeconds * 1000})`;
              yield* sql`INSERT INTO email_verifications (challenge_id, body) VALUES(${id},${yield* Schema.encodeEffect(EmailVerificationJson)(verification).pipe(Effect.orDie)})`;
              return new VerificationRequired({
                id,
                pending: Redacted.make(pending),
              });
            }
            return yield* issueSession(user, now);
          }),
        );
        if (result instanceof VerificationRequired) {
          return yield* Effect.fail(result);
        }
        return (
          result ??
          (yield* Effect.fail(new RequestRejected({ reason: "invalid_grant" })))
        );
      }).pipe(Effect.catch(operationFailure));
    const createPasswordReset = Effect.fn("createPasswordReset")(function* (
      body: Record<string, unknown>,
    ) {
      const payload = yield* Schema.decodeUnknownEffect(
        CreatePasswordResetRequestSchema,
      )(body).pipe(
        Effect.mapError(() => new RequestRejected({ reason: "invalid_user" })),
      );
      return yield* sql.withTransaction(
        Effect.gen(function* () {
          const email = payload.email.trim().toLowerCase();
          const [row] =
            yield* sql<Row>`SELECT * FROM users WHERE email=${email}`;
          if (!row) {
            return yield* Effect.fail(
              new RequestRejected({ reason: "not_found" }),
            );
          }
          const user = yield* Schema.decodeEffect(UserJson)(row.body).pipe(
            Effect.orDie,
          );
          const now = yield* Clock.currentTimeMillis;
          const expires = now + lifetimes.passwordResetSeconds * 1000;
          const id = `password_reset_${randomUUID()}`;
          const token = randomBytes(32).toString("base64url");
          yield* sql`INSERT INTO challenges VALUES(${id},${user.id},${digest(token)},${expires})`;
          yield* sql`INSERT INTO password_resets VALUES(${id})`;
          return {
            object: "password_reset" as const,
            id,
            user_id: user.id,
            email: user.email,
            password_reset_token: token,
            // Compatibility field only: reserved issuer has no hosted reset page.
            // Recovery owns the native link, templates and delivery.
            password_reset_url: `${issuer}/password-reset?token=${token}`,
            expires_at: DateTime.formatIso(DateTime.makeUnsafe(expires)),
            created_at: DateTime.formatIso(DateTime.makeUnsafe(now)),
          };
        }),
      );
    }, Effect.catch(operationFailure));
    const resetPassword = Effect.fn("resetPassword")(function* (
      body: Record<string, unknown>,
    ) {
      const payload = yield* Schema.decodeUnknownEffect(
        ResetPasswordRequestSchema,
      )(body).pipe(
        Effect.mapError(() => new RequestRejected({ reason: "invalid_user" })),
      );
      const salt = randomBytes(16).toString("hex");
      const verifier = (yield* Effect.tryPromise(() =>
        derive(payload.new_password, salt, 64),
      ).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.instanceOf(Buffer))),
      )).toString("hex");
      const result = yield* sql.withTransaction(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          const [reset] = yield* sql<{
            id: string;
            user_id: string;
            expires_at: number;
          }>`SELECT c.id,c.user_id,c.expires_at FROM challenges c JOIN password_resets r ON r.challenge_id=c.id WHERE c.pending_hash=${digest(payload.token)}`;
          if (!reset) {
            return null;
          }
          if (reset.expires_at <= now) {
            yield* sql`DELETE FROM challenges WHERE id=${reset.id}`;
            return null;
          }
          const row = yield* getUser(reset.user_id);
          if (!row) {
            return null;
          }
          const saved = yield* Schema.decodeEffect(UserJson)(row.body).pipe(
            Effect.orDie,
          );
          const user = {
            ...saved,
            email_verified: true,
            updated_at: DateTime.formatIso(DateTime.makeUnsafe(now)),
          };
          yield* sql`UPDATE users SET body=${yield* Schema.encodeEffect(UserJson)(user).pipe(Effect.orDie)},salt=${salt},verifier=${verifier} WHERE id=${user.id}`;
          yield* sql`DELETE FROM sessions WHERE user_id=${user.id}`;
          yield* sql`DELETE FROM challenges WHERE user_id=${user.id}`;
          return { user };
        }),
      );
      return (
        result ??
        (yield* Effect.fail(
          new RequestRejected({ reason: "invalid_reset_token" }),
        ))
      );
    }, Effect.catch(operationFailure));
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
        const verifier = (yield* Effect.tryPromise(() =>
          derive(payload.password, salt, 64),
        ).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.instanceOf(Buffer))),
        )).toString("hex");
        const timestamp = yield* Clock.currentTimeMillis;
        const now = DateTime.formatIso(DateTime.makeUnsafe(timestamp));
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
        const userJson = yield* Schema.encodeEffect(UserJson)(user).pipe(
          Effect.orDie,
        );
        yield* sql`INSERT INTO users VALUES(${user.id},${email},${userJson},${salt},${verifier},${"[]"})`.pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              const rows =
                yield* sql`SELECT id FROM users WHERE email=${email}`;
              if (rows.length) {
                return yield* Effect.fail(
                  new RequestRejected({ reason: "email_exists" }),
                );
              }
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
        ) {
          return yield* Effect.fail(
            new RequestRejected({ reason: "unsupported_pagination" }),
          );
        }
        const after = url.searchParams.get("after");
        if (
          after !== null &&
          (!(yield* Schema.decodeUnknownEffect(UserId)(after).pipe(
            Effect.map(() => true),
            Effect.catch(() => Effect.succeed(false)),
          )) ||
            !(yield* getUser(after)))
        ) {
          return yield* Effect.fail(
            new RequestRejected({ reason: "invalid_cursor" }),
          );
        }
        const limit = Number(url.searchParams.get("limit") ?? 10);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          return yield* Effect.fail(
            new RequestRejected({ reason: "invalid_limit" }),
          );
        }
        const email = url.searchParams.get("email")?.trim().toLowerCase();
        const descending = url.searchParams.get("order") === "desc";
        const rows = yield* sql.unsafe<Row>(
          `SELECT * FROM users WHERE (? IS NULL OR email=?) AND (? IS NULL OR id ${descending ? "<" : ">"} ?) ORDER BY id ${descending ? "DESC" : "ASC"} LIMIT ?`,
          [email ?? null, email ?? null, after, after, limit + 1],
        );
        return {
          object: "list" as const,
          data: yield* Effect.forEach(rows.slice(0, limit), (row) =>
            Schema.decodeEffect(UserJson)(row.body).pipe(Effect.orDie),
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
        if (!row) {
          return yield* Effect.fail(
            new RequestRejected({ reason: "not_found" }),
          );
        }
        return row[field];
      }).pipe(Effect.catch(operationFailure));
    }

    return WorkOSService.of({
      apiKey,
      authenticate,
      createUser,
      createPasswordReset,
      resetPassword,
      revokeSession: Effect.fn("revokeSession")(function* (
        body: Record<string, unknown>,
      ) {
        const payload = yield* Schema.decodeUnknownEffect(
          RevokeSessionRequestSchema,
        )(body).pipe(
          Effect.mapError(() => new RequestRejected({ reason: "not_found" })),
        );
        yield* sql.withTransaction(
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const [session] =
              yield* sql`SELECT id FROM sessions WHERE id=${payload.session_id} AND expires_at>${now}`;
            if (!session) {
              return yield* Effect.fail(
                new RequestRejected({ reason: "not_found" }),
              );
            }
            yield* sql`DELETE FROM sessions WHERE id=${payload.session_id}`;
            return undefined;
          }),
        );
      }, Effect.catch(operationFailure)),

      deleteUser: Effect.fn("deleteUser")(function* (id: string) {
        const userId = yield* Schema.decodeUnknownEffect(UserId)(id).pipe(
          Effect.mapError(() => new RequestRejected({ reason: "not_found" })),
        );
        // One statement atomically cascades sessions, replay results and challenges.
        const deleted =
          yield* sql`DELETE FROM users WHERE id=${userId} RETURNING id`;
        if (deleted.length === 0) {
          return yield* Effect.fail(
            new RequestRejected({ reason: "not_found" }),
          );
        }
        return undefined;
      }, Effect.catch(operationFailure)),
      listUsers,
      getEmailVerification: Effect.fn("getEmailVerification")(function* (
        id: string,
      ) {
        const now = yield* Clock.currentTimeMillis;
        const [row] = yield* sql<{
          body: string;
        }>`SELECT v.body FROM email_verifications v JOIN challenges c ON c.id=v.challenge_id WHERE c.id=${id} AND c.expires_at>${now}`;
        if (!row) {
          return yield* Effect.fail(
            new RequestRejected({ reason: "not_found" }),
          );
        }
        return yield* Schema.decodeEffect(EmailVerificationJson)(row.body).pipe(
          Effect.orDie,
        );
      }, Effect.catch(operationFailure)),
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
            Schema.decodeEffect(UserJson)(value).pipe(Effect.orDie),
          ),
        ),
      getIdentities: (id) =>
        readUser(id, "identities").pipe(
          Effect.flatMap((value) =>
            Schema.decodeEffect(IdentitiesJson)(value).pipe(Effect.orDie),
          ),
        ),
    });
  }),
);
