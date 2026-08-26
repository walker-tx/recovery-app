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

export function createWorkOSSessionStorage(store: SecureStoreAdapter): WorkOSSessionStorage {
  return {
    async read() {
      const value = await store.getItemAsync(WORKOS_SESSION_STORAGE_KEY);
      if (value === null) return null;
      try {
        const record: unknown = JSON.parse(value);
        if (!isSessionRecord(record)) return null;
        return { accessToken: record.accessToken, refreshToken: record.refreshToken };
      } catch {
        return null;
      }
    },
    async write(session) {
      await store.setItemAsync(
        WORKOS_SESSION_STORAGE_KEY,
        JSON.stringify({ version: 1, ...session }),
      );
    },
    async clear() {
      await store.deleteItemAsync(WORKOS_SESSION_STORAGE_KEY);
    },
  };
}

function isSessionRecord(value: unknown): value is SessionCredentials & { version: 1 } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.version === 1
    && typeof record.accessToken === "string"
    && record.accessToken.length > 0
    && typeof record.refreshToken === "string"
    && record.refreshToken.length > 0;
}
