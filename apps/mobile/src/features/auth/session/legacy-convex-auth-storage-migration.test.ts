import assert from "node:assert/strict";
import test from "node:test";

import { migrateLegacyConvexAuthStorage } from "./legacy-convex-auth-storage-migration.ts";

const convexUrl = "http://127.0.0.1:3210";
const namespace = "http1270013210";
const expectedKeys = [
  `__convexAuthJWT_${namespace}`,
  `__convexAuthOAuthVerifier_${namespace}`,
  `__convexAuthRefreshToken_${namespace}`,
  `__convexAuthServerStateFetchTime_${namespace}`,
];

test("deletes the exact namespaced legacy Convex Auth keys without reading them", async () => {
  const deleted: string[] = [];
  let reads = 0;
  const store = {
    async getItemAsync() {
      reads += 1;
      return "secret-that-must-not-be-read";
    },
    async deleteItemAsync(key: string) {
      deleted.push(key);
    },
  };

  await migrateLegacyConvexAuthStorage(store, convexUrl);

  assert.equal(reads, 0);
  assert.deepEqual(deleted.sort(), expectedKeys.sort());
});

test("is idempotent for empty and already-migrated stores", async () => {
  const deleted: string[] = [];
  const store = {
    async getItemAsync() {
      throw new Error("must not read legacy values");
    },
    async deleteItemAsync(key: string) {
      deleted.push(key);
    },
  };

  await migrateLegacyConvexAuthStorage(store, convexUrl);
  await migrateLegacyConvexAuthStorage(store, convexUrl);

  assert.deepEqual(deleted.slice(0, 4).sort(), expectedKeys.sort());
  assert.deepEqual(deleted.slice(4).sort(), expectedKeys.sort());
});
