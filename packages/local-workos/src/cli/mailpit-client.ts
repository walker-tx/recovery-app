import { Effect, Schema, Stream } from "effect";
import * as NodeHttpClient from "@effect/platform-node/NodeHttpClient";
import * as Undici from "@effect/platform-node/Undici";

/** Registry-selected endpoint; only the supplied live ownership verifier attests it. */
export interface InboxTarget {
  stackId: string;
  providerGeneration: string;
  epoch: string;
  baseUrl: string;
}
const messages = {
  INVALID_TARGET: "Inbox target must be an explicit loopback HTTP endpoint.",
  INVALID_LIMIT: "Inbox limit must be an integer from 1 through 100.",
  INVALID_FILTER: "Inbox recipient filter is too long.",
  INVALID_CURSOR:
    "Inbox cursor is malformed or belongs to another target, epoch, filter or limit.",
  INVALID_MESSAGE_ID: "Inbox message ID is invalid.",
  OWNERSHIP_CHANGED:
    "Inbox ownership could not be verified; discard the result.",
  NETWORK_ERROR:
    "Inbox request failed; a dispatched read may have marked the message read.",
  REDIRECT_REFUSED: "Inbox redirects are not allowed.",
  HTTP_ERROR: "Inbox returned an unsuccessful response.",
  RESPONSE_TOO_LARGE: "Inbox response exceeds the 1 MiB streaming limit.",
  INVALID_RESPONSE:
    "Inbox response does not match the supported Mailpit schema.",
} as const;
export class InboxError extends Schema.TaggedError<InboxError>()("InboxError", {
  code: Schema.Literals([
    "INVALID_TARGET",
    "INVALID_LIMIT",
    "INVALID_FILTER",
    "INVALID_CURSOR",
    "INVALID_MESSAGE_ID",
    "OWNERSHIP_CHANGED",
    "NETWORK_ERROR",
    "REDIRECT_REFUSED",
    "HTTP_ERROR",
    "RESPONSE_TOO_LARGE",
    "INVALID_RESPONSE",
  ]),
  message: Schema.String,
  outcome: Schema.Literals(["not-applied", "unknown", "not-applicable"]),
}) {}
const refusal = (
  code: keyof typeof messages,
  outcome: InboxError["outcome"] = "not-applicable",
) => new InboxError({ code, message: messages[code], outcome });
const MessageId = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{1,128}$/),
);
const Address = Schema.Struct({ Address: Schema.String, Name: Schema.String });
const metadataFields = {
  ID: MessageId,
  From: Address,
  To: Schema.Array(Address),
  Subject: Schema.String,
  Created: Schema.String,
  Read: Schema.Boolean,
};
const Metadata = Schema.Struct(metadataFields);
const Listing = Schema.Struct({
  messages: Schema.Array(Metadata),
  messages_count: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  start: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
// Parsed-message timestamps use Date, while summaries use Created in Mailpit 1.31.
const Message = Schema.Struct({
  ID: MessageId,
  From: Address,
  To: Schema.Array(Address),
  Subject: Schema.String,
  Date: Schema.String,
  Text: Schema.String,
});
const Cursor = Schema.Struct({
  stackId: Schema.String,
  providerGeneration: Schema.String,
  epoch: Schema.String,
  baseUrl: Schema.String,
  to: Schema.String,
  limit: Schema.Int,
  start: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER - 100 }),
  ),
});
const project = (m: typeof Metadata.Type) => ({
  id: m.ID,
  from: m.From.Address,
  to: m.To.map((r) => r.Address),
  subject: m.Subject,
  timestamp: m.Created,
  read: m.Read,
});

const request = Effect.fn("inbox.request")(function* (
  target: InboxTarget,
  path: string,
  verify: Effect.Effect<void, InboxError>,
  read: boolean,
  onDispatch: () => void = () => {},
) {
  yield* Effect.try({
    try: () => {
      // Canonical numeric loopback only: no DNS, userinfo, alternate IP syntax or redirects.
      if (
        target.baseUrl.length > 64 ||
        !/^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.test(target.baseUrl)
      ) {
        throw new Error();
      }
      const url = new URL(target.baseUrl);
      if (Number(url.port || 80) > 65535) {
        throw new Error();
      }
    },
    catch: () => refusal("INVALID_TARGET"),
  });
  yield* verify.pipe(
    Effect.mapError(() =>
      refusal("OWNERSHIP_CHANGED", read ? "not-applied" : "not-applicable"),
    ),
  );
  const outcome = read ? "unknown" : "not-applicable";
  // The operation owns its dispatcher. Outer interruption runs this finalizer too.
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const agent = yield* Effect.acquireRelease(
        Effect.sync(() => new Undici.Agent()),
        (dispatcher) => Effect.promise(() => dispatcher.destroy()),
      );
      const client = yield* NodeHttpClient.makeUndici.pipe(
        Effect.provideService(NodeHttpClient.Dispatcher, agent),
      );
      yield* Effect.sync(onDispatch);
      const response = yield* client
        .get(target.baseUrl + path)
        .pipe(Effect.mapError(() => refusal("NETWORK_ERROR", outcome)));
      if (response.status >= 300 && response.status < 400) {
        return yield* refusal("REDIRECT_REFUSED", outcome);
      }
      if (response.status !== 200) {
        return yield* refusal("HTTP_ERROR", outcome);
      }
      const body = yield* Stream.runFoldEffect(
        response.stream,
        () => ({ size: 0, parts: [] as Uint8Array[] }),
        (state, part) => {
          const size = state.size + part.byteLength;
          if (size > 1048576) {
            return Effect.fail(refusal("RESPONSE_TOO_LARGE", outcome));
          }
          state.parts.push(part);
          return Effect.succeed({ size, parts: state.parts });
        },
      ).pipe(
        Effect.mapError((error) =>
          Schema.is(InboxError)(error)
            ? error
            : refusal("NETWORK_ERROR", outcome),
        ),
      );
      yield* verify.pipe(
        Effect.mapError(() => refusal("OWNERSHIP_CHANGED", outcome)),
      );
      const text = yield* Effect.try({
        try: () =>
          new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(body.parts, body.size),
          ),
        catch: () => refusal("INVALID_RESPONSE", outcome),
      });
      return yield* Schema.decodeUnknownEffect(
        Schema.fromJsonString(Schema.Unknown),
      )(text).pipe(Effect.mapError(() => refusal("INVALID_RESPONSE", outcome)));
    }),
  );
});

