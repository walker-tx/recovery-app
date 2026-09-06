import type { SessionCredentials, WorkOSSessionStorage } from "./workos-session-storage.ts";

export type { SessionCredentials } from "./workos-session-storage.ts";

export type WorkOSSessionRetry = { operation: "restore" | "refresh" | "signOut" } | null;

export type WorkOSSessionSnapshot = {
  isLoading: boolean;
  isAuthenticated: boolean;
  isRefreshing: boolean;
  isSigningOut: boolean;
  retry: WorkOSSessionRetry;
};

type RefreshResult =
  | { status: "success"; accessToken: string; refreshToken: string }
  | { status: "invalid" };

export type WorkOSSessionActions = {
  signIn(input: { email: string; password: string }): Promise<SessionCredentials>;
  completeSignup(input: { intentId: string; code: string }): Promise<SessionCredentials>;
  refreshSession(input: { refreshToken: string }): Promise<RefreshResult>;
  signOutSession(input: { refreshToken: string }): Promise<{ revoked: true }>;
};

export type WorkOSSessionOwner = {
  activate(): Promise<void>;
  dispose(): void;
  getSnapshot(): WorkOSSessionSnapshot;
  subscribe(listener: () => void): () => void;
  restore(): Promise<void>;
  retryRestore(): Promise<void>;
  signIn(input: { email: string; password: string }): Promise<void>;
  completeSignup(input: { intentId: string; code: string }): Promise<void>;
  refresh(): Promise<string | null>;
  signOut(): Promise<void>;
  fetchAccessToken(input: { forceRefreshToken: boolean }): Promise<string | null>;
};

const initialSnapshot: WorkOSSessionSnapshot = {
  isLoading: true,
  isAuthenticated: false,
  isRefreshing: false,
  isSigningOut: false,
  retry: null,
};

type WorkOSSessionEvent =
  | { type: "restoreStarted" }
  | { type: "restoredEmpty" }
  | { type: "restoreFailed" }
  | { type: "sessionEstablished" }
  | { type: "refreshStarted" }
  | { type: "refreshFailed" }
  | { type: "sessionInvalidated" }
  | { type: "signOutStarted" }
  | { type: "signOutFailed" }
  | { type: "revoked" };

export function workOSSessionReducer(
  state: WorkOSSessionSnapshot,
  event: WorkOSSessionEvent,
): WorkOSSessionSnapshot {
  const settled = (isAuthenticated: boolean): WorkOSSessionSnapshot => ({
    isLoading: false,
    isAuthenticated,
    isRefreshing: false,
    isSigningOut: false,
    retry: null,
  });
  switch (event.type) {
    case "restoreStarted":
      return initialSnapshot;
    case "restoredEmpty":
    case "sessionInvalidated":
    case "revoked":
      return settled(false);
    case "restoreFailed":
      return { ...initialSnapshot, retry: { operation: "restore" } };
    case "sessionEstablished":
      return settled(true);
    case "refreshStarted":
      return { ...settled(true), isRefreshing: true };
    case "refreshFailed":
      return { ...settled(true), retry: { operation: "refresh" } };
    case "signOutStarted":
      return { ...settled(true), isSigningOut: true };
    case "signOutFailed":
      return { ...settled(true), retry: { operation: "signOut" } };
    default:
      return state;
  }
}

// All owners share one SecureStore slot. Include reads: validation may delete it.
let storageTail: Promise<unknown> = Promise.resolve();

