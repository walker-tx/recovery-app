// oxlint-disable-next-line effecttsgo/node-builtin-import -- Real subprocess lifecycle and pipe pressure are the subject of these tests.
import { spawn } from "node:child_process";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Native independent Unix HTTP fixture, not the provider implementation.
import { createServer } from "node:http";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Disposable socket directory for subprocess fixtures.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Native fixture path construction.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Effect, Schema } from "effect";
import { expect, it } from "@effect/vitest";

const json = Schema.fromJsonString(Schema.Unknown);
const encode = Schema.encodeSync(json);
const clientUrl = new URL("../../src/cli/admin-client.ts", import.meta.url)
  .href;
const entry = fileURLToPath(new URL("../../src/cli/main.ts", import.meta.url));
const effectUrl = import.meta.resolve("effect");
const wire = Schema.fromJsonString(
  Schema.Struct({
    operation: Schema.String,
    input: Schema.Record(Schema.String, Schema.Unknown),
  }),
);
const user = {
  id: "user_fixture",
  email: "person@example.test",
  firstName: null,
  lastName: null,
  verified: false,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
};

// This test-only Node loader replaces registry discovery, NOT the Unix client or
// CLI runtime. It proves process/IO behavior, not real registry ownership.
const runFixture = Effect.fn(function* (options: {
  input?: Buffer;
  openInput?: boolean;
  stall?: "status" | "mutation" | "output" | "mutation-output";
  discoveryDefect?: boolean;
  blockedFinalizer?: boolean;
  timeoutMs?: number;
  bridgeError?: "TARGET_MISMATCH" | "SERVICE_UNAVAILABLE" | "unexpected";
  bridgeVerify?: boolean;
  inboxInvalidResponse?: boolean;
  breakOutput?: boolean;
  extraArgs?: string[];
  interrupt?: boolean;
  tty?: boolean;
  statusDelay?: number;
  mutationDelay?: number;
  statusOnly?: boolean;
  providerState?: "running" | "stopped" | "starting";
  ownershipChange?: boolean;
}) {
  const dir = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "mock-cli-runtime-"))),
    (directory) =>
      Effect.promise(() => rm(directory, { recursive: true, force: true })),
  );
  const target = {
    stackId: "11111111-1111-4111-8111-111111111111",
    providerGeneration: "22222222-2222-4222-8222-222222222222",
    worktree: "/synthetic",
    providerState: options.providerState ?? "running",
    adminSocket: join(dir, "a.sock"),
    inbox: options.inboxInvalidResponse
      ? { baseUrl: "http://127.0.0.1:1", epoch: "fixture" }
      : null,
    record: {},
  };
  const requests: Array<{ operation: string; input: Record<string, unknown> }> =
    [];
  let onMutation = () => {};
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on("data", (part: Buffer) => chunks.push(part));
        req.on("end", () => {
          const request = Schema.decodeUnknownSync(wire)(
            Buffer.concat(chunks).toString("utf8"),
          );
          requests.push(request);
          const status = request.operation === "status";
          if (!status) {
            onMutation();
          }
          if (
            (status && options.stall === "status") ||
            (!status && options.stall === "mutation")
          ) {
            return;
          }
          const data = status
            ? { users: 1, sessions: 0 }
            : request.operation === "users.list"
              ? {
                  users: [{ ...user, firstName: "x".repeat(800000) }],
                  nextCursor: null,
                }
              : options.stall === "mutation-output"
                ? { ...user, firstName: "x".repeat(800000) }
                : user;
          const send = () =>
            res.end(encode({ ok: true, identity: target, data }));
          const delay = status ? options.statusDelay : options.mutationDelay;
          if (delay !== undefined) {
            // oxlint-disable-next-line effecttsgo/global-timers -- Independent fixture response delay exercises the real process deadline.
            setTimeout(send, delay).unref();
          } else {
            send();
          }
        });
      }),
    ),
    (owned) =>
      Effect.callback<void>((resume) => {
        owned.closeAllConnections();
        owned.close(() => resume(Effect.void));
      }),
  );
  yield* Effect.callback<void>((resume) => {
    server.listen(target.adminSocket, () => resume(Effect.void));
  });
  const replacement = `export * from ${encode(clientUrl + "?actual")}; import {Effect} from ${encode(effectUrl)}; import {failure} from ${encode(new URL("../../src/cli/output.ts", import.meta.url).href)}; export const selectTarget=()=>${options.discoveryDefect ? 'Effect.die(new Error("secret-canary"))' : options.blockedFinalizer ? `Effect.addFinalizer(()=>Effect.sync(()=>process.stderr.write("FINALIZER_ENTERED\\n")).pipe(Effect.andThen(Effect.never))).pipe(Effect.andThen(Effect.succeed(${encode(target)})))` : `Effect.succeed(${encode(target)})`}; let verifications=0; export const verifyTarget=()=>{verifications++;return ${options.ownershipChange ? 'verifications===2 ? Effect.fail(failure("TARGET_MISMATCH")) : Effect.void' : "Effect.void"};};`;
  const bridgeUrl = new URL(
    "../../../../scripts/mock-target.cjs",
    import.meta.url,
  ).href;
  const bridgeSource = `export const selectMockTarget=()=>{${options.bridgeVerify ? `return Promise.resolve(${encode(target)})` : `throw Object.assign(new Error("secret-canary"), {code:${encode(options.bridgeError ?? "unexpected")}})`}}; export const verifyMockTarget=()=>{throw Object.assign(new Error("secret-canary"), {code:${encode(options.bridgeError ?? "unexpected")}})};`;
  const inboxUrl = new URL("../../src/cli/mailpit-client.ts", import.meta.url)
    .href;
  const inboxSource = `export {InboxError} from ${encode(inboxUrl + "?actual")}; import {InboxError} from ${encode(inboxUrl + "?actual")}; import {Effect} from ${encode(effectUrl)}; export const listInbox=()=>Effect.fail(new InboxError({code:"INVALID_RESPONSE", message:"secret-canary", outcome:"not-applied"})); export const readInbox=listInbox;`;
  const hooks = `import {registerHooks} from 'node:module'; registerHooks({load(url,context,next){if(${options.inboxInvalidResponse === true} && url===${encode(inboxUrl)})return {format:"module",source:${encode(inboxSource)},shortCircuit:true};if(${options.bridgeError !== undefined} && url===${encode(bridgeUrl)})return {format:"module",source:${encode(bridgeSource)},shortCircuit:true};if(${options.bridgeError === undefined} && url===${encode(clientUrl)})return {format:'module',source:${encode(replacement)},shortCircuit:true};return next(url,context);}});`;
  const hook = "data:text/javascript," + encodeURIComponent(hooks);
  const args = options.inboxInvalidResponse
    ? ["inbox", "list"]
    : options.statusOnly
      ? ["status"]
      : options.stall === "output"
        ? ["users", "list"]
        : [
            "users",
            "create",
            "--email",
            "person@example.test",
            "--password-stdin",
            "--expect-stack",
            "11111111-1111-4111-8111-111111111111",
            "--expect-generation",
            "22222222-2222-4222-8222-222222222222",
          ];
  const result = yield* Effect.callback<{
    code: number | null;
    stdout: string;
    stderr: string;
    signal: string | null;
  }>((resume) => {
    const cliArgs = [
      "--import",
      hook,
      entry,
      ...args,
      ...(options.extraArgs ?? []),
      "--json",
      "--timeout-ms",
      String(options.timeoutMs ?? 400),
    ];
    const ptyDriver = `import os,pty,sys
pid,fd=pty.fork()
if pid==0: os.execv(sys.argv[1],sys.argv[1:])
while True:
 try:
  data=os.read(fd,65536)
  if not data: break
  os.write(1,data)
 except OSError: break
_,status=os.waitpid(pid,0)
sys.exit(os.waitstatus_to_exitcode(status))`;
    const child = options.tty
      ? spawn("python3", ["-c", ptyDriver, process.execPath, ...cliArgs], {
          stdio: ["pipe", "pipe", "pipe"],
        })
      : spawn(process.execPath, cliArgs, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    if (options.breakOutput) {
      child.stdout.destroy();
    } else if (
      options.stall !== "output" &&
      options.stall !== "mutation-output"
    ) {
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
    }
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    onMutation = () => {
      if (options.interrupt) {
        child.kill("SIGINT");
      }
    };
    child.on("close", (code, signal) =>
      resume(Effect.succeed({ code, signal, stdout, stderr })),
    );
    child.on("error", () =>
      resume(Effect.die("Fixture subprocess could not start")),
    );
    if (!options.openInput) {
      child.stdin.end(options.input ?? Buffer.from("password-fixture"));
    }
    // oxlint-disable-next-line effecttsgo/global-timers-in-effect -- Test watchdog detects leaked stdout handles after the invocation deadline.
    const watchdog = setTimeout(
      () => child.kill("SIGKILL"),
      options.blockedFinalizer ? 5400 : (options.timeoutMs ?? 400) + 2000,
    );
    return Effect.sync(() => {
      clearTimeout(watchdog);
      child.kill();
    });
  });
  return { ...result, requests };
});
it.effect.each([
  Buffer.from("pässword\n"),
  Buffer.alloc(4096, 120),
  Buffer.from("\uFEFFpassword-fixture"),
])("preserves exact UTF8 bytes through real stdin and Unix dispatch", (input) =>
  Effect.gen(function* () {
    const result = yield* runFixture({ input });
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.requests[1]?.input.password).toBe(input.toString("utf8"));
  }),
);
it.effect.each([
  Buffer.alloc(0),
  Buffer.alloc(4097, 120),
  Buffer.from([0xc3, 0x28]),
])("rejects empty oversized or malformed stdin before dispatch", (input) =>
  Effect.gen(function* () {
    const result = yield* runFixture({ input });
    expect(result.code).toBe(2);
    expect(result.requests.map((r) => r.operation)).toEqual(["status"]);
    expect(result.stdout).toBe("");
  }),
);
it.effect.each(["status", "mutation", "output"] as const)(
  "bounds %s stalls with honest outcome",
  (stall) =>
    Effect.gen(function* () {
      const result = yield* runFixture({ stall });
      expect(result.signal).toBe(null);
      expect(result.code).toBe(stall === "mutation" ? 5 : 4);
      expect(
        yield* Schema.decodeUnknownEffect(json)(result.stderr),
      ).toMatchObject({
        ok: false,
        error: {
          code: "DEADLINE",
          outcome: stall === "mutation" ? "unknown" : "not-applied",
        },
      });
    }),
);
it.effect("SIGINT after dispatch emits uncertainty and exits 130", () =>
  Effect.gen(function* () {
    const result = yield* runFixture({ stall: "mutation", interrupt: true });
    expect(result.code).toBe(130);
    expect(result.stdout).toBe("");
    expect(
      yield* Schema.decodeUnknownEffect(json)(result.stderr),
    ).toMatchObject({
      ok: false,
      error: { code: "INTERRUPTED", outcome: "unknown" },
    });
  }),
);
it.effect("stdin and both requests share one total deadline", () =>
  Effect.gen(function* () {
    const result = yield* runFixture({ statusDelay: 240, mutationDelay: 240 });
    expect(result.code).toBe(5);
    expect(
      yield* Schema.decodeUnknownEffect(json)(result.stderr),
    ).toMatchObject({ error: { code: "DEADLINE", outcome: "unknown" } });
  }),
);
it.effect("open stdin is bounded before mutation dispatch", () =>
  Effect.gen(function* () {
    const result = yield* runFixture({ openInput: true });
    expect(result.code).toBe(4);
    expect(result.requests.map((r) => r.operation)).toEqual(["status"]);
  }),
);
it.effect("refuses an actual pseudo-terminal password input", () =>
  Effect.gen(function* () {
    const result = yield* runFixture({ tty: true });
    // Python standard-library PTY forwards stderr through the terminal; this is not the JSON wrapper contract.
    expect(result.stdout + result.stderr).toContain("INVALID_INPUT");
    expect(result.requests.map((r) => r.operation)).toEqual(["status"]);
  }),
);

