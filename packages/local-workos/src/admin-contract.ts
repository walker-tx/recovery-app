import { Schema } from "effect";
import { AdminStackId, AdminWorktree, ProviderGeneration } from "./config.ts";
import { EmailSchema, UserId, SessionId } from "./contracts.ts";

export const AdminIdentity = Schema.Struct({
  stackId: AdminStackId,
  providerGeneration: ProviderGeneration,
  worktree: AdminWorktree,
});
const list = {
  limit: Schema.optional(
    Schema.Number.check(
      Schema.isInt(),
      Schema.isBetween({ minimum: 1, maximum: 100 }),
    ),
  ),
  cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(4096))),
};
const name = Schema.String.check(Schema.isMaxLength(256));
export const AdminInputs = {
  status: Schema.Struct({}),
  "users.list": Schema.Struct({
    ...list,
    search: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
  }),
  "users.get": Schema.Struct({ userId: UserId }),
  "users.create": Schema.Struct({
    email: EmailSchema,
    password: Schema.String.check(Schema.isLengthBetween(8, 1024)),
    firstName: Schema.optional(name),
    lastName: Schema.optional(name),
    verified: Schema.optional(Schema.Boolean),
  }),
  "users.update": Schema.Struct({
    userId: UserId,
    email: Schema.optional(EmailSchema),
    firstName: Schema.optional(name),
    lastName: Schema.optional(name),
  }),
  "users.verify": Schema.Struct({ userId: UserId, verified: Schema.Boolean }),
  "users.delete": Schema.Struct({
    userId: UserId,
    confirmEmail: Schema.optional(EmailSchema),
  }),
  "sessions.list": Schema.Struct({ ...list, userId: Schema.optional(UserId) }),
  "sessions.revoke": Schema.Struct({ sessionId: SessionId }),
  "sessions.revoke-all": Schema.Struct({ userId: UserId }),
};
export const AdminRequest = Schema.Union(
  Object.entries(AdminInputs).map(([operation, input]) =>
    Schema.Struct({
      stackId: AdminStackId,
      providerGeneration: ProviderGeneration,
      operation: Schema.Literal(operation),
      input,
    }),
  ),
);
export type AdminRequest = typeof AdminRequest.Type;
export const AdminErrorCode = Schema.Literals([
  "INVALID_INPUT",
  "TARGET_MISMATCH",
  "CONFIRMATION_REQUIRED",
  "NOT_FOUND",
  "INTERNAL_ERROR",
]);
export type AdminErrorCode = typeof AdminErrorCode.Type;
export const AdminUser = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  firstName: Schema.NullOr(Schema.String),
  lastName: Schema.NullOr(Schema.String),
  verified: Schema.Boolean,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export const AdminSession = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  expiresAt: Schema.Number,
  metadataStatus: Schema.Literal("unavailable"),
});
export const AdminUserList = Schema.Struct({
  users: Schema.Array(AdminUser),
  nextCursor: Schema.NullOr(Schema.String),
});
export const AdminSessionList = Schema.Struct({
  sessions: Schema.Array(AdminSession),
  nextCursor: Schema.NullOr(Schema.String),
});
export const AdminStatus = Schema.Struct({
  users: Schema.Number,
  sessions: Schema.Number,
});
export type AdminOperation = keyof typeof AdminInputs;

export const AdminResponse = Schema.Union([
  Schema.Struct({
    ok: Schema.Literal(true),
    identity: AdminIdentity,
    data: Schema.Union([
      AdminStatus,
      AdminUser,
      AdminUserList,
      AdminSessionList,
      Schema.Struct({
        userId: Schema.String,
        deleted: Schema.Literal(true),
        affectedDomains: Schema.Array(Schema.String),
        caveat: Schema.String,
      }),
      Schema.Struct({
        sessionId: Schema.String,
        revoked: Schema.Literal(true),
        affectedDomains: Schema.Array(Schema.String),
        caveat: Schema.String,
      }),
      Schema.Struct({
        userId: Schema.String,
        revoked: Schema.Number,
        affectedDomains: Schema.Array(Schema.String),
        caveat: Schema.String,
      }),
    ]),
  }),
  Schema.Struct({
    ok: Schema.Literal(false),
    identity: AdminIdentity,
    error: Schema.Struct({
      code: AdminErrorCode,
      message: Schema.String,
      outcome: Schema.Literal("not-applied"),
    }),
  }),
]);
export type AdminResponse = typeof AdminResponse.Type;
