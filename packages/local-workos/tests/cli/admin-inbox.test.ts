import { afterAll, beforeAll, expect, test } from "vitest";
import { Effect, Schema, type Scope } from "effect";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Owned native process/server fixture exercises the real transport rather than replacing it with the client under test.
import { spawn, execFileSync } from "node:child_process";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Owned native process/server fixture exercises the real transport rather than replacing it with the client under test.
import { mkdtemp, mkdir, chmod, rm, realpath } from "node:fs/promises";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Owned native process/server fixture exercises the real transport rather than replacing it with the client under test.
import { createServer } from "node:http";
import { once } from "node:events";
import { tmpdir } from "node:os";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Owned native process/server fixture exercises the real transport rather than replacing it with the client under test.
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  listInbox,
  readInbox,
  type InboxError,
  type InboxTarget,
} from "../../src/cli/mailpit-client.ts";
const run = <A>(effect: Effect.Effect<A, InboxError, Scope.Scope>) =>
  Effect.runPromise(Effect.scoped(effect).pipe(Effect.timeout(4000)));
const ok = Effect.void;
const port = Effect.fn("inboxFixture.port")(function* () {
  const server = yield* Effect.acquireRelease(
    Effect.callback<ReturnType<typeof createServer>, Error>((resume) => {
      const listener = createServer();
      const onError = (error: Error) => resume(Effect.fail(error));
      listener.once("error", onError);
      listener.listen(0, "127.0.0.1", () => {
        listener.off("error", onError);
        resume(Effect.succeed(listener));
      });
    }),
    (listener) =>
      Effect.callback<void, Error>((resume) => {
        listener.close((error) =>
          resume(error ? Effect.fail(error) : Effect.void),
        );
      }).pipe(Effect.orDie),
  );
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("No port");
  }
  return address.port;
}, Effect.scoped);
const owned: {
  child: ReturnType<typeof spawn>;
  closed: Promise<unknown>;
  dir: string;
  target: InboxTarget;
}[] = [];
// oxlint-disable-next-line effecttsgo/async-function -- Native integration harness deliberately runs outside the Effect runtime under test to observe cleanup and interruption.
async function start(
  stackId: string,
  bindAttempt = 0,
  forcedHttpPort?: number,
) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "admin-inbox-")));
  await chmod(dir, 0o700);
  await mkdir(join(dir, "home"));
  const http = forcedHttpPort ?? (await Effect.runPromise(port()));
  const binary = execFileSync("mise", ["which", "mailpit"], {
    encoding: "utf8",
  }).trim();
  const child = spawn(
    binary,
    [
      "--database",
      join(dir, "mail.sqlite"),
      "--listen",
      `127.0.0.1:${http}`,
      "--smtp",
      "127.0.0.1:0",
      "--disable-version-check",
      "--smtp-disable-rdns",
    ],
    {
      cwd: dir,
      env: { HOME: join(dir, "home"), TMPDIR: dir },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let startupLog = "";
  for (const output of [child.stdout, child.stderr]) {
    output?.on("data", (chunk: Buffer) => {
      startupLog = (startupLog + chunk.toString()).slice(-8192);
    });
  }
  const instance = {
    child,
    closed: once(child, "close"),
    dir,
    target: {
      stackId,
      providerGeneration: "generation",
      epoch: `${stackId}:${child.pid}`,
      baseUrl: `http://127.0.0.1:${http}`,
    },
  };
  owned.push(instance);
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) {
      // Mailpit logs :0 rather than its assigned HTTP port, so retry only a
      // confirmed bind collision; SMTP needs no discovered port and binds :0.
      await instance.closed;
      if (bindAttempt < 2 && /bind: address already in use/.test(startupLog)) {
        return start(stackId, bindAttempt + 1);
      }
      throw new Error("Owned Mailpit exited");
    }
    try {
      // oxlint-disable-next-line effecttsgo/global-fetch -- Independent bounded Mailpit readiness/seeding client; no adapter is used to establish its own fixtures.
      const response = await fetch(`${instance.target.baseUrl}/api/v1/info`, {
        signal: AbortSignal.timeout(100),
        redirect: "error",
      });
      if (response.ok) {
        const info = Schema.decodeUnknownSync(
          Schema.Struct({ Database: Schema.String, Version: Schema.String }),
        )(await response.json());
        // Additional fixture consistency only, not a claim that database paths authenticate stacks.
        if (
          info.Database === join(await realpath(dir), "mail.sqlite") &&
          info.Version.includes("1.31.0") &&
          child.exitCode === null &&
          child.signalCode === null
        ) {
          return instance.target;
        }
      }
    } catch {
      /* Owned readiness only. */
    }
    await delay(40);
  }
  throw new Error("Mailpit readiness deadline");
}
let a: InboxTarget;
let b: InboxTarget;
// oxlint-disable-next-line effecttsgo/async-function -- Native integration harness deliberately runs outside the Effect runtime under test to observe cleanup and interruption.
beforeAll(async () => {
  a = await start("a");
  b = await start("b");
}, 12000);
// oxlint-disable-next-line effecttsgo/async-function -- Native integration harness deliberately runs outside the Effect runtime under test to observe cleanup and interruption.
afterAll(async () => {
  await Promise.all(
    // oxlint-disable-next-line effecttsgo/async-function -- Native integration harness deliberately runs outside the Effect runtime under test to observe cleanup and interruption.
    owned.map(async ({ child, closed, dir }) => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
      }
      if (
        !(await Promise.race([
          closed.then(() => true),
          delay(1500).then(() => false),
        ]))
      ) {
        child.kill("SIGKILL");
      }
      const stopped = await Promise.race([
        closed.then(() => true),
        delay(1500).then(() => false),
      ]);
      if (!stopped) {
        throw new Error("Owned Mailpit did not stop within cleanup deadline");
      }
      await rm(dir, { recursive: true, force: true });
    }),
  );
}, 6000);
// oxlint-disable-next-line effecttsgo/async-function -- Native integration harness deliberately runs outside the Effect runtime under test to observe cleanup and interruption.
async function send(target: InboxTarget, extra: Record<string, unknown> = {}) {
  // oxlint-disable-next-line effecttsgo/global-fetch -- Independent bounded Mailpit readiness/seeding client; no adapter is used to establish its own fixtures.
  const response = await fetch(`${target.baseUrl}/api/v1/send`, {
    method: "POST",
    signal: AbortSignal.timeout(2000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      From: { Email: "sender@example.test" },
      To: [{ Email: "alex@example.test" }],
      Subject: "Sensitive subject",
      Text: "SECRET_SNIPPET",
      ...extra,
    }),
  });
  expect(response.ok).toBe(true);
}
// oxlint-disable-next-line effecttsgo/async-function -- Native integration harness deliberately runs outside the Effect runtime under test to observe cleanup and interruption.
test("real isolated inboxes: bounded nonmutating list, exact To, cursors, parsed reads and sibling preservation", async () => {
  await send(b, { Subject: "Sibling" });
  await send(a);
  await delay(10);
  await send(a, {
    To: [{ Email: "not-alex@example.test", Name: "alex@example.test" }],
    Cc: [{ Email: "alex@example.test" }],
  });
  const page = await run(
    listInbox(a, { limit: 1, to: "ALEX@example.test" }, ok),
  );
  expect(page.messages).toEqual([]);
  expect(page.scanned).toBe(1);
  expect(page.nextCursor).toBeTypeOf("string");
  const next = await run(
    listInbox(
      a,
      { limit: 1, to: "alex@example.test", cursor: page.nextCursor! },
      ok,
    ),
  );
  expect(next.messages).toHaveLength(1);
  expect(next.messages[0].read).toBe(false);
  expect(JSON.stringify(next)).not.toContain("SECRET_SNIPPET");
  expect(JSON.stringify(next)).not.toContain("Snippet");
  for (const target of [b, { ...a, epoch: "new" }]) {
    await expect(
      run(
        listInbox(
          target,
          { limit: 1, to: "alex@example.test", cursor: page.nextCursor! },
          ok,
        ),
      ),
    ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
  }
  const read = await run(readInbox(a, next.messages[0].id, ok));
  expect(read).toMatchObject({
    text: "SECRET_SNIPPET",
    sensitive: true,
    readStateEffect: "marks-read",
    textProvenance: "mailpit-parsed-or-derived",
  });
  expect(
    (await run(listInbox(a, {}, ok))).messages.find((m) => m.id === read.id)
      ?.read,
  ).toBe(true);
  expect((await run(listInbox(b, {}, ok))).messages).toMatchObject([
    { subject: "Sibling", read: false },
  ]);
});
// oxlint-disable-next-line effecttsgo/async-function -- Native integration harness deliberately runs outside the Effect runtime under test to observe cleanup and interruption.
test("real HTML-derived text and oversized parsed read still marks read", async () => {
  await send(a, { Text: "", HTML: "<p>Derived text</p>" });
  const html = (await run(listInbox(a, { limit: 1 }, ok))).messages[0];
  const result = await run(readInbox(a, html.id, ok));
  expect(result.text).toContain("Derived text");
  expect(result.textProvenance).toBe("mailpit-parsed-or-derived");
  expect(result).not.toHaveProperty("HTML");
  await send(a, { Text: "x".repeat(1100000) });
  const large = (await run(listInbox(a, { limit: 1 }, ok))).messages[0];
  await expect(run(readInbox(a, large.id, ok))).rejects.toMatchObject({
    code: "RESPONSE_TOO_LARGE",
    outcome: "unknown",
  });
  expect((await run(listInbox(a, { limit: 1 }, ok))).messages[0].read).toBe(
    true,
  );
});
// oxlint-disable-next-line effecttsgo/async-function -- Native integration harness deliberately runs outside the Effect runtime under test to observe cleanup and interruption.
test("rejects unsafe targets, IDs, malformed cursors and limits before dispatch", async () => {
  for (const baseUrl of [
    "https://127.0.0.1:1234",
    "http://localhost:1234",
    "http://127.0.0.1",
    "http://127.0.0.1:1234/path",
    "http://user@127.0.0.1:1234",
  ]) {
    await expect(
      run(listInbox({ ...a, baseUrl }, {}, ok)),
    ).rejects.toMatchObject({
      code: "INVALID_TARGET",
      outcome: "not-applicable",
    });
  }
  for (const id of ["../info", "%2f", "", "a?b", "x".repeat(200)]) {
    await expect(run(readInbox(a, id, ok))).rejects.toMatchObject({
      code: "INVALID_MESSAGE_ID",
      outcome: "not-applied",
    });
  }
  for (const limit of [0, -1, 101, 1.5]) {
    await expect(run(listInbox(a, { limit }, ok))).rejects.toMatchObject({
      code: "INVALID_LIMIT",
    });
  }
  await expect(
    run(listInbox(a, { cursor: "garbage" }, ok)),
  ).rejects.toMatchObject({ code: "INVALID_CURSOR" });
});

// oxlint-disable-next-line effecttsgo/async-function -- Real occupied listener forces the native Mailpit bind-collision retry path.
test("Mailpit fixture retries an occupied HTTP port without stopping its owner", async () => {
  const blocker = createServer();
  blocker.listen(0, "127.0.0.1");
  await once(blocker, "listening");
  try {
    const address = blocker.address();
    if (!address || typeof address === "string") {
      throw new Error("No occupied port");
    }
    const before = owned.length;
    const target = await start("collision", 0, address.port);
    expect(target.baseUrl).not.toBe(`http://127.0.0.1:${address.port}`);
    expect(owned.length).toBeGreaterThan(before + 1);
    expect(owned[before].child.exitCode).not.toBeNull();
    expect(blocker.listening).toBe(true);
  } finally {
    blocker.close();
    await once(blocker, "close");
  }
}, 10000);
