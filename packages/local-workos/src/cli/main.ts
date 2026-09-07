import { NodeServices } from "@effect/platform-node";
import {
  Cause,
  Clock,
  Fiber,
  Console,
  Effect,
  Exit,
  Logger,
  Layer,
  Schema,
  type Scope,
} from "effect";
import { CliConfig, CliOutput, CliError, Command } from "effect/unstable/cli";
import { InboxError, listInbox, readInbox } from "./mailpit-client.ts";
import { makeCommand } from "./commands.ts";
import type { Invocation } from "./commands.ts";
import {
  adminRequest,
  isMutation,
  selectTarget,
  verifyTarget,
} from "./admin-client.ts";
import {
  MockError,
  errorEnvelope,
  failure,
  successEnvelope,
  writeOutput,
} from "./output.ts";
import type { Target } from "./output.ts";

const main = Effect.gen(function* () {
  const start = yield* Clock.currentTimeMillis;
  let target: Target | null = null;
  let dispatched = false;
  let interrupted = false;
  let deadlineExpired = false;
  let json = process.argv.slice(2).includes("--json");
  let worker: Fiber.Fiber<void, unknown> | undefined = undefined;
  let grace: Fiber.Fiber<never> | undefined;
  const stop = Effect.fn("mock.stop")(function* (signal: boolean) {
    interrupted ||= signal;
    deadlineExpired ||= !signal;
    // Own the independent watchdog before interruption can enter worker finalizers.
    if (!grace) {
      grace = yield* Effect.sleep(3000).pipe(
        Effect.andThen(
          Effect.sync(() =>
            process.exit(interrupted ? 130 : dispatched ? 5 : 4),
          ),
        ),
        Effect.forkDetach,
      );
    }
    if (worker) {
      yield* Fiber.interrupt(worker);
    }
  });
  let timer = yield* Effect.sleep(5000).pipe(
    Effect.andThen(stop(false)),
    Effect.forkDetach,
  );
  let onSignal: (() => void) | undefined = undefined;
  const signals = yield* Effect.callback<void>((resume) => {
    onSignal = () => {
      interrupted = true;
      resume(Effect.void);
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
    return Effect.void;
  }).pipe(Effect.andThen(stop(true)), Effect.forkDetach);
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      if (onSignal) {
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
      }
      yield* Fiber.interrupt(signals);
      yield* Fiber.interrupt(timer);
      if (grace) {
        yield* Fiber.interrupt(grace);
      }
    }),
  );
  // Stream errors must never become uncaught Node exceptions, including late EPIPE.
  const swallowStreamError = () => {
    process.exitCode = dispatched ? 5 : 1;
  };
  process.stdout.on("error", swallowStreamError);
  process.stderr.on("error", swallowStreamError);

  const passwordFromStdin = Effect.callback<string, MockError>((resume) => {
    if (process.stdin.isTTY) {
      resume(Effect.fail(failure("INVALID_INPUT")));
      return Effect.void;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > 4096) {
        process.stdin.pause();
        resume(Effect.fail(failure("INVALID_INPUT")));
      } else {
        chunks.push(chunk);
      }
    };
    const onEnd = () => {
      if (size === 0) {
        resume(Effect.fail(failure("INVALID_INPUT")));
        return;
      }
      try {
        resume(
          Effect.succeed(
            new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
              Buffer.concat(chunks),
            ),
          ),
        );
      } catch {
        resume(Effect.fail(failure("INVALID_INPUT")));
      }
    };
    const onError = () => resume(Effect.fail(failure("INVALID_INPUT")));
    process.stdin.on("data", onData).once("end", onEnd).once("error", onError);
    process.stdin.resume();
    return Effect.sync(() => {
      process.stdin.pause();
      process.stdin.off("data", onData).off("end", onEnd).off("error", onError);
    });
  });
  const execute = Effect.fn("mock.execute")(function* (invocation: Invocation) {
    json = invocation.json;
    yield* Fiber.interrupt(timer);
    const remaining =
      start + invocation.timeoutMs - (yield* Clock.currentTimeMillis);
    if (remaining <= 0) {
      return yield* Effect.fail(failure("DEADLINE"));
    }
    timer = yield* Effect.sleep(remaining).pipe(
      Effect.andThen(stop(false)),
      Effect.forkDetach,
    );
    if (invocation.operation === "help" || invocation.operation === "version") {
      return yield* writeOutput(
        process.stdout,
        successEnvelope(
          null,
          invocation.operation === "version"
            ? { kind: "version", version: "0.0.0" }
            : {
                kind: "help",
                commands: [
                  "status — show selected stack and service status",
                  "users list [--search <text>] [--limit <1-100>] [--cursor <cursor>] — list users",
                  "users get <user-id> — inspect a user",
                  "users create --email <email> --password-stdin [--first-name <name>] [--last-name <name>] [--verified true|false] — create a user (verified defaults false)",
                  "users update <user-id> [--email <email>] [--first-name <name>] [--last-name <name>] — update supplied fields",
                  "users verify <user-id> --verified true|false — set email verification",
                  "users delete <user-id> --confirm-email <email> — delete only with matching current email confirmation",
                  "sessions list [--user <user-id>] [--limit <1-100>] [--cursor <cursor>] — list sessions",
                  "sessions revoke <session-id> — revoke a session",
                  "sessions revoke-all --user <user-id> — revoke all sessions for a user",
                  "inbox list [--to <recipient>] [--limit <1-100>] [--cursor <cursor>] — list messages without changing read state",
                  "inbox read <message-id> — expose sensitive message text; marks-read; a failed read may already have changed the unread flag",
                ],
                globalFlags: [
                  "--json",
                  "--help / -h, --version — non-service commands; no target selected",
                  "--worktree <path> — explicitly select a worktree",
                  "--expect-stack <stack> — assert stack UUID",
                  "--expect-generation <generation> — assert provider generation",
                  "--timeout-ms <1-30000> — total invocation deadline; default 5000 ms",
                ],
                safety: [
                  "users create/update/verify/delete and sessions revoke/revoke-all require both --expect-stack <stack> and --expect-generation <generation>. inbox read does not require these flags, but supplied assertions still apply.",
                  "--password-stdin rejects a TTY, caps input at 4 KiB and preserves exact UTF-8 including trailing newlines. Use printf, not echo; passwords in argv or environment are not accepted.",
                  "inbox read text provenance is Mailpit-parsed-or-derived, not necessarily an original plain-text MIME part. Empty text is null with a no-usable-text indication. No HTML rendering, link opening, asset fetching, attachment downloads or automatic code submission. Reading does not complete verification/reset or change authentication state.",
                  "Pagination defaults to 50; pass returned cursor unchanged. Use mise run mock -- ...; task stderr may include Mise runner diagnostics on failure; exit semantics are unchanged.",
                ],
                passwordExample:
                  "printf '%s' 'synthetic-password' | mise run mock -- users create --email person@example.test --password-stdin --expect-stack <stack> --expect-generation <generation>",
              },
        ),
        json,
      );
    }
    if (invocation.operation === "users.create" && !invocation.passwordStdin) {
      return yield* Effect.fail(failure("INVALID_INPUT"));
    }
    if (
      isMutation(invocation.operation) &&
      invocation.operation !== "inbox.read" &&
      (!invocation.expectStack || !invocation.expectGeneration)
    ) {
      return yield* Effect.fail(failure("CONFIRMATION_REQUIRED"));
    }
    const selection = yield* selectTarget(invocation.worktree);
    target = {
      worktree: selection.worktree,
      stackId: selection.stackId,
      providerGeneration: selection.providerGeneration,
      identityVerified: false,
    };
    if (
      (invocation.expectStack !== undefined &&
        invocation.expectStack !== selection.stackId) ||
      (invocation.expectGeneration !== undefined &&
        invocation.expectGeneration !== selection.providerGeneration)
    ) {
      return yield* Effect.fail(failure("TARGET_MISMATCH"));
    }
    if (selection.providerState !== "running") {
      if (invocation.operation === "status") {
        return yield* writeOutput(
          process.stdout,
          successEnvelope(target, {
            users: null,
            sessions: null,
            services: {
              provider: { state: selection.providerState, admin: "not-ready" },
              inbox: {
                state: selection.inbox === null ? "unavailable" : "registered",
                readiness: "not-probed",
              },
            },
          }),
          json,
        );
      }
      return yield* Effect.fail(failure("UNAVAILABLE"));
    }
    yield* verifyTarget(selection);
    const status = yield* adminRequest(selection, "status", {}, () => {});
    target = { ...target, identityVerified: true };
    yield* verifyTarget(selection);
    let data: unknown =
      invocation.operation === "status"
        ? {
            ...status,
            services: {
              provider: { state: selection.providerState, admin: "ready" },
              inbox: {
                state: selection.inbox === null ? "unavailable" : "registered",
                readiness: "not-probed",
              },
            },
          }
        : status;
    if (invocation.operation.startsWith("inbox.")) {
      if (selection.inbox === null) {
        return yield* Effect.fail(failure("UNAVAILABLE"));
      }
      const inboxTarget = {
        stackId: selection.stackId,
        providerGeneration: selection.providerGeneration,
        ...selection.inbox,
      };
      // Mailpit normalizes verifier failures to its refusal sentinel and owns
      // dispatch outcomes. Retain the registry classification at this boundary.
      let verificationCode: string | undefined;
      const verify = verifyTarget(selection, true).pipe(
        Effect.tapError((error) =>
          Effect.sync(() => {
            verificationCode = error.code;
          }),
        ),
        Effect.mapError(
          () =>
            new InboxError({
              code: "OWNERSHIP_CHANGED",
              message: "Inbox ownership changed.",
              outcome: dispatched ? "unknown" : "not-applied",
            }),
        ),
      );
      const options = invocation.input as {
        limit?: number;
        cursor?: string;
        to?: string;
      };
      const operation: Effect.Effect<unknown, InboxError, Scope.Scope> =
        invocation.operation === "inbox.list"
          ? listInbox(inboxTarget, options, verify)
          : readInbox(
              inboxTarget,
              String(invocation.input.messageId),
              verify,
              () => {
                dispatched = true;
              },
            );
      data = yield* operation.pipe(
        Effect.mapError((error) =>
          failure(
            verificationCode ??
              (error.code === "OWNERSHIP_CHANGED"
                ? "TARGET_MISMATCH"
                : error.code === "INVALID_RESPONSE"
                  ? "INVALID_RESPONSE"
                  : error.code.startsWith("INVALID_")
                    ? "INVALID_INPUT"
                    : "UNAVAILABLE"),
            error.outcome,
          ),
        ),
      );
    } else if (invocation.operation !== "status") {
      if (invocation.operation === "users.create") {
        invocation.input.password = yield* passwordFromStdin;
      }
      yield* verifyTarget(selection);
      data = yield* adminRequest(
        selection,
        invocation.operation,
        invocation.input,
        () => {
          dispatched = isMutation(invocation.operation);
        },
      );
      yield* verifyTarget(selection).pipe(
        Effect.mapError(() =>
          failure("TARGET_MISMATCH", dispatched ? "unknown" : "not-applied"),
        ),
      );
    }
    return yield* writeOutput(
      process.stdout,
      successEnvelope(target, data),
      json,
    ).pipe(
      Effect.mapError(() =>
        failure("OUTPUT_FAILED", dispatched ? "unknown" : "not-applied"),
      ),
    );
  });
  const formatter: CliOutput.Formatter = {
    formatHelpDoc: () => "",
    formatVersion: () => "",
    formatCliError: () => "",
    formatError: () => "",
    formatErrors: () => "",
  };
  const noop = () => {};
  const quietConsole: Console.Console = {
    assert: noop,
    clear: noop,
    count: noop,
    countReset: noop,
    debug: noop,
    dir: noop,
    dirxml: noop,
    error: noop,
    group: noop,
    groupCollapsed: noop,
    groupEnd: noop,
    info: noop,
    log: noop,
    table: noop,
    time: noop,
    timeEnd: noop,
    timeLog: noop,
    trace: noop,
    warn: noop,
  };
  const program = Effect.gen(function* () {
    const services = yield* Layer.build(
      Layer.merge(NodeServices.layer, Logger.layer([])),
    );
    yield* Command.runWith(makeCommand(execute), {
      version: "0.0.0",
      renderErrors: false,
    })(process.argv.slice(2)).pipe(Effect.provide(services));
  }).pipe(
    Effect.provideService(
      CliConfig.CliConfig,
      CliConfig.make({ builtIns: [] }),
    ),
    Effect.provideService(CliOutput.Formatter, formatter),
    Effect.provideService(Console.Console, quietConsole),
    Effect.scoped,
  );
  worker = yield* Effect.forkDetach(program);
  const result = yield* Fiber.await(worker);
  if (Exit.isFailure(result)) {
    const cause = Cause.squash(result.cause);
    const error = interrupted
      ? failure("INTERRUPTED", dispatched ? "unknown" : "not-applied", 130)
      : deadlineExpired
        ? failure("DEADLINE", dispatched ? "unknown" : "not-applied")
        : Schema.is(MockError)(cause)
          ? dispatched && cause.outcome !== "not-applied"
            ? failure(cause.code, "unknown")
            : cause
          : failure(
              CliError.isCliError(cause) ? "INVALID_INPUT" : "INTERNAL_ERROR",
              dispatched ? "unknown" : "not-applied",
            );
    process.exitCode = error.exitCode;
    yield* Effect.exit(
      writeOutput(process.stderr, errorEnvelope(target, error), json).pipe(
        Effect.timeout(1000),
      ),
    );
  }

  // Failed output can leave a blocked writable handle alive after cancellation.
  // The error write and scoped cleanup already completed (or hit their bounds).
  return Exit.isFailure(result);
}).pipe(Effect.scoped);
const result = await Effect.runPromise(main);
if (result) {
  process.exit(process.exitCode ?? 1);
}
