import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkOSSessionOwner,
  type SessionCredentials,
  type WorkOSSessionActions,
} from "./workos-session-state.ts";
import { createWorkOSSessionStorage } from "./workos-session-storage.ts";

const credentials = (suffix: string): SessionCredentials => ({
  accessToken: `access-${suffix}`,
  refreshToken: `refresh-${suffix}`,
});
const encoded = (suffix: string) => JSON.stringify({ version: 2, environmentId: "environment-a", ...credentials(suffix) });
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fakeSecureStore(initial: string | null) {
  let value = initial;
  return {
    adapter: {
      async getItemAsync() { return value; },
      async setItemAsync(_key: string, next: string) { value = next; },
      async deleteItemAsync() { value = null; },
    },
    get value() { return value; },
  };
}

function actions(overrides: Partial<WorkOSSessionActions> = {}): WorkOSSessionActions {
  return {
    async signIn() { return credentials("signed-in"); },
    async completeSignup() { return credentials("signup"); },
    async refreshSession() { return { status: "success", ...credentials("refreshed") }; },
    async signOutSession() { return { revoked: true }; },
    ...overrides,
  };
}

test("restoration refreshes persisted credentials without a protected-route flash", async () => {
  const refresh = deferred<{ status: "success"; accessToken: string; refreshToken: string }>();
  const secureStore = fakeSecureStore(encoded("stored"));
  const owner = createWorkOSSessionOwner({
    storage: createWorkOSSessionStorage(secureStore.adapter, "environment-a"),
    actions: actions({ async refreshSession() { return refresh.promise; } }),
  });
  const published = [owner.getSnapshot()];
  owner.subscribe(() => published.push(owner.getSnapshot()));

  const restoring = owner.restore();
  await tick();
  assert.equal(owner.getSnapshot().isLoading, true);
  assert.equal(published.some(({ isLoading, isAuthenticated }) => !isLoading && isAuthenticated), false);
  refresh.resolve({ status: "success", ...credentials("restored") });
  await restoring;

  assert.equal(owner.getSnapshot().isAuthenticated, true);
  assert.deepEqual(JSON.parse(secureStore.value!), { version: 2, environmentId: "environment-a", ...credentials("restored") });
});

test("forced concurrent token requests serialize one refresh and share its result", async () => {
  const forcedRefresh = deferred<{ status: "success"; accessToken: string; refreshToken: string }>();
  let refreshCalls = 0;
  const secureStore = fakeSecureStore(encoded("stored"));
  const owner = createWorkOSSessionOwner({
    storage: createWorkOSSessionStorage(secureStore.adapter, "environment-a"),
    actions: actions({
      async refreshSession() {
        refreshCalls += 1;
        if (refreshCalls === 1) return { status: "success", ...credentials("restored") };
        return forcedRefresh.promise;
      },
    }),
  });
  await owner.restore();

  const first = owner.fetchAccessToken({ forceRefreshToken: true });
  const second = owner.fetchAccessToken({ forceRefreshToken: true });
  await tick();
  assert.equal(refreshCalls, 2);
  forcedRefresh.resolve({ status: "success", ...credentials("forced") });
  assert.deepEqual(await Promise.all([first, second]), ["access-forced", "access-forced"]);
  assert.equal(await owner.fetchAccessToken({ forceRefreshToken: false }), "access-forced");
});

test("transient restoration failure retains SecureStore credentials and retries", async () => {
  const secureStore = fakeSecureStore(encoded("stored"));
  let fail = true;
  const owner = createWorkOSSessionOwner({
    storage: createWorkOSSessionStorage(secureStore.adapter, "environment-a"),
    actions: actions({
      async refreshSession() {
        if (fail) throw new Error("offline");
        return { status: "success", ...credentials("retried") };
      },
    }),
  });

  await assert.rejects(owner.restore(), /offline/);
  assert.equal(secureStore.value, encoded("stored"));
  assert.deepEqual(owner.getSnapshot().retry, { operation: "restore" });
  assert.equal(owner.getSnapshot().isLoading, true);
  fail = false;
  await owner.retryRestore();
  assert.equal(owner.getSnapshot().isAuthenticated, true);
  assert.equal(secureStore.value, encoded("retried"));
});

test("terminal restoration invalidation clears SecureStore and settles unauthenticated", async () => {
  const secureStore = fakeSecureStore(encoded("expired"));
  const owner = createWorkOSSessionOwner({
    storage: createWorkOSSessionStorage(secureStore.adapter, "environment-a"),
    actions: actions({ async refreshSession() { return { status: "invalid" }; } }),
  });

  await owner.restore();
  assert.equal(secureStore.value, null);
  assert.deepEqual(owner.getSnapshot(), {
    isLoading: false,
    isAuthenticated: false,
    isRefreshing: false,
    isSigningOut: false,
    retry: null,
  });
});

