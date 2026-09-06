const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildStackConfiguration } = require("./stack-configuration.cjs");
const stackId = "11111111-1111-4111-8111-111111111111";
const providerGeneration = "22222222-2222-4222-8222-222222222222";
const clientId = `client_local${providerGeneration.replaceAll("-", "")}`;
const issuer = `https://local-workos.invalid/instances/${providerGeneration}`;
const registry = {
  stackId,
  providerGeneration,
  ports: {
    convexCloud: 24000,
    convexSite: 24001,
    metro: 24002,
    provider: 24003,
    mailpitHttp: 24004,
    mailpitSmtp: 24005,
  },
};
const bootstrap = { providerGeneration, clientId, issuer, port: 24003 };
// Synthetic fixture only; never capture process.env or print credential objects.
const credentials = {
  stackId,
  providerGeneration,
  apiKey: "sk_test_local_" + "a".repeat(64),
};
const build = (extra = {}) =>
  buildStackConfiguration({ registry, bootstrap, credentials, ...extra });
const rejects = (input) =>
  assert.throws(
    () => build(input),
    /^Error: Local stack configuration rejected$/,
  );
test("constructs matching backend, provider and public mobile configuration", () => {
  const result = build();
  const expected = {
    WORKOS_MODE: "local",
    LOCAL_AUTH_STACK_ID: stackId,
    LOCAL_AUTH_PROVIDER_GENERATION: providerGeneration,
    WORKOS_CLIENT_ID: clientId,
    WORKOS_ISSUER: issuer,
    WORKOS_AUDIENCE: clientId,
    WORKOS_JWKS_URL: `http://127.0.0.1:24003/sso/jwks/${clientId}`,
    WORKOS_API_URL: "http://127.0.0.1:24003",
    CONVEX_URL: "http://127.0.0.1:24000",
    CONVEX_SITE_URL: "http://127.0.0.1:24001",
    AUTH_EMAIL_DELIVERY_URL: "http://127.0.0.1:24004/api/v1/send",
  };
  for (const [key, value] of Object.entries(expected))
    assert.ok(result.backend[key] === value, key);
  assert.ok(result.backend.WORKOS_API_KEY === credentials.apiKey);
  assert.ok(result.backend.LOCAL_WORKOS_API_KEY === credentials.apiKey);
  assert.ok(result.provider.LOCAL_WORKOS_API_KEY === credentials.apiKey);
  assert.ok(
    result.mobile.EXPO_PUBLIC_AUTH_ENVIRONMENT_ID ===
      `${stackId}:${providerGeneration}`,
  );
  assert.ok(result.mobile.EXPO_PUBLIC_CONVEX_URL === expected.CONVEX_URL);
  assert.ok(!JSON.stringify(result.mobile).includes(credentials.apiKey));
  assert.ok(!("CONVEX_DEPLOY_KEY" in result.owned));
});
test("independently verifies every bootstrap claim and exact allocated port", () => {
  for (const key of Object.keys(bootstrap))
    rejects({ bootstrap: { ...bootstrap, [key]: "wrong" } });
  rejects({ bootstrap: { ...bootstrap, issuer: `${issuer}/` } });
  rejects({ bootstrap: { ...bootstrap, port: 24004 } });
});
test("rejects malformed registry, aliased ports and mismatched launcher credentials", () => {
  rejects({ registry: { ...registry, stackId: "branch-name" } });
  rejects({
    registry: { ...registry, ports: { ...registry.ports, convexCloud: 24003 } },
  });
  rejects({
    registry: { ...registry, ports: { ...registry.ports, provider: 65536 } },
  });
  rejects({ credentials: { ...credentials, stackId: providerGeneration } });
  rejects({ credentials: { ...credentials, providerGeneration: stackId } });
  rejects({ credentials: { ...credentials, apiKey: "" } });
  rejects({
    credentials: { ...credentials, apiKey: "sk_test_real_provider_fixture" },
  });
});
test("rejects inherited deploy credentials, real targets and unowned credentials", () => {
  for (const inherited of [
    { CONVEX_DEPLOY_KEY: "synthetic-deploy-fixture" },
    { WORKOS_API_KEY: "unowned-fixture" },
    { CONVEX_URL: "https://example.invalid" },
    { WORKOS_CLIENT_ID: "client_real_fixture" },
  ])
    rejects({ inherited });
  rejects({ existing: { RECOVERY_STACK_ID: providerGeneration } });
  rejects({ existing: { WORKOS_API_KEY: credentials.apiKey } });
});
test("preserves unrelated keys without mutating inputs and accepts owned resume", () => {
  const existing = { ...build().owned, UNRELATED: "preserved" };
  const before = JSON.stringify(existing);
  const result = build({ existing, inherited: existing });
  assert.ok(result.environment.UNRELATED === "preserved");
  assert.ok(JSON.stringify(existing) === before);
  assert.ok(!("UNRELATED" in result.owned));
});