export const listInbox = Effect.fn("listInbox")(function* (
  target: InboxTarget,
  options: { limit?: number; cursor?: string; to?: string },
  verify: Effect.Effect<void, InboxError>,
) {
  yield* Effect.scope;
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return yield* refusal("INVALID_LIMIT");
  }
  const to = (options.to ?? "").toLowerCase();
  if (to.length > 320) {
    return yield* refusal("INVALID_FILTER");
  }
  let start = 0;
  if (options.cursor !== undefined) {
    const raw = yield* Effect.try({
      try: () => {
        if (
          options.cursor!.length > 4096 ||
          !/^[A-Za-z0-9_-]+$/.test(options.cursor!)
        ) {
          throw new Error();
        }
        return Buffer.from(options.cursor!, "base64url").toString("utf8");
      },
      catch: () => refusal("INVALID_CURSOR"),
    });
    const cursor = yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(Cursor),
    )(raw).pipe(Effect.mapError(() => refusal("INVALID_CURSOR")));
    if (
      cursor.stackId !== target.stackId ||
      cursor.providerGeneration !== target.providerGeneration ||
      cursor.epoch !== target.epoch ||
      cursor.baseUrl !== target.baseUrl ||
      cursor.to !== to ||
      cursor.limit !== limit
    ) {
      return yield* refusal("INVALID_CURSOR");
    }
    start = cursor.start;
  }
  const raw = yield* request(
    target,
    `/api/v1/messages?start=${start}&limit=${limit}`,
    verify,
    false,
  );
  const page = yield* Schema.decodeUnknownEffect(Listing)(raw).pipe(
    Effect.mapError(() => refusal("INVALID_RESPONSE")),
  );
  if (page.start !== start || page.messages.length > limit) {
    return yield* refusal("INVALID_RESPONSE");
  }
  const offset = start + page.messages.length;
  const cursorText = yield* Schema.encodeEffect(Schema.fromJsonString(Cursor))({
    ...target,
    to,
    limit,
    start: offset,
  }).pipe(Effect.mapError(() => refusal("INVALID_CURSOR")));
  return {
    messages: page.messages
      .filter(
        (m) => to === "" || m.To.some((r) => r.Address.toLowerCase() === to),
      )
      .map(project),
    scanned: page.messages.length,
    nextCursor:
      page.messages.length > 0 && offset < page.messages_count
        ? Buffer.from(cursorText).toString("base64url")
        : null,
    pagination: "best-effort-offset" as const,
    sensitive: true as const,
  };
});
export const readInbox = Effect.fn("readInbox")(function* (
  target: InboxTarget,
  messageId: string,
  verify: Effect.Effect<void, InboxError>,
  onDispatch: () => void = () => {},
) {
  yield* Effect.scope;
  const id = yield* Schema.decodeUnknownEffect(MessageId)(messageId).pipe(
    Effect.mapError(() => refusal("INVALID_MESSAGE_ID", "not-applied")),
  );
  const raw = yield* request(
    target,
    `/api/v1/message/${id}`,
    verify,
    true,
    onDispatch,
  );
  const message = yield* Schema.decodeUnknownEffect(Message)(raw).pipe(
    Effect.mapError(() => refusal("INVALID_RESPONSE", "unknown")),
  );
  if (message.ID !== id) {
    return yield* refusal("INVALID_RESPONSE", "unknown");
  }
  return {
    id,
    from: message.From.Address,
    to: message.To.map((r) => r.Address),
    subject: message.Subject,
    timestamp: message.Date,
    text: message.Text === "" ? null : message.Text,
    textStatus:
      message.Text === ""
        ? ("no-usable-text" as const)
        : ("available" as const),
    textProvenance: "mailpit-parsed-or-derived" as const,
    sensitive: true as const,
    readStateEffect: "marks-read" as const,
  };
});
