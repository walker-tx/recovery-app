import type { ConvexReactClient } from "convex/react";
import * as SecureStore from "expo-secure-store";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { createWorkOSSessionActions } from "./workos-session-actions.ts";
import {
  createWorkOSSessionOwner,
  type WorkOSSessionRetry,
} from "./workos-session-state.ts";
import {
  createWorkOSSessionStorage,
  type WorkOSSessionStorage,
} from "./workos-session-storage.ts";

const secureStoreSessionStorage = createWorkOSSessionStorage({
  getItemAsync: SecureStore.getItemAsync,
  setItemAsync: SecureStore.setItemAsync,
  deleteItemAsync: SecureStore.deleteItemAsync,
});

type WorkOSSessionContextValue = {
  isLoading: boolean;
  isAuthenticated: boolean;
  isRefreshing: boolean;
  isSigningOut: boolean;
  retry: WorkOSSessionRetry;
  retryRestore(): Promise<void>;
  signIn(input: { email: string; password: string }): Promise<void>;
  completeSignup(input: { intentId: string; code: string }): Promise<void>;
  refresh(): Promise<string | null>;
  signOut(): Promise<void>;
  fetchAccessToken(input: {
    forceRefreshToken: boolean;
  }): Promise<string | null>;
};

const WorkOSSessionContext = createContext<WorkOSSessionContextValue | null>(
  null,
);

export function WorkOSSessionProvider({
  children,
  client,
  storage = secureStoreSessionStorage,
}: {
  children?: ReactNode;
  client: ConvexReactClient;
  storage?: WorkOSSessionStorage;
}) {
  const owner = useMemo(
    () =>
      createWorkOSSessionOwner({
        storage,
        actions: createWorkOSSessionActions(client),
      }),
    [client, storage],
  );

  useEffect(() => {
    void owner.restore().catch(() => undefined);
  }, [owner]);

  const snapshot = useSyncExternalStore(
    owner.subscribe,
    owner.getSnapshot,
    owner.getSnapshot,
  );
  const { retryRestore, signIn, completeSignup, refresh, signOut } = owner;
  const fetchAccessToken = useCallback(
    ({ forceRefreshToken }: { forceRefreshToken: boolean }) =>
      owner.fetchAccessToken({ forceRefreshToken }),
    [owner],
  );
  const value = useMemo(
    () => ({
      ...snapshot,
      retryRestore,
      signIn,
      completeSignup,
      refresh,
      signOut,
      fetchAccessToken,
    }),
    [
      snapshot,
      retryRestore,
      signIn,
      completeSignup,
      refresh,
      signOut,
      fetchAccessToken,
    ],
  );

  return (
    <WorkOSSessionContext.Provider value={value}>
      {children}
    </WorkOSSessionContext.Provider>
  );
}

export function useWorkOSSession(): WorkOSSessionContextValue {
  const value = useContext(WorkOSSessionContext);
  if (value === null) {
    throw new Error(
      "useWorkOSSession must be used within WorkOSSessionProvider",
    );
  }
  return value;
}

export function useWorkOSConvexAuth() {
  const { isLoading, isAuthenticated, fetchAccessToken } = useWorkOSSession();
  return useMemo(
    () => ({ isLoading, isAuthenticated, fetchAccessToken }),
    [isLoading, isAuthenticated, fetchAccessToken],
  );
}
