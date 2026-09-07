import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { vi } from "vitest";
import assert from "node:assert/strict";
import { Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireProvider } from "../../src/server/provider.ts";

it.live(
  "interruption during HTTP acquisition leaves no late listener",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const dir = yield* Effect.acquireRelease(
          Effect.promise(() => mkdtemp(join(tmpdir(), "workos-http-acquire-"))),
          (path) =>
            Effect.promise(() => rm(path, { recursive: true, force: true })),
        );
        const context = yield* Effect.context();
        const pending = yield* Deferred.make<void>();
        const entered = () => Deferred.doneUnsafe(pending, Effect.void);
        const gate = yield* Deferred.make<void>();
        const release = () => {
          Deferred.doneUnsafe(gate, Effect.void);
        };
        let binding: Fiber.Fiber<void> | undefined;
        const listening = yield* Deferred.make<void>();
        const bound = () => Deferred.doneUnsafe(listening, Effect.void);
        let cleaning = false;
        // oxlint-disable-next-line typescript/unbound-method -- Interception forwards the original method with the captured server receiver.
        const originalListen = Server.prototype.listen;
        const listenSpy = yield* Effect.acquireRelease(
          Effect.sync(() =>
            vi.spyOn(Server.prototype, "listen").mockImplementation(function (
              this: Server,
              ...args: Parameters<Server["listen"]>
            ) {
              this.once("listening", () => {
                bound();
                // Also cover a late bind after a timeout/assertion failure.
                if (cleaning) {
                  this.close();
                }
              });
              // This native operation outlives interruption of the acquisition fiber.
              binding = Effect.runForkWith(context)(
                Deferred.await(gate).pipe(
                  Effect.andThen(Effect.yieldNow),
                  Effect.andThen(
                    Effect.sync(() => {
                      originalListen.apply(this, args);
                    }),
                  ),
                ),
              );
              entered();
              return this;
            }),
          ),
          (spy) =>
            Effect.gen(function* () {
              const server = spy.mock.contexts[0];
              cleaning = true;
              release();
              spy.mockRestore();
              if (binding) {
                yield* Fiber.join(binding).pipe(
                  Effect.timeout("2 seconds"),
                  Effect.orDie,
                );
              }
              if (server instanceof Server && server.listening) {
                server.closeAllConnections();
                yield* Effect.callback<void>((resume) => {
                  server.close(() => resume(Effect.void));
                });
              }
            }),
        );
        const owner = yield* Effect.scoped(
          acquireProvider({
            database: join(dir, "state.sqlite"),
            apiKey: `sk_test_local_${"a".repeat(64)}`,
          }).pipe(Effect.andThen(Effect.never)),
        ).pipe(Effect.forkScoped);
        // Registered after forkScoped: release the gate before its interrupt finalizer.
        yield* Effect.addFinalizer(() => Effect.sync(release));
        yield* Deferred.await(pending).pipe(Effect.timeout("2 seconds"));
        // rc.112's interruptUnsafe synchronously records the request. This
        // handshake must not await cleanup: masked acquisition needs the gate
        // released before interruption can finish. Fiber.interrupt waits for both.
        yield* Effect.sync(() => owner.interruptUnsafe());
        release();
        yield* Deferred.await(listening).pipe(Effect.timeout("2 seconds"));
        yield* Fiber.await(owner).pipe(Effect.timeout("2 seconds"));
        const boundServer = listenSpy.mock.contexts[0];
        assert.ok(boundServer instanceof Server);
        assert.equal(
          boundServer.listening,
          false,
          "interrupted acquisition left a late HTTP listener alive",
        );
      }),
    ),
  { timeout: 8000 },
);
