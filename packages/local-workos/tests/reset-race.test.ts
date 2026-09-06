import { it } from "@effect/vitest";
import { vi } from "vitest";
import { Effect } from "effect";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BinaryLike } from "node:crypto";
import { WorkOS } from "@workos-inc/node";
import { startProvider } from "../src/provider.ts";
const gate = vi.hoisted(() => ({ pause: false, entered: undefined as undefined | (() => void), release: undefined as undefined | (() => void) }));
vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, scrypt: (password: BinaryLike, salt: BinaryLike, length: number, callback: (error: Error | null, key: Buffer) => void) => {
    actual.scrypt(password, salt, length, (error, key) => {
      // Real crypto result, gated delivery only in this isolated test module.
      if (gate.pause && password === "Synthetic-before-race-48") {
        gate.release = () => callback(error, key); gate.entered?.();
      } else callback(error, key);
    });
  } };
});
it.live("reset wins over a password sign-in whose old verifier was read before reset", () => Effect.gen(function* () {
  const dir = yield* Effect.acquireRelease(Effect.promise(() => mkdtemp(join(tmpdir(), "reset-race-"))), dir => Effect.promise(() => rm(dir, { recursive: true, force: true })));
  const apiKey = `sk_test_local_${"38".repeat(32)}`;
  const provider = yield* Effect.acquireRelease(Effect.promise(() => startProvider({ database: join(dir, "state.sqlite"), apiKey })), provider => Effect.promise(() => provider.close()));
  const sdk = new WorkOS(apiKey, { apiHostname: "127.0.0.1", port: provider.port, https: false });
  yield* Effect.promise(async () => {
    const user = await sdk.userManagement.createUser({ email: "race@example.test", password: "Synthetic-before-race-48", emailVerified: true });
    const reset = await sdk.userManagement.createPasswordReset({ email: user.email });
    const entered = new Promise<void>(resolve => { gate.entered = resolve; });
    gate.pause = true;
    const signIn = sdk.userManagement.authenticateWithPassword({ clientId: provider.clientId, email: user.email, password: "Synthetic-before-race-48" });
    const rejected = assert.rejects(signIn, (error: unknown) => error instanceof Error && "error" in error && error.error === "invalid_grant");
    try {
      await entered;
      await sdk.userManagement.resetPassword({ token: reset.passwordResetToken, newPassword: "Synthetic-after-race-48" });
    } finally { gate.pause = false; gate.release?.(); }
    await rejected;
    assert.equal((await sdk.userManagement.authenticateWithPassword({ clientId: provider.clientId, email: user.email, password: "Synthetic-after-race-48" })).user.id, user.id);
  });
}));