export function createWorkOSSessionOwner(dependencies: {
  storage: WorkOSSessionStorage;
  actions: WorkOSSessionActions;
}): WorkOSSessionOwner {
  const { storage, actions } = dependencies;
  let lifetime = 0;
  let active = true;
  const current = (id: number) => active && id === lifetime;
  const accessStorage = <T>(id: number, operation: () => Promise<T>): Promise<T | undefined> => {
    const result = storageTail.then(() => current(id) ? operation() : undefined);
    storageTail = result.catch(() => undefined);
    return result;
  };
  let session: SessionCredentials | null = null;
  let snapshot = initialSnapshot;
  let refreshPromise: Promise<string | null> | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: WorkOSSessionSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const transition = (event: WorkOSSessionEvent) => {
    publish(workOSSessionReducer(snapshot, event));
  };

  const establish = async (credentials: SessionCredentials, id: number) => {
    await accessStorage(id, () => storage.write(credentials));
    if (!current(id)) return;
    session = credentials;
    transition({ type: "sessionEstablished" });
  };

  const runRefresh = (mode: "restore" | "authenticated"): Promise<string | null> => {
    const id = lifetime;
    if (!current(id)) return Promise.resolve(null);
    if (refreshPromise !== null) return refreshPromise;
    if (session === null || snapshot.isSigningOut) return Promise.resolve(null);

    const refreshToken = session.refreshToken;
    const operation = (async () => {
      transition({ type: mode === "restore" ? "restoreStarted" : "refreshStarted" });
      try {
        const result = await actions.refreshSession({ refreshToken });
        if (!current(id)) return null;
        if (result.status === "invalid") {
          await accessStorage(id, () => storage.clear());
          if (!current(id)) return null;
          session = null;
          transition({ type: "sessionInvalidated" });
          return null;
        }
        const credentials = {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
        };
        await accessStorage(id, () => storage.write(credentials));
        if (!current(id)) return null;
        session = credentials;
        transition({ type: "sessionEstablished" });
        return credentials.accessToken;
      } catch (error) {
        if (!current(id)) return null;
        transition({ type: mode === "restore" ? "restoreFailed" : "refreshFailed" });
        throw error;
      } finally {
        if (current(id)) refreshPromise = null;
      }
    })();
    refreshPromise = operation;
    return operation;
  };

  const restore = async () => {
    const id = lifetime;
    if (!current(id)) return;
    transition({ type: "restoreStarted" });
    try {
      const restored = await accessStorage(id, () => storage.read());
      if (!current(id)) return;
      session = restored ?? null;
      if (session === null) {
        transition({ type: "restoredEmpty" });
        return;
      }
      await runRefresh("restore");
    } catch (error) {
      if (!current(id)) return;
      if (snapshot.retry?.operation !== "restore") transition({ type: "restoreFailed" });
      throw error;
    }
  };

  const retryRestore = async () => {
    if (session === null) {
      await restore();
      return;
    }
    await runRefresh("restore");
  };

  const signIn = async (input: { email: string; password: string }) => {
    const id = lifetime;
    if (!current(id)) return;
    await establish(await actions.signIn(input), id);
  };
  const completeSignup = async (input: { intentId: string; code: string }) => {
    const id = lifetime;
    if (!current(id)) return;
    await establish(await actions.completeSignup(input), id);
  };
  const refresh = () => runRefresh(snapshot.isLoading ? "restore" : "authenticated");

  const signOut = async () => {
    const id = lifetime;
    if (!current(id)) return;
    if (refreshPromise !== null) {
      try {
        await refreshPromise;
      } catch {
        // Revoke the last persisted token even when refresh failed.
      }
    }
    if (!current(id) || session === null) return;
    transition({ type: "signOutStarted" });
    try {
      await actions.signOutSession({ refreshToken: session.refreshToken });
      await accessStorage(id, () => storage.clear());
      if (!current(id)) return;
      session = null;
      transition({ type: "revoked" });
    } catch (error) {
      if (!current(id)) return;
      transition({ type: "signOutFailed" });
      throw error;
    }
  };

  const fetchAccessToken = ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
    if (!active) return Promise.resolve(null);
    if (forceRefreshToken) return refresh();
    return Promise.resolve(snapshot.isAuthenticated ? session?.accessToken ?? null : null);
  };

  return {
    activate() {
      lifetime += 1;
      active = true;
      session = null;
      refreshPromise = null;
      return restore();
    },
    dispose() {
      active = false;
      lifetime += 1;
      session = null;
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    restore,
    retryRestore,
    signIn,
    completeSignup,
    refresh,
    signOut,
    fetchAccessToken,
  };
}
