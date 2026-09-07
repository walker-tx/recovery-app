import * as NodePath from "@effect/platform-node/NodePath";
import {
  Layer,
  Context,
  Clock,
  Data,
  DateTime,
  Effect,
  Path,
  FileSystem,
  Schema,
  Predicate,
} from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { HttpServerRequest } from "effect/unstable/http/HttpServerRequest";
import { MaxBodySize } from "effect/unstable/http/HttpIncomingMessage";
import * as Response from "effect/unstable/http/HttpServerResponse";
import {
  lstatSync,
  chmodSync,
  mkdtempSync,
  linkSync,
  unlinkSync,
  rmdirSync,
  // oxlint-disable-next-line effecttsgo/node-builtin-import -- Unix socket ownership requires native inode operations.
} from "node:fs";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Native server factory required by NodeHttpServer.
import { createServer } from "node:http";
import {
  AdminInputs,
  AdminIdentity,
  type AdminErrorCode,
} from "../contracts/admin.ts";

import { AdminStackId, ProviderGeneration } from "../contracts/identity.ts";
import {
  UserSchema,
  type User,
  type RequestFailure,
} from "../contracts/workos.ts";
import type { ProviderClearError } from "./provider.ts";
import type { WorkOSService } from "./workos-service.ts";

// NodePath.layer is a resource-free synchronous layer using the host path implementation.
const hostPath = Context.get(
  Effect.runSync(Effect.scoped(Layer.build(NodePath.layer))),
  Path.Path,
);

class AdminFailure extends Data.TaggedError("AdminFailure")<{
  code: AdminErrorCode;
}> {}
const invalid = () => new AdminFailure({ code: "INVALID_INPUT" });
const decode = <S extends Schema.Top>(schema: S, input: unknown) =>
  Schema.decodeUnknownEffect(schema)(input, { onExcessProperty: "error" }).pipe(
    Effect.mapError(invalid),
  );
const dto = (user: User) => ({
  id: user.id,
  email: user.email,
  firstName: user.first_name,
  lastName: user.last_name,
  verified: user.email_verified,
  createdAt: user.created_at,
  updatedAt: user.updated_at,
});
const Envelope = Schema.Struct({
  stackId: AdminStackId,
  providerGeneration: ProviderGeneration,
  operation: Schema.String,
  input: Schema.Unknown,
});
const Cursor = Schema.Struct({ binding: Schema.String, last: Schema.String });
const caveat =
  "Revocation prevents refresh; already-issued JWTs may remain valid until expiry.";
const serviceFailure = (error: RequestFailure) =>
  new AdminFailure({
    code:
      Predicate.isTagged(error, "RequestRejected") &&
      error.reason === "not_found"
        ? "NOT_FOUND"
        : "INVALID_INPUT",
  });

