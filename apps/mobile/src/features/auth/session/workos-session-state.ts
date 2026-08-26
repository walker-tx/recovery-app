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
  getSnapshot(): WorkOSSessionSnapshot;
  subscribe(listener: () => void): () => void;
  restore(): Promise<void>;
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
  | { type: "restored"; authenticated: boolean }
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
    case "restored":
      return settled(event.authenticated);
    case "restoreFailed":
      return { ...settled(false), retry: { operation: "restore" } };
    case "sessionEstablished":
      return settled(true);
    case "refreshStarted":
      return { ...settled(true), isRefreshing: true };
    case "refreshFailed":
      return { ...settled(true), retry: { operation: "refresh" } };
    case "sessionInvalidated":
    case "revoked":
      return settled(false);
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
    for (const listener of listeners) listener();
  };

  const transition = (event: WorkOSSessionEvent) => {
    publish(workOSSessionReducer(snapshot, event));
  };

  const establish = async (credentials: SessionCredentials) => {
    await storage.write(credentials);
    session = credentials;
    transition({ type: "sessionEstablished" });
  };

  const restore = async () => {
    try {
      session = await storage.read();
      transition({ type: "restored", authenticated: session !== null });
    } catch (error) {
      transition({ type: "restoreFailed" });
      throw error;
    }
  };

  const signIn = async (input: { email: string; password: string }) => {
    await establish(await actions.signIn(input));
  };

  const completeSignup = async (input: { intentId: string; code: string }) => {
    await establish(await actions.completeSignup(input));
  };

  const refresh = (): Promise<string | null> => {
    if (refreshPromise !== null) return refreshPromise;
    if (session === null) return Promise.resolve(null);

    const operation = (async () => {
      transition({ type: "refreshStarted" });
      try {
        const result = await actions.refreshSession({ refreshToken: session!.refreshToken });
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
        transition({ type: "refreshFailed" });
        throw error;
      } finally {
        refreshPromise = null;
      }
    })();
    refreshPromise = operation;
    return operation;
  };

  const signOut = async () => {
    if (session === null) return;
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

  const fetchAccessToken = ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
    if (forceRefreshToken) return refresh();
    return Promise.resolve(session?.accessToken ?? null);
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    restore,
    signIn,
    completeSignup,
    refresh,
    signOut,
    fetchAccessToken,
  };
}
