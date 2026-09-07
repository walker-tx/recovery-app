import { expect, test } from "vitest";
import { Effect, type Scope } from "effect";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Owned native process/server fixture exercises the real transport rather than replacing it with the client under test.
import { createServer, type RequestListener } from "node:http";
import { once } from "node:events";
import {
  listInbox,
  readInbox,
  InboxError,
  type InboxTarget,
} from "../src/admin-inbox.ts";

const message = {
  ID: "safe-id",
  From: { Address: "from@example.test", Name: "" },
  To: [],
  Subject: "Sensitive",
  Date: "2026-01-01T00:00:00Z",
  Text: "",
};
const run = <A>(effect: Effect.Effect<A, InboxError, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(effect).pipe(Effect.timeout(1500)));
// oxlint-disable-next-line effecttsgo/async-function -- Native integration harness deliberately runs outside the Effect runtime under test to observe cleanup and interruption.
async function fixture(
  handler: RequestListener,
  body: (target: InboxTarget) => Promise<void>,
) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Missing port");
    }
    await body({
      stackId: "fixture",
      providerGeneration: "generation",
      epoch: "epoch",
      baseUrl: `http://127.0.0.1:${address.port}`,
    });
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  }
}
// oxlint-disable-next-line effecttsgo/async-function -- Native integration harness deliberately runs outside the Effect runtime under test to observe cleanup and interruption.
test("redirects are refused without visiting the destination", async () => {
  let hits = 0;
  await fixture(
    (_req, res) => {
      hits++;
      res.writeHead(302, { location: "/destination" });
      res.end();
    },
    // oxlint-disable-next-line effecttsgo/async-function -- Native integration harness deliberately runs outside the Effect runtime under test to observe cleanup and interruption.
    async (target) => {
      await expect(
        run(readInbox(target, "safe-id", Effect.void)),
      ).rejects.toMatchObject({ code: "REDIRECT_REFUSED", outcome: "unknown" });
      expect(hits).toBe(1);
    },
  );
});
// oxlint-disable-next-line effecttsgo/async-function -- Native integration harness deliberately runs outside the Effect runtime under test to observe cleanup and interruption.
test("chunked oversized stream refuses before JSON decoding", async () => {
  await fixture(
    (_req, res) => {
      res.writeHead(200);
      res.write("x".repeat(700000));
      res.end("x".repeat(700000));
    },
    // oxlint-disable-next-line effecttsgo/async-function -- Native integration harness deliberately runs outside the Effect runtime under test to observe cleanup and interruption.
    async (target) => {
      await expect(
        run(readInbox(target, "safe-id", Effect.void)),
      ).rejects.toMatchObject({
        code: "RESPONSE_TOO_LARGE",
        outcome: "unknown",
      });
    },
  );
});
// oxlint-disable-next-line effecttsgo/async-function -- Native integration harness deliberately runs outside the Effect runtime under test to observe cleanup and interruption.
test("post-dispatch verification discards results and sanitizes failures", async () => {
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
  await fixture(
    (_req, res) => {
      res.end(JSON.stringify(message));
    },
    // oxlint-disable-next-line effecttsgo/async-function -- Native integration harness deliberately runs outside the Effect runtime under test to observe cleanup and interruption.
    async (target) => {
      await expect(
        run(readInbox(target, "safe-id", verify)),
      ).rejects.toMatchObject({
        code: "OWNERSHIP_CHANGED",
        outcome: "unknown",
        message: "Inbox ownership could not be verified; discard the result.",
      });
      expect(checks).toBe(2);
    },
  );
});
// oxlint-disable-next-line effecttsgo/async-function -- Native integration harness deliberately runs outside the Effect runtime under test to observe cleanup and interruption.
test("pre-dispatch verifier refuses without sending a request", async () => {
  let hits = 0;
  await fixture(
    (_req, res) => {
      hits++;
      res.end("{}");
    },
    // oxlint-disable-next-line effecttsgo/async-function -- Native integration harness deliberately runs outside the Effect runtime under test to observe cleanup and interruption.
    async (target) => {
      const verify = Effect.fail(
        new InboxError({
          code: "OWNERSHIP_CHANGED",
          message: "private path",
          outcome: "unknown",
        }),
      );
      await expect(
        run(readInbox(target, "safe-id", verify)),
      ).rejects.toMatchObject({
        code: "OWNERSHIP_CHANGED",
        outcome: "not-applied",
      });
      expect(hits).toBe(0);
    },
  );
});
// oxlint-disable-next-line effecttsgo/async-function -- Native integration harness deliberately runs outside the Effect runtime under test to observe cleanup and interruption.
test("empty text is explicit and invalid DTOs never escape", async () => {
  await fixture(
    (_req, res) => {
      res.end(JSON.stringify(message));
    },
    // oxlint-disable-next-line effecttsgo/async-function -- Native integration harness deliberately runs outside the Effect runtime under test to observe cleanup and interruption.
    async (target) => {
      expect(
        await run(readInbox(target, "safe-id", Effect.void)),
      ).toMatchObject({ text: null, textStatus: "no-usable-text" });
      await expect(
        run(listInbox(target, {}, Effect.void)),
      ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    },
  );
});
// oxlint-disable-next-line effecttsgo/async-function -- Native integration harness deliberately runs outside the Effect runtime under test to observe cleanup and interruption.
test("whole-operation deadline interrupts streaming and closes the owned connection", async () => {
  let closed = false;
  await fixture(
    (_req, res) => {
      res.on("close", () => {
        closed = true;
      });
      res.writeHead(200);
      res.write("{");
    },
    // oxlint-disable-next-line effecttsgo/async-function -- Native integration harness deliberately runs outside the Effect runtime under test to observe cleanup and interruption.
    async (target) => {
      await expect(
        Effect.runPromise(
          Effect.scoped(readInbox(target, "safe-id", Effect.void)).pipe(
            Effect.timeout(80),
          ),
        ),
      ).rejects.toBeDefined();
      await expect.poll(() => closed, { timeout: 500 }).toBe(true);
    },
  );
});

// oxlint-disable-next-line effecttsgo/async-function -- Native fixture independently observes adapter error classification.
test("network failure after dispatch has uncertain read outcome", async () => {
  await fixture(
    (_req, res) => {
      res.destroy();
    },
    // oxlint-disable-next-line effecttsgo/async-function -- Native fixture independently observes adapter error classification.
    async (target) => {
      await expect(
        run(readInbox(target, "safe-id", Effect.void)),
      ).rejects.toMatchObject({ code: "NETWORK_ERROR", outcome: "unknown" });
    },
  );
});

// oxlint-disable-next-line effecttsgo/async-function -- Native fixture independently observes adapter output refusal.
test("list discards a valid page when the epoch changes after dispatch", async () => {
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
  await fixture(
    (_req, res) => {
      res.end('{"messages":[],"messages_count":0,"start":0}');
    },
    // oxlint-disable-next-line effecttsgo/async-function -- Native fixture independently observes adapter output refusal.
    async (target) => {
      await expect(run(listInbox(target, {}, verify))).rejects.toMatchObject({
        code: "OWNERSHIP_CHANGED",
        outcome: "not-applicable",
      });
      expect(checks).toBe(2);
    },
  );
});

// oxlint-disable-next-line effecttsgo/async-function -- Native fixture observes the exact request-dispatch boundary independently of Effect interruption.
test("read dispatch callback follows validation and ownership but precedes network dispatch", async () => {
  let dispatched = 0;
  let dispatchedAtRequest = 0;
  let hits = 0;
  await fixture(
    (_req, res) => {
      hits++;
      dispatchedAtRequest = dispatched;
      res.end(JSON.stringify(message));
    },
    // oxlint-disable-next-line effecttsgo/async-function -- Native fixture observes read dispatch without substituting adapter behavior.
    async (target) => {
      const mark = () => {
        dispatched++;
      };
      await expect(
        run(readInbox(target, "../invalid", Effect.void, mark)),
      ).rejects.toMatchObject({
        code: "INVALID_MESSAGE_ID",
        outcome: "not-applied",
      });
      const refusal = Effect.fail(
        new InboxError({
          code: "OWNERSHIP_CHANGED",
          message: "synthetic",
          outcome: "not-applied",
        }),
      );
      await expect(
        run(readInbox(target, "safe-id", refusal, mark)),
      ).rejects.toMatchObject({
        code: "OWNERSHIP_CHANGED",
        outcome: "not-applied",
      });
      expect(dispatched).toBe(0);
      expect(hits).toBe(0);
      await run(readInbox(target, "safe-id", Effect.void, mark));
      expect(dispatched).toBe(1);
      expect(dispatchedAtRequest).toBe(1);
      expect(hits).toBe(1);
    },
  );
});
