import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkOSSessionOwner,
  type SessionCredentials,
  type WorkOSSessionActions,
} from "./workos-session-state.ts";

const session = (suffix: string): SessionCredentials => ({
  accessToken: `access-${suffix}`,
  refreshToken: `refresh-${suffix}`,
});
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

function actions(
  overrides: Partial<WorkOSSessionActions> = {},
): WorkOSSessionActions {
  return {
    async signIn() {
      return session("signed-in");
    },
    async completeSignup() {
      return session("signup");
    },
    async refreshSession() {
      return { status: "success", ...session("refreshed") };
    },
    async signOutSession() {
      return { revoked: true };
    },
    ...overrides,
  };
}

test("startup validates stored credentials and stays loading until replacement persistence", async () => {
  const refreshResult = deferred<{
    status: "success";
    accessToken: string;
    refreshToken: string;
  }>();
  const write = deferred<void>();
  const refreshTokens: string[] = [];
  let persisted: SessionCredentials | null = session("stored");
  const owner = createWorkOSSessionOwner({
    storage: {
      async read() {
        return persisted;
      },
      async write(next) {
        persisted = next;
        await write.promise;
      },
      async clear() {
        persisted = null;
      },
    },
    actions: actions({
      async refreshSession({ refreshToken }) {
        refreshTokens.push(refreshToken);
        return refreshResult.promise;
      },
    }),
  });

  const restoring = owner.restore();
  await tick();
  assert.deepEqual(refreshTokens, ["refresh-stored"]);
  assert.deepEqual(owner.getSnapshot(), {
    isLoading: true,
    isAuthenticated: false,
    isRefreshing: false,
    isSigningOut: false,
    retry: null,
  });
  refreshResult.resolve({ status: "success", ...session("startup-fresh") });
  await tick();
  assert.equal(owner.getSnapshot().isAuthenticated, false);
  assert.equal(owner.getSnapshot().isLoading, true);
  write.resolve();
  await restoring;
  assert.deepEqual(persisted, session("startup-fresh"));
  assert.equal(owner.getSnapshot().isAuthenticated, true);
});

test("transient startup refresh retains credentials without auth flash and can retry", async () => {
  let attempts = 0;
  let persisted: SessionCredentials | null = session("stored");
  const owner = createWorkOSSessionOwner({
    storage: {
      async read() {
        return persisted;
      },
      async write(next) {
        persisted = next;
      },
      async clear() {
        persisted = null;
      },
    },
    actions: actions({
      async refreshSession() {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("offline");
        }
        return { status: "success", ...session("retried") };
      },
    }),
  });
  const published: ReturnType<typeof owner.getSnapshot>[] = [];
  owner.subscribe(() => published.push(owner.getSnapshot()));

  await assert.rejects(owner.restore(), /offline/);
  assert.deepEqual(persisted, session("stored"));
  assert.deepEqual(owner.getSnapshot(), {
    isLoading: true,
    isAuthenticated: false,
    isRefreshing: false,
    isSigningOut: false,
    retry: { operation: "restore" },
  });
  assert.equal(
    published.some((value) => value.isAuthenticated || !value.isLoading),
    false,
  );
  await owner.retryRestore();
  assert.equal(attempts, 2);
  assert.deepEqual(persisted, session("retried"));
  assert.equal(owner.getSnapshot().isAuthenticated, true);
});

test("startup invalidation stays loading until SecureStore clear completes", async () => {
  const clear = deferred<void>();
  let clearStarted = false;
  let persisted: SessionCredentials | null = session("stored");
  const owner = createWorkOSSessionOwner({
    storage: {
      async read() {
        return persisted;
      },
      async write(next) {
        persisted = next;
      },
      async clear() {
        clearStarted = true;
        await clear.promise;
        persisted = null;
      },
    },
    actions: actions({
      async refreshSession() {
        return { status: "invalid" };
      },
    }),
  });
  const restoring = owner.restore();
  await tick();
  assert.equal(clearStarted, true);
  assert.equal(owner.getSnapshot().isLoading, true);
  assert.equal(owner.getSnapshot().isAuthenticated, false);
  clear.resolve();
  await restoring;
  assert.equal(persisted, null);
  assert.equal(owner.getSnapshot().isLoading, false);
  assert.equal(owner.getSnapshot().isAuthenticated, false);
});