test("successful sign-out revokes before clearing the persisted session", async () => {
  const secureStore = fakeSecureStore(null);
  const events: string[] = [];
  const storage = createWorkOSSessionStorage(secureStore.adapter, "environment-a");
  const owner = createWorkOSSessionOwner({
    storage: {
      ...storage,
      async clear() { events.push("clear"); await storage.clear(); },
    },
    actions: actions({
      async signOutSession({ refreshToken }) {
        events.push(`revoke:${refreshToken}`);
        return { revoked: true };
      },
    }),
  });
  await owner.restore();
  await owner.signIn({ email: "person@example.com", password: "secret" });

  await owner.signOut();
  assert.deepEqual(events, ["revoke:refresh-signed-in", "clear"]);
  assert.equal(secureStore.value, null);
  assert.equal(owner.getSnapshot().isAuthenticated, false);
});

test("failed sign-out retains the local session for a safe retry", async () => {
  const secureStore = fakeSecureStore(null);
  const owner = createWorkOSSessionOwner({
    storage: createWorkOSSessionStorage(secureStore.adapter, "environment-a"),
    actions: actions({ async signOutSession() { throw new Error("offline"); } }),
  });
  await owner.restore();
  await owner.signIn({ email: "person@example.com", password: "secret" });

  await assert.rejects(owner.signOut(), /offline/);
  assert.equal(secureStore.value, encoded("signed-in"));
  assert.equal(owner.getSnapshot().isAuthenticated, true);
  assert.deepEqual(owner.getSnapshot().retry, { operation: "signOut" });
});

test("an interrupted sign-out response retains credentials until an already-revoked retry succeeds", async () => {
  const secureStore = fakeSecureStore(null);
  let attempts = 0;
  const owner = createWorkOSSessionOwner({
    storage: createWorkOSSessionStorage(secureStore.adapter, "environment-a"),
    actions: actions({
      async signOutSession() {
        attempts += 1;
        if (attempts === 1) throw new Error("response interrupted after provider revocation");
        return { revoked: true };
      },
    }),
  });
  await owner.restore();
  await owner.signIn({ email: "person@example.com", password: "secret" });

  await assert.rejects(owner.signOut(), /response interrupted/);
  assert.equal(secureStore.value, encoded("signed-in"));
  assert.equal(owner.getSnapshot().isAuthenticated, true);

  await owner.signOut();
  assert.equal(attempts, 2);
  assert.equal(secureStore.value, null);
  assert.equal(owner.getSnapshot().isAuthenticated, false);
});

test("corrupt SecureStore data restores unauthenticated without contacting refresh", async () => {
  const secureStore = fakeSecureStore("{not-json");
  let refreshCalls = 0;
  const owner = createWorkOSSessionOwner({
    storage: createWorkOSSessionStorage(secureStore.adapter, "environment-a"),
    actions: actions({
      async refreshSession() {
        refreshCalls += 1;
        return { status: "success", ...credentials("unexpected") };
      },
    }),
  });

  await owner.restore();
  assert.equal(refreshCalls, 0);
  assert.equal(owner.getSnapshot().isLoading, false);
  assert.equal(owner.getSnapshot().isAuthenticated, false);
});

for (const record of [
  JSON.stringify({ version: 1, ...credentials("legacy") }),
  JSON.stringify({ version: 2, environmentId: "environment-b", ...credentials("other") }),
  "malformed",
]) {
  test(`incompatible storage never refreshes, including failed erasure: ${record}`, async () => {
    const secureStore = fakeSecureStore(record);
    const erase = secureStore.adapter.deleteItemAsync;
    let failErase = true;
    let refreshCalls = 0;
    secureStore.adapter.deleteItemAsync = async () => {
      if (failErase) throw new Error("erase failed");
      await erase();
    };
    const owner = createWorkOSSessionOwner({
      storage: createWorkOSSessionStorage(secureStore.adapter, "environment-a"),
      actions: actions({ async refreshSession() {
        refreshCalls += 1;
        return { status: "success", ...credentials("unexpected") };
      } }),
    });
    await assert.rejects(owner.restore(), /erase failed/);
    assert.equal(secureStore.value, record);
    assert.equal(owner.getSnapshot().isAuthenticated, false);
    assert.deepEqual(owner.getSnapshot().retry, { operation: "restore" });
    assert.equal(await owner.fetchAccessToken({ forceRefreshToken: true }), null);
    await assert.rejects(owner.retryRestore(), /erase failed/);
    assert.equal(refreshCalls, 0);
    failErase = false;
    await owner.retryRestore();
    assert.equal(secureStore.value, null);
    assert.equal(owner.getSnapshot().isAuthenticated, false);
    assert.equal(owner.getSnapshot().retry, null);
    assert.equal(refreshCalls, 0);
  });
}

test("unknown environment leaves credentials untouched and never contacts refresh", async () => {
  const secureStore = fakeSecureStore(encoded("stored"));
  let refreshCalls = 0;
  const owner = createWorkOSSessionOwner({
    storage: createWorkOSSessionStorage(secureStore.adapter, undefined as unknown as string),
    actions: actions({ async refreshSession() {
      refreshCalls += 1;
      return { status: "success", ...credentials("unexpected") };
    } }),
  });
  await assert.rejects(owner.restore(), /environment/i);
  await assert.rejects(owner.retryRestore(), /environment/i);
  assert.equal(await owner.fetchAccessToken({ forceRefreshToken: true }), null);
  assert.equal(refreshCalls, 0);
  assert.equal(secureStore.value, encoded("stored"));
  assert.equal(owner.getSnapshot().isAuthenticated, false);
  assert.deepEqual(owner.getSnapshot().retry, { operation: "restore" });
});