it.effect(
  "status reports verified admin readiness but does not attest unprobed inbox",
  () =>
    Effect.gen(function* () {
      const result = yield* runFixture({ statusOnly: true });
      expect(result.code).toBe(0);
      expect(
        yield* Schema.decodeUnknownEffect(json)(result.stdout),
      ).toMatchObject({
        target: { identityVerified: true },
        data: {
          services: {
            provider: { state: "running", admin: "ready" },
            inbox: { state: "unavailable", readiness: "not-probed" },
          },
        },
      });
    }),
);
it.effect(
  "status discards data when post-response ownership verification fails",
  () =>
    Effect.gen(function* () {
      const result = yield* runFixture({
        statusOnly: true,
        ownershipChange: true,
      });
      expect(result.code).toBe(3);
      expect(result.stdout).toBe("");
      expect(result.requests.map((r) => r.operation)).toEqual(["status"]);
    }),
);

it.effect("unknown defects are internal failures without raw causes", () =>
  Effect.gen(function* () {
    const result = yield* runFixture({ discoveryDefect: true });
    expect(result.code).toBe(1);
    expect(result.stdout + result.stderr).not.toContain("secret-canary");
    expect(
      yield* Schema.decodeUnknownEffect(json)(result.stderr),
    ).toMatchObject({
      error: { code: "INTERNAL_ERROR", outcome: "not-applied" },
    });
  }),
);
it.effect(
  "blocked mutation output exits with uncertainty after its deadline",
  () =>
    Effect.gen(function* () {
      const result = yield* runFixture({ stall: "mutation-output" });
      expect(result.code).toBe(5);
      expect(result.signal).toBe(null);
      expect(
        yield* Schema.decodeUnknownEffect(json)(result.stderr),
      ).toMatchObject({ error: { code: "DEADLINE", outcome: "unknown" } });
    }),
);
it.effect("broken output pipe never claims a dispatched mutation failed", () =>
  Effect.gen(function* () {
    const result = yield* runFixture({ breakOutput: true });
    expect(result.code).toBe(5);
    expect(
      yield* Schema.decodeUnknownEffect(json)(result.stderr),
    ).toMatchObject({ error: { code: "OUTPUT_FAILED", outcome: "unknown" } });
  }),
);

