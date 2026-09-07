import { layer } from "@effect/vitest";
import { vi } from "vitest";
import { Effect, FileSystem, Path } from "effect";
import { NodeServices } from "@effect/platform-node";
import assert from "node:assert/strict";
import type { BinaryLike } from "node:crypto";
import type * as NodeCrypto from "node:crypto";
import { WorkOS } from "@workos-inc/node";
import { startProvider } from "../../src/server/provider.ts";
const gate = vi.hoisted(() => ({
  pause: false,
  release: undefined as undefined | (() => void),
}));
vi.mock("node:crypto", (importOriginal) =>
  importOriginal<typeof NodeCrypto>().then((actual) => ({
    ...actual,
    scrypt: (
      password: BinaryLike,
      salt: BinaryLike,
      length: number,
      callback: (error: Error | null, key: Buffer) => void,
    ) => {
      actual.scrypt(password, salt, length, (error, key) => {
        // Real crypto result, gated delivery only in this isolated test module.
        if (gate.pause && password === "Synthetic-before-race-48") {
          gate.release = () => callback(error, key);
        } else {
          callback(error, key);
        }
      });
    },
  })),
);
layer(NodeServices.layer, { excludeTestServices: true })("reset-race", (it) => {
  it.effect(
    "reset wins over a password sign-in whose old verifier was read before reset",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const { join } = yield* Path.Path;
        const dir = yield* fs
          .makeTempDirectoryScoped({ prefix: "reset-race-" })
          .pipe(Effect.flatMap(fs.realPath));
        const apiKey = `sk_test_local_${"38".repeat(32)}`;
        const provider = yield* Effect.acquireRelease(
          Effect.promise(() =>
            startProvider({ database: join(dir, "state.sqlite"), apiKey }),
          ),
          (ownedProvider) => Effect.promise(() => ownedProvider.close()),
        );
        const sdk = new WorkOS(apiKey, {
          apiHostname: "127.0.0.1",
          port: provider.port,
          https: false,
        });
        const user = yield* Effect.promise(() =>
          sdk.userManagement.createUser({
            email: "race@example.test",
            password: "Synthetic-before-race-48",
            emailVerified: true,
          }),
        );
        const reset = yield* Effect.promise(() =>
          sdk.userManagement.createPasswordReset({ email: user.email }),
        );
        gate.pause = true;
        const signIn = sdk.userManagement.authenticateWithPassword({
          clientId: provider.clientId,
          email: user.email,
          password: "Synthetic-before-race-48",
        });
        const rejected = assert.rejects(
          signIn,
          (error: unknown) =>
            error instanceof Error &&
            "error" in error &&
            error.error === "invalid_grant",
        );
        yield* Effect.gen(function* () {
          yield* Effect.promise(() =>
            vi.waitFor(
              () =>
                assert.ok(
                  gate.release,
                  "old-password scrypt did not reach the gate",
                ),
              { timeout: 2000 },
            ),
          );
          yield* Effect.promise(() =>
            sdk.userManagement.resetPassword({
              token: reset.passwordResetToken,
              newPassword: "Synthetic-after-race-48",
            }),
          );
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              gate.pause = false;
              gate.release?.();
            }),
          ),
        );
        yield* Effect.promise(() => rejected);
        const session = yield* Effect.promise(() =>
          sdk.userManagement.authenticateWithPassword({
            clientId: provider.clientId,
            email: user.email,
            password: "Synthetic-after-race-48",
          }),
        );
        assert.equal(session.user.id, user.id);
      }),
  );
});
