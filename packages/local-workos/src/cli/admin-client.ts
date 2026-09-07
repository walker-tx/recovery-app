import * as Undici from "@effect/platform-node/Undici";
import { NodeHttpClient } from "@effect/platform-node";
import { Effect, Schema, Stream } from "effect";
import { HttpClientRequest } from "effect/unstable/http";
import { AdminResponse, AdminUser, AdminSession } from "../contracts/admin.ts";
import { failure } from "./output.ts";

export type Selection = {
  worktree: string;
  stackId: string;
  providerGeneration: string;
  adminSocket: string;
  providerState: "running" | "stopped" | "starting";
  inbox: { baseUrl: string; epoch: string } | null;
  record: unknown;
};
export type AdminTarget = Pick<
  Selection,
  "worktree" | "stackId" | "providerGeneration" | "adminSocket"
>;
export const isMutation = (operation: string) =>
  ![
    "status",
    "users.list",
    "users.get",
    "sessions.list",
    "inbox.list",
  ].includes(operation);
const schemas = {
  status: Schema.Struct({ users: Schema.Int, sessions: Schema.Int }),
  "users.delete": Schema.Struct({
    userId: Schema.String,
    deleted: Schema.Literal(true),
    affectedDomains: Schema.Array(Schema.String),
    caveat: Schema.String,
  }),
  "sessions.revoke": Schema.Struct({
    sessionId: Schema.String,
    revoked: Schema.Literal(true),
    affectedDomains: Schema.Array(Schema.String),
    caveat: Schema.String,
  }),
  "sessions.revoke-all": Schema.Struct({
    userId: Schema.String,
    revoked: Schema.Int,
    affectedDomains: Schema.Array(Schema.String),
    caveat: Schema.String,
  }),
  "users.list": Schema.Struct({
    users: Schema.Array(AdminUser),
    nextCursor: Schema.NullOr(Schema.String),
  }),
  "users.get": AdminUser,
  "users.create": AdminUser,
  "users.update": AdminUser,
  "users.verify": AdminUser,
  "sessions.list": Schema.Struct({
    sessions: Schema.Array(AdminSession),
    nextCursor: Schema.NullOr(Schema.String),
  }),
};
export const adminRequest = Effect.fn("mock.adminRequest")(function* (
  target: AdminTarget,
  operation: string,
  input: Record<string, unknown>,
  onDispatch: () => void,
) {
  const body = yield* Schema.encodeEffect(
    Schema.fromJsonString(Schema.Unknown),
  )({
    stackId: target.stackId,
    providerGeneration: target.providerGeneration,
    operation,
    input,
  }).pipe(Effect.mapError(() => failure("INVALID_INPUT")));
  if (Buffer.byteLength(body) > 1024 * 1024) {
    return yield* Effect.fail(failure("INVALID_INPUT"));
  }
  const agent = yield* Effect.acquireRelease(
    Effect.sync(
      () => new Undici.Agent({ connect: { socketPath: target.adminSocket } }),
    ),
    (dispatcher) => Effect.promise(() => dispatcher.destroy()),
  );
  const client = yield* NodeHttpClient.makeUndici.pipe(
    Effect.provideService(NodeHttpClient.Dispatcher, agent),
  );
  yield* Effect.sync(onDispatch);
  const response = yield* client
    .execute(
      HttpClientRequest.post("http://localhost/v1/admin").pipe(
        HttpClientRequest.bodyText(body, "application/json"),
      ),
    )
    .pipe(
      Effect.mapError(() =>
        failure(
          "UNAVAILABLE",
          isMutation(operation) ? "unknown" : "not-applied",
        ),
      ),
    );
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  yield* Stream.runForEach(response.stream, (chunk) => {
    bytes += chunk.byteLength;
    if (bytes > 1024 * 1024) {
      return Effect.fail(
        failure(
          "INVALID_RESPONSE",
          isMutation(operation) ? "unknown" : "not-applied",
        ),
      );
    }
    chunks.push(chunk);
    return Effect.void;
  }).pipe(
    Effect.mapError(() =>
      failure(
        "INVALID_RESPONSE",
        isMutation(operation) ? "unknown" : "not-applied",
      ),
    ),
  );
  const text = yield* Effect.try({
    try: () =>
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)),
    catch: () =>
      failure(
        "INVALID_RESPONSE",
        isMutation(operation) ? "unknown" : "not-applied",
      ),
  });
  const decoded = yield* Schema.decodeUnknownEffect(
    Schema.fromJsonString(AdminResponse),
  )(text).pipe(
    Effect.mapError(() =>
      failure(
        "INVALID_RESPONSE",
        isMutation(operation) ? "unknown" : "not-applied",
      ),
    ),
  );
  if (
    decoded.identity.stackId !== target.stackId ||
    decoded.identity.providerGeneration !== target.providerGeneration ||
    decoded.identity.worktree !== target.worktree
  ) {
    return yield* Effect.fail(
      failure(
        "TARGET_MISMATCH",
        isMutation(operation) ? "unknown" : "not-applied",
      ),
    );
  }
  if (!decoded.ok) {
    return yield* Effect.fail(failure(decoded.error.code));
  }
  const schema = Object.entries(schemas).find(
    ([key]) => key === operation,
  )?.[1];
  if (response.status !== 200 || schema === undefined) {
    return yield* Effect.fail(
      failure(
        "INVALID_RESPONSE",
        isMutation(operation) ? "unknown" : "not-applied",
      ),
    );
  }
  return yield* Schema.decodeUnknownEffect(schema)(decoded.data).pipe(
    Effect.mapError(() =>
      failure(
        "INVALID_RESPONSE",
        isMutation(operation) ? "unknown" : "not-applied",
      ),
    ),
  );
});

// The existing CJS lifecycle registry is the authority; this is only its platform bridge.
const registryError = (error: unknown) =>
  failure(
    Schema.is(Schema.Struct({ code: Schema.Literal("SERVICE_UNAVAILABLE") }))(
      error,
    )
      ? "UNAVAILABLE"
      : Schema.is(Schema.Struct({ code: Schema.Literal("TARGET_MISMATCH") }))(
            error,
          )
        ? "TARGET_MISMATCH"
        : "INTERNAL_ERROR",
  );
export const selectTarget = Effect.fn("mock.selectTarget")(function* (
  worktree?: string,
) {
  const helper = yield* Effect.tryPromise({
    try: () => import("../../../../scripts/mock-target.cjs"),
    catch: registryError,
  });
  return yield* Effect.tryPromise({
    try: (signal) =>
      helper.selectMockTarget({
        ...(worktree === undefined ? {} : { worktree }),
        signal,
      }),
    catch: registryError,
  });
});
export const verifyTarget = Effect.fn("mock.verifyTarget")(function* (
  selection: Selection,
  inbox = false,
) {
  const helper = yield* Effect.tryPromise({
    try: () => import("../../../../scripts/mock-target.cjs"),
    catch: registryError,
  });
  yield* Effect.tryPromise({
    try: (signal) => helper.verifyMockTarget(selection, { inbox, signal }),
    catch: registryError,
  });
});
