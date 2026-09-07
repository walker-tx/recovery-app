import { Effect, Option, Schema, type Scope } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { AdminInputs } from "../contracts/admin.ts";
import { failure, type MockError } from "./output.ts";

const optional = (name: string) => Flag.string(name).pipe(Flag.optional);
const boolean = (name: string) =>
  Flag.boolean(name).pipe(Flag.withDefault(false));
const bounded = (name: string, min: number, max: number, fallback: number) =>
  Flag.integer(name).pipe(
    Flag.withSchema(
      Schema.Number.check(Schema.isBetween({ minimum: min, maximum: max })),
    ),
    Flag.withDefault(fallback),
  );
export type Invocation = {
  operation: string;
  input: Record<string, unknown>;
  worktree?: string;
  expectStack?: string;
  expectGeneration?: string;
  timeoutMs: number;
  json: boolean;
  passwordStdin: boolean;
};
export const makeCommand = (
  execute: (
    invocation: Invocation,
  ) => Effect.Effect<void, MockError, Scope.Scope>,
) => {
  const root = Command.make("mock").pipe(
    Command.withSharedFlags({
      json: boolean("json"),
      help: boolean("help").pipe(Flag.withAlias("h")),
      version: boolean("version"),
      worktree: optional("worktree"),
      expectStack: optional("expect-stack"),
      expectGeneration: optional("expect-generation"),
      timeoutMs: bounded("timeout-ms", 1, 30000, 5000),
    }),
  );
  const handler = (operation: string) =>
    Effect.fn(function* (raw: Record<string, unknown>) {
      const globals = yield* root;
      const input: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(raw)) {
        if (key === "passwordStdin") {
          continue;
        }
        if (Option.isOption(value)) {
          if (Option.isSome(value)) {
            input[key] = value.value;
          }
        } else {
          input[key] = value;
        }
      }
      if (operation === "users.create") {
        for (const name of ["firstName", "lastName"]) {
          if (input[name] === "") {
            delete input[name];
          }
        }
      }
      if (typeof input.verified === "string") {
        input.verified = input.verified === "true";
      }
      const selectedOperation = globals.help
        ? "help"
        : globals.version
          ? "version"
          : operation;
      if (!globals.help && !globals.version) {
        if (operation === "users.delete" && input.confirmEmail === undefined) {
          return yield* Effect.fail(failure("INVALID_INPUT"));
        }
        const schema = Object.entries(AdminInputs).find(
          ([name]) => name === operation,
        )?.[1];
        if (schema !== undefined) {
          yield* Schema.decodeUnknownEffect(schema)(
            operation === "users.create"
              ? { ...input, password: "validation-placeholder" }
              : input,
            { onExcessProperty: "error" },
          ).pipe(Effect.mapError(() => failure("INVALID_INPUT")));
        } else if (operation === "inbox.read") {
          yield* Schema.decodeUnknownEffect(
            Schema.Struct({ messageId: Schema.NonEmptyString }),
          )(input).pipe(Effect.mapError(() => failure("INVALID_INPUT")));
        } else if (operation !== "inbox.list") {
          return yield* Effect.fail(failure("INVALID_INPUT"));
        }
      }
      return yield* execute({
        operation: selectedOperation,
        input,
        json: globals.json,
        timeoutMs: globals.timeoutMs,
        passwordStdin: raw.passwordStdin === true,
        ...Option.match(globals.worktree, {
          onNone: () => ({}),
          onSome: (worktree) => ({ worktree }),
        }),
        ...Option.match(globals.expectStack, {
          onNone: () => ({}),
          onSome: (expectStack) => ({ expectStack }),
        }),
        ...Option.match(globals.expectGeneration, {
          onNone: () => ({}),
          onSome: (expectGeneration) => ({ expectGeneration }),
        }),
      });
    });
  const paging = {
    limit: bounded("limit", 1, 100, 50),
    cursor: optional("cursor"),
  };
  const userId = Argument.string("user-id").pipe(Argument.optional);
  const names = {
    firstName: optional("first-name"),
    lastName: optional("last-name"),
  };
  return root.pipe(
    Command.withHandler((globals) =>
      globals.help || globals.version
        ? execute({
            operation: globals.help ? "help" : "version",
            input: {},
            json: globals.json,
            timeoutMs: globals.timeoutMs,
            passwordStdin: false,
          })
        : Effect.fail(failure("INVALID_INPUT")),
    ),
    Command.withSubcommands([
      Command.make("status", {}, handler("status")),
      Command.make("users", {}, handler("root")).pipe(
        Command.withSubcommands([
          Command.make(
            "list",
            { ...paging, search: optional("search") },
            handler("users.list"),
          ),
          Command.make("get", { userId }, handler("users.get")),
          Command.make(
            "create",
            {
              email: optional("email"),
              ...names,
              passwordStdin: boolean("password-stdin"),
              verified: Flag.choice("verified", ["true", "false"]).pipe(
                Flag.withDefault("false"),
              ),
            },
            handler("users.create"),
          ),
          Command.make(
            "update",
            { userId, email: optional("email"), ...names },
            handler("users.update"),
          ),
          Command.make(
            "verify",
            {
              userId,
              verified: Flag.choice("verified", ["true", "false"]).pipe(
                Flag.optional,
              ),
            },
            handler("users.verify"),
          ),
          Command.make(
            "delete",
            { userId, confirmEmail: optional("confirm-email") },
            handler("users.delete"),
          ),
        ]),
      ),
      Command.make("sessions", {}, handler("root")).pipe(
        Command.withSubcommands([
          Command.make(
            "list",
            { ...paging, userId: optional("user") },
            handler("sessions.list"),
          ),
          Command.make(
            "revoke",
            {
              sessionId: Argument.string("session-id").pipe(Argument.optional),
            },
            handler("sessions.revoke"),
          ),
          Command.make(
            "revoke-all",
            { userId: optional("user") },
            handler("sessions.revoke-all"),
          ),
        ]),
      ),
      Command.make("inbox", {}, handler("root")).pipe(
        Command.withSubcommands([
          Command.make(
            "list",
            { ...paging, to: optional("to") },
            handler("inbox.list"),
          ),
          Command.make(
            "read",
            {
              messageId: Argument.string("message-id").pipe(Argument.optional),
            },
            handler("inbox.read"),
          ),
        ]),
      ),
    ]),
  );
};