it.effect.each(["stopped", "starting"] as const)(
  "registered %s status is explicitly unverified without contacting admin",
  (providerState) =>
    Effect.gen(function* () {
      const result = yield* runFixture({ statusOnly: true, providerState });
      expect(result.code).toBe(0);
      expect(result.requests).toEqual([]);
      expect(
        yield* Schema.decodeUnknownEffect(json)(result.stdout),
      ).toMatchObject({
        target: { identityVerified: false },
        data: {
          users: null,
          sessions: null,
          services: { provider: { state: providerState, admin: "not-ready" } },
        },
      });
    }),
);
it.effect("stopped provider cannot be administered", () =>
  Effect.gen(function* () {
    const result = yield* runFixture({ providerState: "stopped" });
    expect(result.code).toBe(4);
    expect(result.requests).toEqual([]);
    expect(result.stdout).toBe("");
  }),
);

it.effect("empty creation names are omitted from the wire input", () =>
  Effect.gen(function* () {
    const result = yield* runFixture({
      extraArgs: ["--first-name", "", "--last-name", ""],
    });
    expect(result.code).toBe(0);
    expect(result.requests[1]?.input).not.toHaveProperty("firstName");
    expect(result.requests[1]?.input).not.toHaveProperty("lastName");
  }),
);