test("sign-in and refresh never publish new credentials before writes resolve", async () => {
  const writes = [deferred<void>(), deferred<void>()];
  let writeIndex = 0;
  const owner = createWorkOSSessionOwner({
    storage: {
      async read() {
        return null;
      },
      async write() {
        const write = writes[writeIndex]!;
        writeIndex += 1;
        await write.promise;
      },
      async clear() {},
    },
    actions: actions(),
  });
  const published: ReturnType<typeof owner.getSnapshot>[] = [];
  owner.subscribe(() => published.push(owner.getSnapshot()));
  await owner.restore();
  const signingIn = owner.signIn({
    email: "person@example.com",
    password: "secret",
  });
  await tick();
  assert.equal(owner.getSnapshot().isAuthenticated, false);
  assert.equal(
    await owner.fetchAccessToken({ forceRefreshToken: false }),
    null,
  );
  assert.equal(
    published.some((value) => value.isAuthenticated),
    false,
  );
  writes[0]!.resolve();
  await signingIn;
  assert.equal(owner.getSnapshot().isAuthenticated, true);

  const refreshing = owner.refresh();
  await tick();
  assert.equal(owner.getSnapshot().isRefreshing, true);
  assert.equal(
    await owner.fetchAccessToken({ forceRefreshToken: false }),
    "access-signed-in",
  );
  writes[1]!.resolve();
  assert.equal(await refreshing, "access-refreshed");
  assert.equal(
    await owner.fetchAccessToken({ forceRefreshToken: false }),
    "access-refreshed",
  );
  assert.equal(owner.getSnapshot().isRefreshing, false);
});

test("terminal refresh invalidation is not published before clear resolves", async () => {
  const clear = deferred<void>();
  let clearCalls = 0;
  const owner = createWorkOSSessionOwner({
    storage: {
      async read() {
        return null;
      },
      async write() {},
      async clear() {
        clearCalls += 1;
        await clear.promise;
      },
    },
    actions: actions({
      async refreshSession() {
        return { status: "invalid" };
      },
    }),
  });
  await owner.restore();
  await owner.signIn({ email: "person@example.com", password: "secret" });
  const published: ReturnType<typeof owner.getSnapshot>[] = [];
  owner.subscribe(() => published.push(owner.getSnapshot()));

  const refreshing = owner.refresh();
  await tick();
  assert.equal(clearCalls, 1);
  assert.equal(owner.getSnapshot().isAuthenticated, true);
  assert.equal(
    published.some((value) => !value.isAuthenticated),
    false,
  );
  clear.resolve();
  assert.equal(await refreshing, null);
  assert.equal(owner.getSnapshot().isAuthenticated, false);
});

test("non-forced fetch uses current token; forced callers share one refresh promise", async () => {
  const refresh = deferred<{
    status: "success";
    accessToken: string;
    refreshToken: string;
  }>();
  let refreshCalls = 0;
  const owner = createWorkOSSessionOwner({
    storage: {
      async read() {
        return null;
      },
      async write() {},
      async clear() {},
    },
    actions: actions({
      async refreshSession() {
        refreshCalls += 1;
        return refresh.promise;
      },
    }),
  });
  await owner.restore();
  await owner.signIn({ email: "person@example.com", password: "secret" });
  assert.equal(
    await owner.fetchAccessToken({ forceRefreshToken: false }),
    "access-signed-in",
  );
  assert.equal(refreshCalls, 0);
  const first = owner.fetchAccessToken({ forceRefreshToken: true });
  const second = owner.fetchAccessToken({ forceRefreshToken: true });
  assert.equal(first, second);
  assert.equal(refreshCalls, 1);
  refresh.resolve({ status: "success", ...session("forced") });
  assert.equal(await first, "access-forced");
});

test("owner callback identities remain stable across state transitions", async () => {
  const owner = createWorkOSSessionOwner({
    storage: {
      async read() {
        return null;
      },
      async write() {},
      async clear() {},
    },
    actions: actions(),
  });
  const callbacks = [
    owner.signIn,
    owner.completeSignup,
    owner.refresh,
    owner.signOut,
    owner.fetchAccessToken,
    owner.retryRestore,
  ];
  await owner.restore();
  await owner.signIn({ email: "person@example.com", password: "secret" });
  assert.deepEqual(
    [
      owner.signIn,
      owner.completeSignup,
      owner.refresh,
      owner.signOut,
      owner.fetchAccessToken,
      owner.retryRestore,
    ],
    callbacks,
  );
});