test("new paired owner restores same identity across destinations but erases a different identity", async () => {
  const first = { environmentId: "stack:provider-a", backendUrl: "http://localhost:3210" };
  for (const next of [
    { ...first, environmentId: "stack:provider-b" },
    { ...first, backendUrl: "http://localhost:3211" },
    { ...first, backendUrl: "https://recovery.example.ts.net" },
  ]) {
    const secureStore = fakeSecureStore(null);
    const previous = createWorkOSSessionOwner({
      storage: createWorkOSSessionStorage(secureStore.adapter, first.environmentId),
      actions: actions(),
    });
    await previous.signIn({ email: "person@example.com", password: "test" });
    let refreshCalls = 0;
    const owner = createWorkOSSessionOwner({
      storage: createWorkOSSessionStorage(secureStore.adapter, next.environmentId),
      actions: actions({ async refreshSession({ refreshToken }) {
        assert.equal(refreshToken, "refresh-signed-in");
        refreshCalls++;
        return { status: "success", ...credentials("restored") };
      } }),
    });
    assert.equal(owner.getSnapshot().isAuthenticated, false);
    await owner.restore();
    const sameIdentity = next.environmentId === first.environmentId;
    assert.equal(await owner.fetchAccessToken({ forceRefreshToken: false }), sameIdentity ? "access-restored" : null);
    assert.equal(refreshCalls, sameIdentity ? 1 : 0);
    if (!sameIdentity) assert.equal(secureStore.value, null);
  }
});

for (const operation of ["signIn", "completeSignup", "refresh", "invalid", "signOut"] as const) {
  test(`retired owner's deferred ${operation} cannot replace new credentials`, async () => {
    const gate = deferred<any>();
    const store = fakeSecureStore(null);
    const old = createWorkOSSessionOwner({
      storage: createWorkOSSessionStorage(store.adapter, "environment-a"),
      actions: actions({
        ...(operation === "signIn" ? { signIn: () => gate.promise } : {}),
        ...(operation === "completeSignup" ? { completeSignup: () => gate.promise } : {}),
        ...(["refresh", "invalid"].includes(operation) ? { refreshSession: () => gate.promise } : {}),
        ...(operation === "signOut" ? { signOutSession: () => gate.promise } : {}),
      }),
    });
    if (!["signIn", "completeSignup"].includes(operation)) await old.signIn({ email: "old", password: "test" });
    const pending = operation === "signIn" ? old.signIn({ email: "old", password: "test" })
      : operation === "completeSignup" ? old.completeSignup({ intentId: "old", code: "test" })
      : operation === "signOut" ? old.signOut() : old.refresh();
    await tick();
    old.dispose();
    const replacement = createWorkOSSessionOwner({ storage: createWorkOSSessionStorage(store.adapter, "environment-a"), actions: actions() });
    await replacement.signIn({ email: "new", password: "test" });
    gate.resolve(operation === "invalid" ? { status: "invalid" } : { status: "success", revoked: true, ...credentials("old") });
    await pending;
    assert.equal(store.value, encoded("signed-in"));
  });
}

test("started storage writes settle before replacement writes", async () => {
  const gate = deferred<void>();
  const store = fakeSecureStore(null);
  const set = store.adapter.setItemAsync;
  let first = true;
  store.adapter.setItemAsync = async (key, value) => {
    if (first) { first = false; await gate.promise; }
    await set(key, value);
  };
  const old = createWorkOSSessionOwner({ storage: createWorkOSSessionStorage(store.adapter, "environment-a"), actions: actions() });
  const pending = old.completeSignup({ intentId: "old", code: "test" });
  await tick();
  old.dispose();
  const replacement = createWorkOSSessionOwner({ storage: createWorkOSSessionStorage(store.adapter, "environment-a"), actions: actions() });
  const next = replacement.signIn({ email: "new", password: "test" });
  await tick();
  assert.equal(store.value, null);
  gate.resolve();
  await Promise.all([pending, next]);
  assert.equal(store.value, encoded("signed-in"));
});

test("strict-effect cleanup and setup cannot revive old refresh work", async () => {
  const gate = deferred<{ status: "invalid" }>();
  const store = fakeSecureStore(encoded("stored"));
  let calls = 0;
  const owner = createWorkOSSessionOwner({
    storage: createWorkOSSessionStorage(store.adapter, "environment-a"),
    actions: actions({ refreshSession: async () => ++calls === 1 ? gate.promise : { status: "success", ...credentials("replayed") } }),
  });
  const firstSetup = owner.activate();
  await tick();
  owner.dispose();
  await owner.activate();
  gate.resolve({ status: "invalid" });
  await firstSetup;
  assert.equal(store.value, encoded("replayed"));
  assert.equal(await owner.fetchAccessToken({ forceRefreshToken: false }), "access-replayed");
});
