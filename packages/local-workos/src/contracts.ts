import { createHash, timingSafeEqual } from "node:crypto";
import { Schema, Data, Redacted } from "effect";
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export const equal = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
export type RejectionReason =
  | "unauthorized"
  | "unsupported_operation"
  | "invalid_client"
  | "unsupported_grant_type"
  | "invalid_grant"
  | "invalid_user"
  | "email_exists"
  | "unsupported_pagination"
  | "invalid_cursor"
  | "invalid_limit"
  | "not_found"
  | "invalid_request";
export class RequestRejected extends Data.TaggedError("RequestRejected")<{
  readonly reason: RejectionReason;
}> {}
export class VerificationRequired extends Data.TaggedError(
  "VerificationRequired",
)<{
  readonly id: string;
  readonly pending: Redacted.Redacted<string>;
}> {}
export type RequestFailure = RequestRejected | VerificationRequired;
const uuid =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
export const UserId = Schema.String.check(
  Schema.isPattern(new RegExp(`^user_${uuid}$`)),
  Schema.isLengthBetween(41, 41),
).pipe(Schema.brand("UserId"));
export const SessionId = Schema.String.check(
  Schema.isPattern(new RegExp(`^session_${uuid}$`)),
  Schema.isLengthBetween(44, 44),
).pipe(Schema.brand("SessionId"));

// Only the local password flow is supported. Extra SDK fields remain ignored.
// Raw transport values are decoded after the WorkOS security/error guards.
export const PasswordAuthenticationRequestSchema = Schema.Struct({
  client_id: Schema.String,
  client_secret: Schema.String,
  grant_type: Schema.Literal("password"),
  email: Schema.String,
  password: Schema.String.check(Schema.isMaxLength(1024)),
});
export const CreateUserRequestSchema = Schema.Struct({
  email: Schema.String.check(
    Schema.makeFilter((value) => {
      const email = value.trim().toLowerCase();
      return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }),
  ),
  password: Schema.String.check(
    Schema.makeFilter(
      (value) => [...value].length >= 12 && [...value].length <= 128,
    ),
  ),
  email_verified: Schema.optional(Schema.Boolean),
  first_name: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
  last_name: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
});
export type PasswordAuthenticationRequest =
  typeof PasswordAuthenticationRequestSchema.Type;
export type CreateUserRequest = typeof CreateUserRequestSchema.Type;

export const UserSchema = Schema.Struct({
  id: UserId,
  email: Schema.String,
  email_verified: Schema.Boolean,
  first_name: Schema.NullOr(Schema.String),
  last_name: Schema.NullOr(Schema.String),
  created_at: Schema.String,
  updated_at: Schema.String,
  object: Schema.Literal("user"),
  profile_picture_url: Schema.Null,
  external_id: Schema.Null,
  metadata: Schema.JsonObject,
});
export type User = typeof UserSchema.Type;
export const AuthenticationSchema = Schema.Struct({
  user: UserSchema,
  access_token: Schema.String,
  refresh_token: Schema.String,
  authentication_method: Schema.Literal("Password"),
  organization_id: Schema.Null,
});
export type Authentication = typeof AuthenticationSchema.Type;
export const UserListSchema = Schema.Struct({
  object: Schema.Literal("list"),
  data: Schema.Array(UserSchema),
  list_metadata: Schema.Struct({
    before: Schema.Null,
    after: Schema.NullOr(Schema.String),
  }),
});
export type UserList = typeof UserListSchema.Type;
export const IdentitiesSchema = Schema.Array(
  Schema.Struct({
    object: Schema.Literal("identity"),
    id: Schema.String,
    type: Schema.Literals(["GoogleOAuth", "AppleOAuth"]),
    provider: Schema.Literals(["GoogleOAuth", "AppleOAuth"]),
  }),
);
export type Identities = typeof IdentitiesSchema.Type;
export const JwksSchema = Schema.Struct({
  keys: Schema.Array(
    Schema.Struct({
      kty: Schema.Literal("RSA"),
      n: Schema.String,
      e: Schema.String,
      kid: Schema.String,
      alg: Schema.Literal("RS256"),
      use: Schema.Literal("sig"),
    }),
  ),
});
export type Jwks = typeof JwksSchema.Type;