test("sign-out waits for an in-flight refresh and revokes the rotated session", async () => {
  const refreshResult = deferred<{
    status: "success";
    accessToken: string;
    refreshToken: string;
  }>();
  const revokedTokens: string[] = [];
  const owner = createWorkOSSessionOwner({
    storage: {
      async read() {
        return null;
      },
      async write() {},
      async clear() {},
    },
    actions: actions({
      async refreshSession() {
        return refreshResult.promise;
      },
      async signOutSession({ refreshToken }) {
        revokedTokens.push(refreshToken);
        return { revoked: true };
      },
    }),
  });
  await owner.restore();
  await owner.signIn({ email: "person@example.com", password: "secret" });

  const refreshing = owner.refresh();
  const signingOut = owner.signOut();
  await tick();
  assert.deepEqual(revokedTokens, []);
  refreshResult.resolve({ status: "success", ...session("rotated") });
  await refreshing;
  await signingOut;

  assert.deepEqual(revokedTokens, ["refresh-rotated"]);
  assert.equal(owner.getSnapshot().isAuthenticated, false);
});

test("refresh requested during sign-out cannot restore the session", async () => {
  const revocation = deferred<{ revoked: true }>();
  let refreshCalls = 0;
  const owner = createWorkOSSessionOwner({
    storage: {
      async read() {
        return null;
      },
      async write() {},
      async clear() {},
    },
    actions: actions({
      async refreshSession() {
        refreshCalls += 1;
        return { status: "success", ...session("refreshed") };
      },
      async signOutSession() {
        return revocation.promise;
      },
    }),
  });
  await owner.restore();
  await owner.signIn({ email: "person@example.com", password: "secret" });

  const signingOut = owner.signOut();
  assert.equal(await owner.refresh(), null);
  assert.equal(refreshCalls, 0);
  revocation.resolve({ revoked: true });
  await signingOut;
  assert.equal(owner.getSnapshot().isAuthenticated, false);
});

test("sign-out waits for revocation, then clear, before unauthenticated publication", async () => {
  const revocation = deferred<{ revoked: true }>();
  const clear = deferred<void>();
  let clearCalls = 0;
  const owner = createWorkOSSessionOwner({
    storage: {
      async read() {
        return null;
      },
      async write() {},
      async clear() {
        clearCalls += 1;
        await clear.promise;
      },
    },
    actions: actions({
      async signOutSession() {
        return revocation.promise;
      },
    }),
  });
  await owner.restore();
  await owner.signIn({ email: "person@example.com", password: "secret" });
  const published: ReturnType<typeof owner.getSnapshot>[] = [];
  owner.subscribe(() => published.push(owner.getSnapshot()));
  const signingOut = owner.signOut();
  await tick();
  assert.equal(clearCalls, 0);
  assert.equal(owner.getSnapshot().isAuthenticated, true);
  revocation.resolve({ revoked: true });
  await tick();
  assert.equal(clearCalls, 1);
  assert.equal(owner.getSnapshot().isAuthenticated, true);
  assert.equal(
    published.some((value) => !value.isAuthenticated),
    false,
  );
  clear.resolve();
  await signingOut;
  assert.equal(owner.getSnapshot().isAuthenticated, false);
});

test("failed sign-out retains the session for retry", async () => {
  let fail = true;
  const owner = createWorkOSSessionOwner({
    storage: {
      async read() {
        return null;
      },
      async write() {},
      async clear() {},
    },
    actions: actions({
      async signOutSession() {
        if (fail) {
          throw new Error("offline");
        }
        return { revoked: true };
      },
    }),
  });
  await owner.restore();
  await owner.signIn({ email: "person@example.com", password: "secret" });
  await assert.rejects(owner.signOut(), /offline/);
  assert.equal(owner.getSnapshot().isAuthenticated, true);
  assert.deepEqual(owner.getSnapshot().retry, { operation: "signOut" });
  fail = false;
  await owner.signOut();
  assert.equal(owner.getSnapshot().isAuthenticated, false);
});
