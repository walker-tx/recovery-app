const { test, beforeEach, afterEach } = require("node:test");
let ambient;
beforeEach(() => {
  ambient = { ...process.env };
  for (const key of Object.keys(process.env))
    if (key.startsWith("CONVEX_")) delete process.env[key];
});
afterEach(() => {
  process.env = ambient;
});
const assert = require("node:assert/strict");
const { buildStackConfiguration } = require("./stack-configuration.cjs");
const { bootstrapLocalConvex } = require("./stack-convex-bootstrap.cjs");
function fixture() {
  const registry = {
    worktree: process.cwd(),
    stackId: "11111111-1111-4111-8111-111111111111",
    providerGeneration: "22222222-2222-4222-8222-222222222222",
    ports: {
      convexCloud: 24000,
      convexSite: 24001,
      metro: 24002,
      provider: 24003,
      mailpitHttp: 24004,
      mailpitSmtp: 24005,
    },
  };
  const seed = {
    RECOVERY_STACK_ID: registry.stackId,
    RECOVERY_PROVIDER_GENERATION: registry.providerGeneration,
    LOCAL_WORKOS_API_KEY: "sk_test_local_" + "a".repeat(64),
    LOCAL_CONVEX_INSTANCE_NAME:
      "recovery_" + registry.stackId.replaceAll("-", ""),
    LOCAL_CONVEX_INSTANCE_SECRET: "a".repeat(64),
    LOCAL_CONVEX_ADMIN_KEY: "local-fixture-secret",
    WORKOS_EMAIL_HMAC_KEY: Buffer.alloc(32, 1).toString("base64"),
    WORKOS_INTENT_ENCRYPTION_KEY: Buffer.alloc(32, 2).toString("base64"),
  };
  const configuration = buildStackConfiguration({
    registry,
    bootstrap: {
      providerGeneration: registry.providerGeneration,
      clientId:
        "client_local" + registry.providerGeneration.replaceAll("-", ""),
      issuer: `https://local-workos.invalid/instances/${registry.providerGeneration}`,
      port: registry.ports.provider,
    },
    credentials: {
      stackId: registry.stackId,
      providerGeneration: registry.providerGeneration,
      apiKey: seed.LOCAL_WORKOS_API_KEY,
    },
  });
  const events = [];
  return {
    registry,
    seed,
    configuration,
    worktree: registry.worktree,
    events,
    fetchImpl: async (url, options) => {
      events.push({ url, options });
      return new Response(
        url.endsWith("/instance_name") ? seed.LOCAL_CONVEX_INSTANCE_NAME : "{}",
      );
    },
    exec: async (file, args, options) => {
      events.push({ file, args, options });
      return { code: 0 };
    },
  };
}
test("verifies before each effect, synchronizes only custom keys, deploys explicit local target", async () => {
  const f = fixture();
  f.configuration.backend.EXPO_PUBLIC_BAD = "not-synced";
  f.configuration.backend.CONVEX_DEPLOY_KEY = "not-synced";
  assert.deepEqual(await bootstrapLocalConvex(f), {
    environmentSynced: true,
    functionsPushed: true,
  });
  assert.equal(f.events.length, 4);
  assert.ok(f.events[0].url.endsWith("/instance_name"));
  const write = f.events[1];
  assert.equal(write.options.redirect, "error");
  assert.equal(
    write.options.headers.Authorization,
    "Convex " + f.seed.LOCAL_CONVEX_ADMIN_KEY,
  );
  const changes = JSON.parse(write.options.body).changes;
  assert.ok(
    changes.every(
      (x) =>
        !x.name.startsWith("CONVEX_") && !x.name.startsWith("EXPO_PUBLIC_"),
    ),
  );
  assert.equal(
    changes.find((x) => x.name === "WORKOS_EMAIL_HMAC_KEY").value,
    f.seed.WORKOS_EMAIL_HMAC_KEY,
  );
  assert.ok(f.events[2].url.endsWith("/instance_name"));
  const child = f.events[3];
  assert.deepEqual(child.args, [
    "--filter",
    "@recovery/backend",
    "exec",
    "convex",
    "deploy",
    "--url",
    "http://127.0.0.1:24000",
    "--admin-key",
    f.seed.LOCAL_CONVEX_ADMIN_KEY,
  ]);
  assert.equal(child.options.env.CONVEX_URL, "http://127.0.0.1:24000");
  assert.equal(child.options.env.NODE_OPTIONS, undefined);
  assert.equal(child.options.env.CONVEX_DEPLOY_KEY, undefined);
});
test("wrong instance, redirects, failure and oversized response never write", async () => {
  for (const response of [
    new Response("wrong"),
    new Response('"wrong"'),
    new Response("", { status: 302 }),
    new Response("secret", { status: 500 }),
    new Response("x".repeat(8193)),
  ]) {
    const f = fixture();
    let calls = 0;
    f.fetchImpl = async () => {
      calls++;
      return response;
    };
    await assert.rejects(
      bootstrapLocalConvex(f),
      /^Error: Local Convex bootstrap rejected$/,
    );
    assert.equal(calls, 1);
    assert.equal(f.events.length, 0);
  }
});
test("rechecks instance before push and sanitizes effect errors", async () => {
  const f = fixture();
  let calls = 0;
  f.fetchImpl = async () =>
    new Response(
      ++calls === 1
        ? f.seed.LOCAL_CONVEX_INSTANCE_NAME
        : calls === 2
          ? "{}"
          : "wrong",
    );
  await assert.rejects(
    bootstrapLocalConvex(f),
    /^Error: Local Convex bootstrap rejected$/,
  );
  assert.equal(calls, 3);
  assert.equal(f.events.length, 0);
  const g = fixture();
  g.exec = async () => {
    throw Error(g.seed.LOCAL_CONVEX_ADMIN_KEY);
  };
  await assert.rejects(
    bootstrapLocalConvex(g),
    /^Error: Local Convex bootstrap rejected$/,
  );
});
test("times out a stalled push with an ambiguity marker and abort signal", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  let started;
  let signal;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  f.exec = async (_file, _args, options) => {
    signal = options.signal;
    started();
    return new Promise(() => {});
  };
  const pending = bootstrapLocalConvex(f);
  const check = assert.rejects(
    pending,
    (error) =>
      error.message === "Local Convex bootstrap rejected" &&
      error.ambiguous === true,
  );
  await ready;
  t.mock.timers.tick(120000);
  await check;
  assert.equal(signal.aborted, true);
});
test("bounds even a fetch implementation that ignores abort", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  f.fetchImpl = async () => {
    started();
    return new Promise(() => {});
  };
  const pending = bootstrapLocalConvex(f);
  const check = assert.rejects(
    pending,
    (error) =>
      error.message === "Local Convex bootstrap rejected" &&
      error.ambiguous !== true,
  );
  await ready;
  t.mock.timers.tick(5000);
  await check;
  assert.equal(f.events.length, 0);
});
test("rejects mismatched runtime URLs and inherited selectors before effects", async () => {
  const f = fixture();
  f.configuration.backend.CONVEX_URL = "https://example.invalid";
  await assert.rejects(bootstrapLocalConvex(f));
  assert.equal(f.events.length, 0);
  const saved = process.env.CONVEX_DEPLOY_KEY;
  try {
    process.env.CONVEX_DEPLOY_KEY = "secret";
    const g = fixture();
    await assert.rejects(bootstrapLocalConvex(g));
    assert.equal(g.events.length, 0);
  } finally {
    if (saved === undefined) delete process.env.CONVEX_DEPLOY_KEY;
    else process.env.CONVEX_DEPLOY_KEY = saved;
  }
});
