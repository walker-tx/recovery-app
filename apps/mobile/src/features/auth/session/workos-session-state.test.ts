import assert from "node:assert/strict";
import test from "node:test";

import { createWorkOSSessionOwner, type SessionCredentials } from "./workos-session-state.ts";

const session = (suffix: string): SessionCredentials => ({ accessToken: `access-${suffix}`, refreshToken: `refresh-${suffix}` });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function harness(stored: SessionCredentials | null = null) {
  let persisted = stored;
  const writes: SessionCredentials[] = [];
  let clears = 0;
  const refreshes: Array<(refreshToken: string) => Promise<
    { status: "success"; accessToken: string; refreshToken: string } | { status: "invalid" }
  >> = [];
  const actions = {
    async signIn() { return session("signed-in"); },
    async completeSignup() { return session("signup"); },
    refreshSession(input: { refreshToken: string }) { return refreshes[0]!(input.refreshToken); },
    async signOutSession() { return { revoked: true as const }; },
  };
  const owner = createWorkOSSessionOwner({
    storage: {
      async read() { return persisted; },
      async write(value) { persisted = value; writes.push(value); },
      async clear() { persisted = null; clears += 1; },
    },
    actions,
  });
  return { owner, actions, refreshes, writes, get persisted() { return persisted; }, get clears() { return clears; } };
}

test("startup moves from loading to restored or unauthenticated", async () => {
  const restored = harness(session("stored"));
  assert.deepEqual(restored.owner.getSnapshot(), { isLoading: true, isAuthenticated: false, isRefreshing: false, isSigningOut: false, retry: null });
  await restored.owner.restore();
  assert.equal(restored.owner.getSnapshot().isAuthenticated, true);

  const empty = harness();
  await empty.owner.restore();
  assert.deepEqual(empty.owner.getSnapshot(), { isLoading: false, isAuthenticated: false, isRefreshing: false, isSigningOut: false, retry: null });
});

test("sign-in and signup completion persist and establish sessions", async () => {
  const signInHarness = harness();
  await signInHarness.owner.signIn({ email: "person@example.com", password: "secret" });
  assert.deepEqual(signInHarness.persisted, session("signed-in"));
  assert.equal(signInHarness.owner.getSnapshot().isAuthenticated, true);

  const signupHarness = harness();
  await signupHarness.owner.completeSignup({ intentId: "opaque", code: "123456" });
  assert.deepEqual(signupHarness.persisted, session("signup"));
});

test("concurrent refresh callers share one promise and one persisted result", async () => {
  const refresh = deferred<{ status: "success"; accessToken: string; refreshToken: string }>();
  const h = harness(session("stored"));
  h.refreshes.push(() => refresh.promise);
  await h.owner.restore();

  const first = h.owner.refresh();
  const second = h.owner.refresh();
  assert.equal(first, second);
  assert.equal(h.owner.getSnapshot().isRefreshing, true);

  refresh.resolve({ status: "success", ...session("fresh") });
  assert.equal(await first, "access-fresh");
  assert.deepEqual(h.persisted, session("fresh"));
  assert.equal(h.writes.length, 1);
  assert.equal(h.owner.getSnapshot().isRefreshing, false);
});

test("retryable refresh failure preserves persisted and in-memory session", async () => {
  const h = harness(session("stored"));
  h.refreshes.push(async () => { throw new Error("network"); });
  await h.owner.restore();
  await assert.rejects(h.owner.refresh(), /network/);
  assert.deepEqual(h.persisted, session("stored"));
  assert.deepEqual(h.owner.getSnapshot().retry, { operation: "refresh" });
  assert.equal(await h.owner.fetchAccessToken({ forceRefreshToken: false }), "access-stored");
});

test("terminal invalid refresh clears storage and authentication", async () => {
  const h = harness(session("stored"));
  h.refreshes.push(async () => ({ status: "invalid" as const }));
  await h.owner.restore();
  assert.equal(await h.owner.refresh(), null);
  assert.equal(h.persisted, null);
  assert.equal(h.clears, 1);
  assert.equal(h.owner.getSnapshot().isAuthenticated, false);
});

test("failed sign-out retains session for retry; confirmed revocation clears it", async () => {
  const h = harness(session("stored"));
  let rejectSignOut = true;
  h.actions.signOutSession = async () => {
    if (rejectSignOut) throw new Error("offline");
    return { revoked: true as const };
  };
  await h.owner.restore();

  const failed = h.owner.signOut();
  assert.equal(h.owner.getSnapshot().isSigningOut, true);
  await assert.rejects(failed, /offline/);
  assert.equal(h.owner.getSnapshot().isAuthenticated, true);
  assert.deepEqual(h.owner.getSnapshot().retry, { operation: "signOut" });
  assert.deepEqual(h.persisted, session("stored"));

  rejectSignOut = false;
  await h.owner.signOut();
  assert.equal(h.persisted, null);
  assert.equal(h.owner.getSnapshot().isAuthenticated, false);
});
