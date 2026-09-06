import type {
  SessionCredentials,
  WorkOSSessionStorage,
} from "./workos-session-storage.ts";

export type { SessionCredentials } from "./workos-session-storage.ts";

export type WorkOSSessionRetry = {
  operation: "restore" | "refresh" | "signOut";
} | null;

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
  signIn(input: {
    email: string;
    password: string;
  }): Promise<SessionCredentials>;
  completeSignup(input: {
    intentId: string;
    code: string;
  }): Promise<SessionCredentials>;
  refreshSession(input: { refreshToken: string }): Promise<RefreshResult>;
  signOutSession(input: { refreshToken: string }): Promise<{ revoked: true }>;
};

export type WorkOSSessionOwner = {
  getSnapshot(): WorkOSSessionSnapshot;
  subscribe(listener: () => void): () => void;
  restore(): Promise<void>;
  retryRestore(): Promise<void>;
  signIn(input: { email: string; password: string }): Promise<void>;
  completeSignup(input: { intentId: string; code: string }): Promise<void>;
  refresh(): Promise<string | null>;
  signOut(): Promise<void>;
  fetchAccessToken(input: {
    forceRefreshToken: boolean;
  }): Promise<string | null>;
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

export function createWorkOSSessionOwner(dependencies: {
  storage: WorkOSSessionStorage;
  actions: WorkOSSessionActions;
}): WorkOSSessionOwner {
  const { storage, actions } = dependencies;
  let session: SessionCredentials | null = null;
  let snapshot = initialSnapshot;
  let refreshPromise: Promise<string | null> | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: WorkOSSessionSnapshot) => {
    snapshot = next;
    for (const listener of listeners) {
      listener();
    }
  };
  const transition = (event: WorkOSSessionEvent) => {
    publish(workOSSessionReducer(snapshot, event));
  };

  const establish = async (credentials: SessionCredentials) => {
    await storage.write(credentials);
    session = credentials;
    transition({ type: "sessionEstablished" });
  };

  const runRefresh = (
    mode: "restore" | "authenticated",
  ): Promise<string | null> => {
    if (refreshPromise !== null) {
      return refreshPromise;
    }
    if (session === null || snapshot.isSigningOut) {
      return Promise.resolve(null);
    }

    const refreshToken = session.refreshToken;
    const operation = (async () => {
      transition({
        type: mode === "restore" ? "restoreStarted" : "refreshStarted",
      });
      try {
        const result = await actions.refreshSession({ refreshToken });
        if (result.status === "invalid") {
          await storage.clear();
          session = null;
          transition({ type: "sessionInvalidated" });
          return null;
        }
        const credentials = {
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
        };
        await storage.write(credentials);
        session = credentials;
        transition({ type: "sessionEstablished" });
        return credentials.accessToken;
      } catch (error) {
        transition({
          type: mode === "restore" ? "restoreFailed" : "refreshFailed",
        });
        throw error;
      } finally {
        refreshPromise = null;
      }
    })();
    refreshPromise = operation;
    return operation;
  };

  const restore = async () => {
    transition({ type: "restoreStarted" });
    try {
      session = await storage.read();
      if (session === null) {
        transition({ type: "restoredEmpty" });
        return;
      }
      await runRefresh("restore");
    } catch (error) {
      if (snapshot.retry?.operation !== "restore") {
        transition({ type: "restoreFailed" });
      }
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
    await establish(await actions.signIn(input));
  };
  const completeSignup = async (input: { intentId: string; code: string }) => {
    await establish(await actions.completeSignup(input));
  };
  const refresh = () =>
    runRefresh(snapshot.isLoading ? "restore" : "authenticated");

  const signOut = async () => {
    if (refreshPromise !== null) {
      try {
        await refreshPromise;
      } catch {
        // Revoke the last persisted token even when refresh failed.
      }
    }
    if (session === null) {
      return;
    }
    transition({ type: "signOutStarted" });
    try {
      await actions.signOutSession({ refreshToken: session.refreshToken });
      await storage.clear();
      session = null;
      transition({ type: "revoked" });
    } catch (error) {
      transition({ type: "signOutFailed" });
      throw error;
    }
  };

  const fetchAccessToken = ({
    forceRefreshToken,
  }: {
    forceRefreshToken: boolean;
  }) => {
    if (forceRefreshToken) {
      return refresh();
    }
    return Promise.resolve(
      snapshot.isAuthenticated ? (session?.accessToken ?? null) : null,
    );
  };

  return {
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
