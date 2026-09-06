import { it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { vi } from "vitest";
import assert from "node:assert/strict";
import { Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquireProvider } from "../src/provider.ts";

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
        let entered!: () => void;
        const pending = new Promise<void>((resolve) => {
          entered = resolve;
        });
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        let bound!: () => void;
        const listening = new Promise<void>((resolve) => {
          bound = resolve;
        });
        let server: Server | undefined;
        let cleaning = false;
        const originalListen = Server.prototype.listen;
        yield* Effect.acquireRelease(
          Effect.sync(() =>
            vi.spyOn(Server.prototype, "listen").mockImplementation(function (
              this: Server,
              ...args: Parameters<Server["listen"]>
            ) {
              server = this;
              this.once("listening", () => {
                bound();
                // Also cover a late bind after a timeout/assertion failure.
                if (cleaning) this.close();
              });
              void gate.then(() => {
                originalListen.apply(this, args);
              });
              entered();
              return this;
            }),
          ),
          (spy) =>
            Effect.promise(async () => {
              cleaning = true;
              release();
              spy.mockRestore();
              if (server?.listening) {
                server.closeAllConnections();
                await new Promise<void>((resolve) =>
                  server!.close(() => resolve()),
                );
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
        yield* Effect.promise(() => pending).pipe(Effect.timeout("2 seconds"));
        const interrupted = yield* Fiber.interrupt(owner).pipe(
          Effect.forkScoped,
        );
        // Let the interruption run while listen is still held behind the gate.
        yield* Effect.promise(
          () => new Promise<void>((resolve) => setImmediate(resolve)),
        );
        release();
        yield* Effect.promise(() => listening).pipe(
          Effect.timeout("2 seconds"),
        );
        yield* Fiber.join(interrupted).pipe(Effect.timeout("2 seconds"));
        assert.equal(
          server?.listening,
          false,
          "interrupted acquisition left a late HTTP listener alive",
        );
      }),
    ),
  { timeout: 8000 },
);
