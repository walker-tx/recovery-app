import { isAbsolute } from "node:path";
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Cause, Effect, Exit, Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";
import { loadProviderConfig, ConfigService } from "./config.ts";
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
    providerGeneration: Flag.string("provider-generation").pipe(
      Flag.withSchema(Schema.String.check(Schema.isUUID())),
    ),
  },
  (options) =>
    Effect.gen(function* () {
      const config = yield* loadProviderConfig(options);
      // NodeRuntime owns interruption. This watchdog also bounds an in-flight
      // uninterruptible acquisition or a Promise finalizer that never settles.
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          let deadline: ReturnType<typeof setTimeout> | undefined;
          const onSignal = () => {
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
      yield* Effect.sync(() =>
        process.stdout.write(
          JSON.stringify({
            providerGeneration: provider.providerGeneration,
            issuer: provider.issuer,
            clientId: provider.clientId,
            port: provider.port,
          }) + "\n",
        ),
      );
      yield* Effect.never;
    }),
);

Command.run(command, { version: "0.0.0", renderErrors: false }).pipe(
  Effect.scoped,
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
