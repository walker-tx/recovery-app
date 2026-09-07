// Pure schema predicate; no filesystem access or Effect service is needed.
// oxlint-disable-next-line effecttsgo/node-builtin-import
import { isAbsolute } from "node:path";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Cause, ConfigProvider, Effect, Exit, Schema, Option } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import {
  loadProviderConfig,
  ConfigService,
  ConfigurationError,
  AdminStackId,
  AdminWorktree,
  ProviderGeneration,
} from "./config.ts";
import { acquireConfiguredProvider } from "./provider.ts";

const command = Command.make(
  "local-workos",
  {
    database: Flag.string("database").pipe(
      Flag.withSchema(Schema.String.check(Schema.makeFilter(isAbsolute))),
    ),
    port: Flag.string("port").pipe(
      Flag.withSchema(
        Schema.String.check(Schema.isPattern(/^[0-9]+$/))
          .pipe(Schema.decodeTo(Schema.NumberFromString))
          .check(
            Schema.isInt(),
            Schema.isBetween({ minimum: 1, maximum: 65535 }),
          ),
      ),
    ),
    adminSocket: Flag.string("admin-socket").pipe(Flag.optional),
    stackId: Flag.string("stack-id").pipe(
      Flag.withSchema(AdminStackId),
      Flag.optional,
    ),
    worktree: Flag.string("worktree").pipe(
      Flag.withSchema(AdminWorktree),
      Flag.optional,
    ),
    providerGeneration: Flag.string("provider-generation").pipe(
      Flag.withSchema(ProviderGeneration),
    ),
  },
  (options) =>
    Effect.gen(function* () {
      const adminSocket = Option.getOrUndefined(options.adminSocket);
      const stackId = Option.getOrUndefined(options.stackId);
      const worktree = Option.getOrUndefined(options.worktree);
      if (
        [adminSocket, stackId, worktree].some((value) => value !== undefined) &&
        [adminSocket, stackId, worktree].some((value) => value === undefined)
      ) {
        return yield* Effect.fail(
          new ConfigurationError({
            message:
              "Admin socket, stack ID and worktree must be supplied together",
          }),
        );
      }
      const config = yield* loadProviderConfig({
        ...options,
        ...(adminSocket !== undefined &&
        stackId !== undefined &&
        worktree !== undefined
          ? { admin: { socketPath: adminSocket, stackId, worktree } }
          : {}),
      });
      // NodeRuntime owns interruption. This watchdog also bounds an in-flight
      // uninterruptible acquisition or a Promise finalizer that never settles.
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          let deadline: ReturnType<typeof setTimeout> | undefined;
          const onSignal = () => {
            // Must fire even if the Effect runtime is stuck in uninterruptible cleanup.
            // oxlint-disable-next-line effecttsgo/global-timers
            deadline ??= setTimeout(() => process.exit(1), 3000);
          };
          process.on("SIGINT", onSignal);
          process.on("SIGTERM", onSignal);
          return () => {
            clearTimeout(deadline);
            process.off("SIGINT", onSignal);
            process.off("SIGTERM", onSignal);
          };
        }),
        (cleanup) => Effect.sync(cleanup),
      );
      const provider = yield* acquireConfiguredProvider.pipe(
        Effect.provideService(ConfigService, config),
      );
      const ready = yield* Schema.encodeEffect(
        Schema.fromJsonString(Schema.Json),
      )({
        providerGeneration: provider.providerGeneration,
        issuer: provider.issuer,
        clientId: provider.clientId,
        port: provider.port,
      });
      yield* Effect.sync(() => process.stdout.write(ready + "\n"));
      return yield* Effect.never;
    }),
);

Effect.suspend(() => {
  const snapshot = {
    // Snapshot once; Config consumes this snapshot after removing ambient access.
    // oxlint-disable-next-line effecttsgo/process-env-in-effect
    LOCAL_WORKOS_API_KEY: process.env.LOCAL_WORKOS_API_KEY,
  };
  // CLI-only consumption prevents later ambient reads/default child inheritance;
  // it does not erase the initial OS environment or zeroize credential memory.
  // oxlint-disable-next-line effecttsgo/process-env-in-effect -- CLI credential consumption boundary.
  delete process.env.LOCAL_WORKOS_API_KEY;
  return Command.run(command, { version: "0.0.0", renderErrors: false }).pipe(
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromUnknown(snapshot),
    ),
  );
}).pipe(
  Effect.scoped,
  // oxlint-disable-next-line effecttsgo/strict-effect-provide -- CLI application entry point.
  Effect.provide(NodeServices.layer),
  Effect.tapCause((cause) =>
    Cause.hasInterruptsOnly(cause)
      ? Effect.void
      : Effect.sync(() => {
          // Dependency and parser diagnostics may contain credentials: never render them.
          process.stderr.write(
            "Local provider startup failed; check explicit configuration and owned state.\n",
          );
        }),
  ),
  NodeRuntime.runMain({
    disableErrorReporting: true,
    // Signals are successful shutdowns only when every finalizer succeeds.
    teardown: (exit, onExit) =>
      onExit(
        Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause) ? 0 : 1,
      ),
  }),
);
