import { expect } from "vitest";
import { it } from "@effect/vitest";
import { Effect, Layer, type Scope } from "effect";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Owned native process/server fixture exercises the real transport rather than replacing it with the client under test.
import { createServer, type RequestListener } from "node:http";
import {
  listInbox,
  readInbox,
  InboxError,
  type InboxTarget,
} from "../../src/cli/mailpit-client.ts";

const message = {
  ID: "safe-id",
  From: { Address: "from@example.test", Name: "" },
  To: [],
  Subject: "Sensitive",
  Date: "2026-01-01T00:00:00Z",
  Text: "",
};
const run = <A>(effect: Effect.Effect<A, InboxError, Scope.Scope>) =>
  Effect.scoped(effect).pipe(Effect.timeout(1500));
const fixture = Effect.fn("fixture")(function* <A, E, R>(
  handler: RequestListener,
  body: (target: InboxTarget) => Effect.Effect<A, E, R>,
) {
  const server = yield* Effect.acquireRelease(
    Effect.sync(() => createServer(handler)),
    (owned) =>
      Effect.callback<void>((resume) => {
        owned.closeAllConnections();
        owned.close(() => resume(Effect.void));
      }),
  );
  yield* Effect.callback<void, Error>((resume) => {
    const onError = (error: Error) => resume(Effect.fail(error));
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => resume(Effect.void));
    return Effect.sync(() => {
      server.off("error", onError);
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    return yield* Effect.die(new Error("Missing port"));
  }
  return yield* body({
    stackId: "fixture",
    providerGeneration: "generation",
    epoch: "epoch",
    baseUrl: `http://127.0.0.1:${address.port}`,
  });
});
it.layer(Layer.empty, { excludeTestServices: true })((test) => {
  test.effect("redirects are refused without visiting the destination", () =>
    Effect.gen(function* () {
      let hits = 0;
      yield* fixture(
        (_req, res) => {
          hits++;
          res.writeHead(302, { location: "/destination" });
          res.end();
        },
        Effect.fn(function* (target) {
          expect(
            yield* Effect.flip(run(readInbox(target, "safe-id", Effect.void))),
          ).toMatchObject({ code: "REDIRECT_REFUSED", outcome: "unknown" });
          expect(hits).toBe(1);
        }),
      );
    }),
  );
  test.effect("chunked oversized stream refuses before JSON decoding", () =>
    Effect.gen(function* () {
      yield* fixture(
        (_req, res) => {
          res.writeHead(200);
          res.write("x".repeat(700000));
          res.end("x".repeat(700000));
        },
        Effect.fn(function* (target) {
          expect(
            yield* Effect.flip(run(readInbox(target, "safe-id", Effect.void))),
          ).toMatchObject({
            code: "RESPONSE_TOO_LARGE",
            outcome: "unknown",
          });
        }),
      );
    }),
  );
  test.effect(
    "post-dispatch verification discards results and sanitizes failures",
    () =>
      Effect.gen(function* () {
        let checks = 0;
        const verify = Effect.suspend(() =>
          ++checks === 1
            ? Effect.void
            : Effect.fail(
                new InboxError({
                  code: "OWNERSHIP_CHANGED",
                  message: "DO_NOT_LEAK",
                  outcome: "not-applied",
                }),
              ),
        );
        yield* fixture(
          (_req, res) => {
            res.end(JSON.stringify(message));
          },
          Effect.fn(function* (target) {
            expect(
              yield* Effect.flip(run(readInbox(target, "safe-id", verify))),
            ).toMatchObject({
              code: "OWNERSHIP_CHANGED",
              outcome: "unknown",
              message:
                "Inbox ownership could not be verified; discard the result.",
            });
            expect(checks).toBe(2);
          }),
        );
      }),
  );
  test.effect("pre-dispatch verifier refuses without sending a request", () =>
    Effect.gen(function* () {
      let hits = 0;
      yield* fixture(
        (_req, res) => {
          hits++;
          res.end("{}");
        },
        Effect.fn(function* (target) {
          const verify = Effect.fail(
            new InboxError({
              code: "OWNERSHIP_CHANGED",
              message: "private path",
              outcome: "unknown",
            }),
          );
          expect(
            yield* Effect.flip(run(readInbox(target, "safe-id", verify))),
          ).toMatchObject({
            code: "OWNERSHIP_CHANGED",
            outcome: "not-applied",
          });
          expect(hits).toBe(0);
        }),
      );
    }),
  );
  test.effect("empty text is explicit and invalid DTOs never escape", () =>
    Effect.gen(function* () {
      yield* fixture(
        (_req, res) => {
          res.end(JSON.stringify(message));
        },
        Effect.fn(function* (target) {
          expect(
            yield* run(readInbox(target, "safe-id", Effect.void)),
          ).toMatchObject({ text: null, textStatus: "no-usable-text" });
          expect(
            yield* Effect.flip(run(listInbox(target, {}, Effect.void))),
          ).toMatchObject({ code: "INVALID_RESPONSE" });
        }),
      );
    }),
  );
  test.effect(
    "whole-operation deadline interrupts streaming and closes the owned connection",
    () =>
      Effect.gen(function* () {
        let closed = false;
        yield* fixture(
          (_req, res) => {
            res.on("close", () => {
              closed = true;
            });
            res.writeHead(200);
            res.write("{");
          },
          Effect.fn(function* (target) {
            expect(
              yield* Effect.flip(
                Effect.scoped(readInbox(target, "safe-id", Effect.void)).pipe(
                  Effect.timeout(80),
                ),
              ),
            ).toBeDefined();
            yield* Effect.sleep(10).pipe(
              Effect.repeat({ until: () => closed }),
              Effect.timeout(500),
            );
            expect(closed).toBe(true);
          }),
        );
      }),
  );

  test.effect("network failure after dispatch has uncertain read outcome", () =>
    Effect.gen(function* () {
      yield* fixture(
        (_req, res) => {
          res.destroy();
        },
        Effect.fn(function* (target) {
          expect(
            yield* Effect.flip(run(readInbox(target, "safe-id", Effect.void))),
          ).toMatchObject({ code: "NETWORK_ERROR", outcome: "unknown" });
        }),
      );
    }),
  );

  test.effect(
    "list discards a valid page when the epoch changes after dispatch",
    () =>
      Effect.gen(function* () {
        let checks = 0;
        const verify = Effect.suspend(() =>
          ++checks === 1
            ? Effect.void
            : Effect.fail(
                new InboxError({
                  code: "OWNERSHIP_CHANGED",
                  message: "private",
                  outcome: "unknown",
                }),
              ),
        );
        yield* fixture(
          (_req, res) => {
            res.end('{"messages":[],"messages_count":0,"start":0}');
          },
          Effect.fn(function* (target) {
            expect(
              yield* Effect.flip(run(listInbox(target, {}, verify))),
            ).toMatchObject({
              code: "OWNERSHIP_CHANGED",
              outcome: "not-applicable",
            });
            expect(checks).toBe(2);
          }),
        );
      }),
  );

  test.effect(
    "read dispatch callback follows validation and ownership but precedes network dispatch",
    () =>
      Effect.gen(function* () {
        let dispatched = 0;
        let dispatchedAtRequest = 0;
        let hits = 0;
        yield* fixture(
          (_req, res) => {
            hits++;
            dispatchedAtRequest = dispatched;
            res.end(JSON.stringify(message));
          },
          Effect.fn(function* (target) {
            const mark = () => {
              dispatched++;
            };
            for (const id of [
              "../invalid",
              "safe-id\n",
              "safe-id\r",
              "safe-id\r\n",
            ]) {
              expect(
                yield* Effect.flip(
                  run(readInbox(target, id, Effect.void, mark)),
                ),
              ).toMatchObject({
                code: "INVALID_MESSAGE_ID",
                outcome: "not-applied",
              });
            }
            const refusal = Effect.fail(
              new InboxError({
                code: "OWNERSHIP_CHANGED",
                message: "synthetic",
                outcome: "not-applied",
              }),
            );
            expect(
              yield* Effect.flip(
                run(readInbox(target, "safe-id", refusal, mark)),
              ),
            ).toMatchObject({
              code: "OWNERSHIP_CHANGED",
              outcome: "not-applied",
            });
            expect(dispatched).toBe(0);
            expect(hits).toBe(0);
            yield* run(readInbox(target, "safe-id", Effect.void, mark));
            expect(dispatched).toBe(1);
            expect(dispatchedAtRequest).toBe(1);
            expect(hits).toBe(1);
          }),
        );
      }),
  );
});