export const acquireAdminServer = Effect.fn("acquireAdminServer")(function* (
  options: { socketPath: string; stackId: string; worktree: string },
  providerGeneration: string,
  sql: SqlClient.SqlClient,
  service: WorkOSService["Service"],
  requireOwnedIdentity: Effect.Effect<void, ProviderClearError | SqlError>,
) {
  const identity = yield* decode(AdminIdentity, {
    stackId: options.stackId,
    providerGeneration,
    worktree: options.worktree,
  });
  yield* Effect.try(() => {
    if (
      !hostPath.isAbsolute(options.socketPath) ||
      Buffer.byteLength(options.socketPath) > 100 ||
      !options.stackId ||
      !hostPath.isAbsolute(options.worktree)
    ) {
      throw new Error("Invalid private admin socket configuration");
    }
    let path = hostPath.dirname(options.socketPath);
    const parent = lstatSync(path);
    if (
      !parent.isDirectory() ||
      parent.uid !== process.getuid?.() ||
      (parent.mode & 0o777) !== 0o700
    ) {
      throw new Error(
        "Admin socket parent must be an owner-only 0700 directory",
      );
    }
    while (path !== hostPath.dirname(path)) {
      if (lstatSync(path).isSymbolicLink()) {
        throw new Error("Admin socket ancestors must not be symlinks");
      }
      path = hostPath.dirname(path);
    }
    try {
      lstatSync(options.socketPath);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return;
      }
      throw error;
    }
    throw new Error(
      "Admin socket path is occupied; verify ownership and remove stale state before retrying",
    );
  });
  const run = Effect.fn("admin.operation")(function* (body: unknown) {
    const request = yield* decode(Envelope, body);
    if (
      request.stackId !== identity.stackId ||
      request.providerGeneration !== providerGeneration
    ) {
      return yield* new AdminFailure({ code: "TARGET_MISMATCH" });
    }
    yield* requireOwnedIdentity.pipe(
      Effect.mapError(() => new AdminFailure({ code: "TARGET_MISMATCH" })),
    );
    const input = request.input;
    const get = (id: string) =>
      service.getUser(id).pipe(Effect.mapError(serviceFailure));
    switch (request.operation) {
      case "status": {
        yield* decode(AdminInputs.status, input);
        const [users] = yield* sql<{
          count: number;
        }>`SELECT count(*) AS count FROM users`;
        const [sessions] = yield* sql<{
          count: number;
        }>`SELECT count(*) AS count FROM sessions WHERE expires_at>${yield* Clock.currentTimeMillis}`;
        return { users: users.count, sessions: sessions.count };
      }
      case "users.create": {
        const data = yield* decode(AdminInputs["users.create"], input);
        return dto(
          yield* service
            .createUser({
              email: data.email,
              password: data.password,
              first_name: data.firstName === "" ? undefined : data.firstName,
              last_name: data.lastName === "" ? undefined : data.lastName,
              email_verified: data.verified,
            })
            .pipe(Effect.mapError(serviceFailure)),
        );
      }
      case "users.get": {
        const data = yield* decode(AdminInputs["users.get"], input);
        return dto(yield* get(data.userId));
      }
      case "users.update":
      case "users.verify": {
        const data = yield* decode(
          request.operation === "users.update"
            ? AdminInputs["users.update"]
            : AdminInputs["users.verify"],
          input,
        );
        const user = yield* get(data.userId);
        const updated = {
          ...user,
          updated_at: DateTime.formatIso(
            DateTime.makeUnsafe(yield* Clock.currentTimeMillis),
          ),
          ...("email" in data && data.email !== undefined
            ? { email: data.email.trim().toLowerCase(), email_verified: false }
            : {}),
          ...("firstName" in data && data.firstName !== undefined
            ? { first_name: data.firstName }
            : {}),
          ...("lastName" in data && data.lastName !== undefined
            ? { last_name: data.lastName }
            : {}),
          ...("verified" in data ? { email_verified: data.verified } : {}),
        };
        const conflict =
          yield* sql`SELECT id FROM users WHERE email=${updated.email} AND id<>${user.id}`;
        if (conflict.length > 0) {
          return yield* invalid();
        }
        yield* sql`UPDATE users SET email=${updated.email},body=${yield* Schema.encodeEffect(Schema.fromJsonString(UserSchema))(updated)} WHERE id=${user.id}`;
        return dto(updated);
      }
      case "users.delete":
      case "sessions.revoke-all": {
        const data = yield* decode(
          request.operation === "users.delete"
            ? AdminInputs["users.delete"]
            : AdminInputs["sessions.revoke-all"],
          input,
        );
        const user = yield* get(data.userId);
        if (
          request.operation === "users.delete" &&
          (!("confirmEmail" in data) || data.confirmEmail !== user.email)
        ) {
          return yield* new AdminFailure({ code: "CONFIRMATION_REQUIRED" });
        }
        if (request.operation === "users.delete") {
          yield* service
            .deleteUser(user.id)
            .pipe(Effect.mapError(serviceFailure));
          return {
            userId: user.id,
            deleted: true,
            affectedDomains: ["users", "sessions", "challenges"],
            caveat,
          };
        }
        const deleted =
          yield* sql`DELETE FROM sessions WHERE user_id=${user.id} RETURNING id`;
        return {
          userId: user.id,
          revoked: deleted.length,
          affectedDomains: ["sessions"],
          caveat,
        };
      }
      case "sessions.revoke": {
        const data = yield* decode(AdminInputs["sessions.revoke"], input);
        yield* service
          .revokeSession({ session_id: data.sessionId })
          .pipe(Effect.mapError(serviceFailure));
        return {
          sessionId: data.sessionId,
          revoked: true,
          affectedDomains: ["sessions"],
          caveat,
        };
      }
      case "users.list":
      case "sessions.list": {
        const data = yield* decode(
          request.operation === "users.list"
            ? AdminInputs["users.list"]
            : AdminInputs["sessions.list"],
          input,
        );
        const limit = data.limit ?? 50;
        const search = "search" in data ? (data.search ?? "") : "";
        const userId = "userId" in data ? (data.userId ?? "") : "";
        const binding = yield* Schema.encodeEffect(
          Schema.fromJsonString(Schema.Unknown),
        )([
          identity.stackId,
          providerGeneration,
          request.operation,
          limit,
          search,
          userId,
        ]);
        let last = "";
        if (data.cursor !== undefined) {
          const cursor = yield* decode(
            Schema.fromJsonString(Cursor),
            Buffer.from(data.cursor, "base64url").toString(),
          );
          if (cursor.binding !== binding) {
            return yield* invalid();
          }
          last = cursor.last;
        }
        if (request.operation === "users.list") {
          const rows = yield* sql<{
            id: string;
            body: string;
          }>`SELECT id,body FROM users WHERE id>${last} AND (instr(lower(email),lower(${search}))>0 OR instr(lower(json_extract(body,'$.first_name')),lower(${search}))>0 OR instr(lower(json_extract(body,'$.last_name')),lower(${search}))>0) ORDER BY id LIMIT ${limit + 1}`;
          const users = yield* Effect.forEach(rows.slice(0, limit), (row) =>
            Schema.decodeUnknownEffect(Schema.fromJsonString(UserSchema))(
              row.body,
            ).pipe(Effect.map(dto)),
          );
          return {
            users,
            nextCursor:
              rows.length > limit
                ? Buffer.from(
                    yield* Schema.encodeEffect(Schema.fromJsonString(Cursor))({
                      binding,
                      last: rows[limit - 1].id,
                    }),
                  ).toString("base64url")
                : null,
          };
        }
        const rows = yield* sql<{
          id: string;
          userId: string;
          expiresAt: number;
        }>`SELECT id,user_id AS userId,expires_at AS expiresAt FROM sessions WHERE id>${last} AND (${userId}='' OR user_id=${userId}) AND expires_at>${yield* Clock.currentTimeMillis} ORDER BY id LIMIT ${limit + 1}`;
        return {
          sessions: rows.slice(0, limit).map((row) => ({
            ...row,
            metadataStatus: "unavailable",
          })),
          nextCursor:
            rows.length > limit
              ? Buffer.from(
                  yield* Schema.encodeEffect(Schema.fromJsonString(Cursor))({
                    binding,
                    last: rows[limit - 1].id,
                  }),
                ).toString("base64url")
              : null,
        };
      }
      default:
        return yield* invalid();
    }
  });
  const failure = (code: AdminErrorCode) =>
    Response.jsonUnsafe({
      ok: false,
      identity,
      error: {
        code,
        message: code.replaceAll("_", " ").toLowerCase(),
        outcome: "not-applied",
      },
    });
  const app = Effect.gen(function* () {
    const request = yield* HttpServerRequest;
    if (request.method !== "POST" || request.url !== "/v1/admin") {
      return failure("INVALID_INPUT");
    }
    const body = yield* request.json.pipe(Effect.mapError(invalid));
    const result = yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const data = yield* run(body);
          const encoded = yield* Schema.encodeEffect(
            Schema.fromJsonString(Schema.Unknown),
          )({ ok: true, identity, data });
          if (Buffer.byteLength(encoded) > 1048576) {
            return yield* new AdminFailure({ code: "INTERNAL_ERROR" });
          }
          return encoded;
        }),
      )
      .pipe(Effect.timeout("4 seconds"));
    return Response.text(result, { contentType: "application/json" });
  }).pipe(
    Effect.catch((error) =>
      Effect.succeed(
        failure(error instanceof AdminFailure ? error.code : "INTERNAL_ERROR"),
      ),
    ),
    Effect.provideService(MaxBodySize, FileSystem.Size(1048576)),
  );
  // libuv unlinks its original bind path without checking its inode. Bind in
  // a private temporary directory, then publish without clobbering; we own final cleanup.
  const staging = yield* Effect.acquireRelease(
    Effect.try(() =>
      mkdtempSync(
        hostPath.join(hostPath.dirname(options.socketPath), ".admin-"),
      ),
    ),
    (path) => Effect.sync(() => rmdirSync(path)),
  );
  const bindPath = hostPath.join(staging, "s");
  yield* Effect.try(() => {
    if (Buffer.byteLength(bindPath) > 100) {
      throw new Error("Admin socket parent path is too long");
    }
  });
  const server = yield* NodeHttpServer.make(
    () => {
      const native = createServer({
        requestTimeout: 5000,
        headersTimeout: 5000,
      });
      native.setTimeout(5000);
      return native;
    },
    { path: bindPath, gracefulShutdownTimeout: "2 seconds" },
  ).pipe(Effect.uninterruptible);
  const owned = yield* Effect.acquireRelease(
    Effect.try(() => {
      chmodSync(bindPath, 0o600);
      const inode = lstatSync(bindPath);
      // Do not overwrite an occupied path appearing during acquisition.
      try {
        lstatSync(options.socketPath);
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          linkSync(bindPath, options.socketPath);
          unlinkSync(bindPath);
          return inode;
        }
        throw error;
      }
      throw new Error("Admin socket path became occupied");
    }),
    (inode) =>
      Effect.sync(() => {
        try {
          const current = lstatSync(options.socketPath);
          if (
            current.isSocket() &&
            current.dev === inode.dev &&
            current.ino === inode.ino &&
            current.uid === inode.uid
          ) {
            unlinkSync(options.socketPath);
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
      }),
  );
  yield* Effect.sync(() => {
    if (!owned.isSocket()) {
      throw new Error("Invalid admin socket");
    }
  });
  yield* server.serve(app);
});
