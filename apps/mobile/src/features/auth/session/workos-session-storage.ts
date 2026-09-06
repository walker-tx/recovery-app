export const WORKOS_SESSION_STORAGE_KEY = "recovery.workos.session";

export type SessionCredentials = {
  accessToken: string;
  refreshToken: string;
};

export type SecureStoreAdapter = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};

export type WorkOSSessionStorage = {
  read(): Promise<SessionCredentials | null>;
  write(session: SessionCredentials): Promise<void>;
  clear(): Promise<void>;
};

// Persist only the explicit environment identity, never the backend URL or pair.
// Port and Tailscale reachability changes must preserve credentials for the same identity.
// Missing configuration fails closed until startup configuration supplies that identity.
export function createWorkOSSessionStorage(
  store: SecureStoreAdapter,
  environmentId: string,
): WorkOSSessionStorage {
  const requireEnvironment = () => {
    if (typeof environmentId !== "string" || environmentId.trim().length === 0) {
      throw new Error("Authentication environment is not configured");
    }
    return environmentId;
  };
  return {
    async read() {
      const expectedEnvironment = requireEnvironment();
      const value = await store.getItemAsync(WORKOS_SESSION_STORAGE_KEY);
      if (value === null) return null;
      let record: unknown;
      try {
        record = JSON.parse(value);
      } catch {
        record = null;
      }
      if (isSessionRecord(record) && record.environmentId === expectedEnvironment) {
        return { accessToken: record.accessToken, refreshToken: record.refreshToken };
      }
      // Await deletion outside the parse catch: failure must reach restoration's retry state.
      await store.deleteItemAsync(WORKOS_SESSION_STORAGE_KEY);
      return null;
    },
    async write(session) {
      const expectedEnvironment = requireEnvironment();
      await store.setItemAsync(
        WORKOS_SESSION_STORAGE_KEY,
        JSON.stringify({
          version: 2,
          environmentId: expectedEnvironment,
          accessToken: session.accessToken,
          refreshToken: session.refreshToken,
        }),
      );
    },
    async clear() {
      await store.deleteItemAsync(WORKOS_SESSION_STORAGE_KEY);
    },
  };
}

function isSessionRecord(value: unknown): value is SessionCredentials & { version: 2; environmentId: string } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.version === 2
    && typeof record.environmentId === "string"
    && record.environmentId.trim().length > 0
    && typeof record.accessToken === "string"
    && record.accessToken.length > 0
    && typeof record.refreshToken === "string"
    && record.refreshToken.length > 0;
}
