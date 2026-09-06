import assert from "node:assert/strict";
import test from "node:test";

import {
  WORKOS_SESSION_STORAGE_KEY,
  createWorkOSSessionStorage,
} from "./workos-session-storage.ts";

function fakeSecureStore(initial: string | null = null) {
  let value = initial;
  const writes: Array<{ key: string; value: string }> = [];
  const deletes: string[] = [];
  return {
    store: {
      async getItemAsync(key: string) {
        assert.equal(key, WORKOS_SESSION_STORAGE_KEY);
        return value;
      },
      async setItemAsync(key: string, next: string) {
        value = next;
        writes.push({ key, value: next });
      },
      async deleteItemAsync(key: string) {
        value = null;
        deletes.push(key);
      },
    },
    get value() {
      return value;
    },
    writes,
    deletes,
  };
}

test("missing, malformed, unknown-version, and partial records restore as unauthenticated", async () => {
  const values = [
    null,
    "not json",
    JSON.stringify({
      version: 2,
      accessToken: "access",
      refreshToken: "refresh",
    }),
    JSON.stringify({ version: 1, accessToken: "access" }),
    JSON.stringify({ version: 1, accessToken: "", refreshToken: "refresh" }),
  ];
  for (const value of values) {
    const secureStore = fakeSecureStore(value);
    assert.equal(
      await createWorkOSSessionStorage(secureStore.store).read(),
      null,
    );
    assert.equal(secureStore.value, value);
  }
});

test("write stores one versioned JSON record and replace overwrites that record", async () => {
  const secureStore = fakeSecureStore();
  const storage = createWorkOSSessionStorage(secureStore.store);
  await storage.write({ accessToken: "access-1", refreshToken: "refresh-1" });
  await storage.write({ accessToken: "access-2", refreshToken: "refresh-2" });
  assert.equal(secureStore.writes.length, 2);
  assert.deepEqual(JSON.parse(secureStore.value!), {
    version: 1,
    accessToken: "access-2",
    refreshToken: "refresh-2",
  });
  assert.ok(
    secureStore.writes.every(({ key }) => key === WORKOS_SESSION_STORAGE_KEY),
  );
});

test("clear deletes the one namespaced record", async () => {
  const secureStore = fakeSecureStore(
    JSON.stringify({
      version: 1,
      accessToken: "access",
      refreshToken: "refresh",
    }),
  );
  await createWorkOSSessionStorage(secureStore.store).clear();
  assert.equal(secureStore.value, null);
  assert.deepEqual(secureStore.deletes, [WORKOS_SESSION_STORAGE_KEY]);
});
