import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getWorkOSAuthConfig,
  getWorkOSSessionScope,
} from "./workos-auth-config.ts";

const id =
  "11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222";
test("requires explicit stable identity and backend as one public config pair", () => {
  for (const missing of [
    undefined,
    "",
    "   ",
    "staging",
    "http://localhost:3210",
  ]) {
    assert.equal(getWorkOSAuthConfig(missing, "http://localhost:3210"), null);
  }
  for (const missing of [undefined, "", "   ", "invalid", "ftp://localhost"]) {
    assert.equal(getWorkOSAuthConfig(id, missing), null);
  }
  assert.deepEqual(getWorkOSAuthConfig(id, "http://localhost:3210"), {
    environmentId: id,
    backendUrl: "http://localhost:3210",
  });
});
test("rejects noncanonical identity and non-origin backend destinations", () => {
  const canonical = id.replaceAll("11111111", "abcdefab");
  assert.notEqual(
    getWorkOSAuthConfig(canonical, "http://localhost:3210"),
    null,
  );
  assert.equal(
    getWorkOSAuthConfig(canonical.toUpperCase(), "http://localhost:3210"),
    null,
  );
  assert.deepEqual(
    getWorkOSAuthConfig(id, "http://localhost:3210/"),
    getWorkOSAuthConfig(id, "http://localhost:3210"),
  );
  for (const suffix of ["/path", "?mode=local", "#fragment", "?", "#"]) {
    assert.equal(
      getWorkOSAuthConfig(id, `http://localhost:3210${suffix}`),
      null,
    );
  }
});
test("requires UUIDv4 version and variant for both identity parts", () => {
  for (const part of [0, 1]) {
    for (const invalid of [
      "12345678-1234-1234-8234-123456789abc",
      "12345678-1234-4234-7234-123456789abc",
    ]) {
      const parts = id.split(":");
      parts[part] = invalid;
      assert.equal(
        getWorkOSAuthConfig(parts.join(":"), "http://localhost:3210"),
        null,
      );
    }
  }
});
test("scope includes supplied identity and destination without guessing identity", () => {
  const config = getWorkOSAuthConfig(id, "http://localhost:3210")!;
  assert.equal(
    getWorkOSSessionScope({ ...config }),
    getWorkOSSessionScope(config),
  );
  assert.notEqual(
    getWorkOSSessionScope({
      ...config,
      environmentId: id.replace("2222", "3333"),
    }),
    getWorkOSSessionScope(config),
  );
  assert.notEqual(
    getWorkOSSessionScope({ ...config, backendUrl: "http://localhost:3211" }),
    getWorkOSSessionScope(config),
  );
});
// These source-spelling checks intentionally guard native wiring without loading Expo.
// Storage and owner behavior are exercised separately by storage/integration tests.
test("real provider persists only identity and replaces the session subtree on pair change", () => {
  const root = readFileSync(
    new URL("../workos-root-provider.tsx", import.meta.url),
    "utf8",
  );
  const provider = readFileSync(
    new URL("./workos-session-provider.tsx", import.meta.url),
    "utf8",
  );
  const layout = readFileSync(
    new URL("../../../app/_layout.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(root.includes("key={getWorkOSSessionScope(config)}"));
  assert.ok(root.includes("config={config}"));
  assert.ok(
    provider.includes(
      "createWorkOSSessionStorage(SecureStore, config.environmentId)",
    ),
  );
  assert.ok(provider.includes("[config.environmentId]"));
  assert.ok(provider.includes("[client, storage]"));
  assert.ok(layout.includes("process.env.EXPO_PUBLIC_AUTH_ENVIRONMENT_ID"));
  assert.ok(layout.includes("if (config === null)"));
});