it.effect.each([false, true])(
  "classifies bridge exceptions (verify=%s)",
  (bridgeVerify) =>
    Effect.gen(function* () {
      for (const [bridgeError, code] of [
        ["unexpected", "INTERNAL_ERROR"],
        ["TARGET_MISMATCH", "TARGET_MISMATCH"],
        ["SERVICE_UNAVAILABLE", "UNAVAILABLE"],
      ] as const) {
        const result = yield* runFixture({
          bridgeError,
          bridgeVerify,
          statusOnly: true,
        });
        expect(
          yield* Schema.decodeUnknownEffect(json)(result.stderr),
        ).toMatchObject({ error: { code } });
        expect(result.stderr).not.toContain("secret-canary");
      }
    }),
);
it.effect("preserves inbox INVALID_RESPONSE classification", () =>
  Effect.gen(function* () {
    const result = yield* runFixture({ inboxInvalidResponse: true });
    expect(
      yield* Schema.decodeUnknownEffect(json)(result.stderr),
    ).toMatchObject({
      error: { code: "INVALID_RESPONSE", outcome: "not-applied" },
    });
  }),
);

// Characterizes the process boundary with a real scoped finalizer, not a timer mock.
it.effect.each([false, true])(
  "hard-exits after entering blocked cleanup (SIGINT=%s)",
  (interrupt) =>
    Effect.gen(function* () {
      const result = yield* runFixture({
        stall: "mutation",
        blockedFinalizer: true,
        interrupt,
      });
      expect(result.stderr).toBe("FINALIZER_ENTERED\n");
      expect(result.signal).toBe(null);
      expect(result.code).toBe(interrupt ? 130 : 5);
      expect(result.requests.map((request) => request.operation)).toEqual([
        "status",
        "users.create",
      ]);
    }),
  { timeout: 7000 },
);

it.effect(
  "rearms beyond the bootstrap deadline without leaving its old fiber live",
  () =>
    Effect.gen(function* () {
      const result = yield* runFixture({ statusDelay: 5100, timeoutMs: 6000 });
      expect(result.signal).toBe(null);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.requests.map((request) => request.operation)).toEqual([
        "status",
        "users.create",
      ]);
    }),
  { timeout: 10000 },
);
