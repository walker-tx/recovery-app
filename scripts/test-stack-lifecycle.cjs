const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createRegistry } = require("./stack-registry.cjs");
const {
  createLifecycle,
  localConfiguration,
} = require("./stack-lifecycle.cjs");
async function fixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "recovery-lifecycle-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const worktree = path.join(root, "a"),
    sibling = path.join(root, "b");
  await Promise.all([fs.mkdir(worktree), fs.mkdir(sibling)]);
  const processes = new Map(),
    ids = new Map(),
    busy = new Map(),
    calls = [];
  let pid = 100;
  const registry = createRegistry({
    registryPath: path.join(root, "registry"),
    portAvailable: async (port) => ![...busy.values()].flat().includes(port),
    inspectProcess: async (id) => processes.get(id) ?? null,
  });
  const identify = async (id) => processes.get(ids.get(id)) ?? null;
  const run = async (command, args, options) => {
    calls.push({ command, args, options });
    if (args[0] === "run") {
      const identity = {
        pid: ++pid,
        startedAt: "start-" + pid,
        stackId: options.env.RECOVERY_STACK_ID,
        worktree: options.cwd,
      };
      processes.set(identity.pid, identity);
      ids.set(args[1], identity.pid);
      const record = await registry.reserve(options.cwd);
      const name = args[1].split("-").at(-1);
      const endpoints =
        name === "mailpitHttp"
          ? ["mailpitHttp", "mailpitSmtp"]
          : name === "convexCloud"
            ? ["convexCloud", "convexSite"]
            : [name];
      busy.set(
        identity.pid,
        endpoints.map((n) => record.ports[n]),
      );
    } else if (args[0] === "stop") {
      const identity = await identify(args[1]);
      if (identity) {
        processes.delete(identity.pid);
        busy.delete(identity.pid);
      }
    }
  };
  const lifecycle = createLifecycle({
    registry,
    run,
    identify,
    ready: async () => true,
    readBootstrap: async (record) => ({
      providerGeneration: record.providerGeneration,
    }),
    timeoutMs: 100,
    ...overrides,
  });
  const services = (record) => [
    {
      name: "provider",
      command: ["fake-provider", "--port", String(record.ports.provider)],
      readiness: { http: `http://127.0.0.1:${record.ports.provider}/health` },
    },
  ];
  return { registry, lifecycle, worktree, sibling, services, calls, processes };
}
test("parallel stacks start independently; healthy resume runs no command; stop preserves sibling and reservation", async (t) => {
  const f = await fixture(t);
  const [a, b] = await Promise.all([
    f.lifecycle.start(f.worktree, f.services),
    f.lifecycle.start(f.sibling, f.services),
  ]);
  assert.notEqual(a.stackId, b.stackId);
  await f.lifecycle.start(f.worktree, f.services);
  assert.equal(f.calls.length, 2);
  await f.lifecycle.stop(f.worktree, a.stackId);
  assert.equal(
    (await f.registry.status(f.sibling)).services.provider,
    "running",
  );
  assert.equal((await f.registry.reserve(f.worktree)).stackId, a.stackId);
  assert.ok(
    f.calls.every(
      (c) => !c.args.some((a) => ["--force", "--bump", "--all"].includes(a)),
    ),
  );
});
test("config pairs public destination with registry identity; bootstrap mismatches rejected", async (t) => {
  const f = await fixture(t);
  const record = await f.registry.reserve(f.worktree);
  const config = localConfiguration(record, {
    providerGeneration: record.providerGeneration,
  });
  assert.equal(
    config.EXPO_PUBLIC_CONVEX_URL,
    `http://127.0.0.1:${record.ports.convexCloud}`,
  );
  assert.equal(
    config.EXPO_PUBLIC_AUTH_ENVIRONMENT_ID,
    `${record.stackId}:${record.providerGeneration}`,
  );
  assert.throws(
    () =>
      localConfiguration(record, { ...record, providerGeneration: "wrong" }),
    /mismatch/,
  );
});
test("preparation and per-service setup are locked and complete before the next service", async (t) => {
  const events = [];
  const f = await fixture(t, {
    prepare: async (record) => {
      await fs.access(
        path.join(record.worktree, ".recovery-stack-lifecycle.lock"),
      );
      events.push("prepare");
      return "prepared";
    },
    environment: async (service, _record, prepared) => {
      assert.equal(prepared, "prepared");
      events.push("env:" + service.name);
      return service.name === "provider"
        ? { LOCAL_WORKOS_API_KEY: "synthetic-fixture" }
        : {};
    },
    afterReady: async (service) => {
      events.push("ready:" + service.name);
    },
  });
  await f.lifecycle.start(f.worktree, (record) => [
    ...f.services(record),
    {
      name: "metro",
      command: ["fake-metro"],
      readiness: { http: `http://127.0.0.1:${record.ports.metro}/status` },
    },
  ]);
  assert.equal(
    events.join(","),
    "prepare,env:provider,ready:provider,env:metro,ready:metro",
  );
  assert.ok(
    f.calls[0].options.env.LOCAL_WORKOS_API_KEY === "synthetic-fixture",
  );
  assert.ok(!("LOCAL_WORKOS_API_KEY" in f.calls[1].options.env));
});
test("service environment cannot override identity or publish public config early", async (t) => {
  for (const extra of [
    { RECOVERY_STACK_ID: "wrong" },
    { EXPO_PUBLIC_CONVEX_URL: "http://127.0.0.1:9999" },
  ]) {
    const f = await fixture(t, { environment: async () => extra });
    await assert.rejects(
      f.lifecycle.start(f.worktree, f.services),
      /environment/i,
    );
    assert.equal(f.calls.length, 0);
  }
});
test("wrong stack and changed process identity stop nothing", async (t) => {
  const f = await fixture(t);
  const a = await f.lifecycle.start(f.worktree, f.services);
  await assert.rejects(f.lifecycle.stop(f.worktree, "wrong"), /ownership/);
  const [pid, identity] = [...f.processes.entries()][0];
  f.processes.set(pid, { ...identity, startedAt: "reused" });
  await assert.rejects(
    f.lifecycle.stop(f.worktree, a.stackId),
    /conflict|ownership/,
  );
  assert.equal(f.calls.length, 1);
});
test("hanging readiness retains owned process and locks lifecycle for manual reconciliation", async (t) => {
  const f = await fixture(t, { ready: async () => new Promise(() => {}) });
  await assert.rejects(f.lifecycle.start(f.worktree, f.services), /timed out/);
  const status = await f.registry.status(f.worktree);
  assert.equal(status.services.provider, "running");
  await assert.rejects(f.lifecycle.stop(f.worktree, status.stackId), /locked/);
});
test("same-worktree overlapping lifecycle operations fail closed", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.worktree, ".recovery-stack-lifecycle.lock"));
  await assert.rejects(f.lifecycle.start(f.worktree, f.services), /locked/);
  assert.equal(f.calls.length, 0);
});
test("invalid service definitions fail before any process starts", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.lifecycle.start(f.worktree, (r) => [
      ...f.services(r),
      { name: "unknown" },
    ]),
    /service/,
  );
  assert.equal(f.calls.length, 0);
});
test("Pitchfork ID pointing at a different process cannot be stopped", async (t) => {
  const f = await fixture(t);
  const record = await f.lifecycle.start(f.worktree, f.services);
  const lifecycle = createLifecycle({
    registry: f.registry,
    run: async () => assert.fail("must not stop"),
    identify: async () => ({ pid: 999 }),
    ready: async () => true,
  });
  await assert.rejects(
    lifecycle.stop(f.worktree, record.stackId),
    /ownership mismatch/,
  );
});

test("late mutation after timeout retains lifecycle lock even after settlement", async (t) => {
  let settle,
    mutated = false;
  const f = await fixture(t, {
    run: async () => {
      await new Promise((resolve) => {
        settle = resolve;
      });
      mutated = true;
    },
  });
  await assert.rejects(f.lifecycle.start(f.worktree, f.services), /timed out/);
  await assert.rejects(f.lifecycle.start(f.worktree, f.services), /locked/);
  settle();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(mutated, true);
  await assert.rejects(f.lifecycle.start(f.worktree, f.services), /locked/);
});
test("paired endpoints share one process and are both probed with occupied ports", async (t) => {
  const probes = [];
  const f = await fixture(t, {
    ready: async (service) => {
      probes.push(service.name);
      return true;
    },
  });
  const definitions = (record) =>
    ["mailpitHttp", "mailpitSmtp", "convexCloud", "convexSite"].map((name) => ({
      name,
      command: ["fake", String(record.ports[name])],
      readiness: { http: "http://local/health" },
    }));
  const status = await f.lifecycle.start(f.worktree, definitions);
  assert.equal(f.calls.length, 2);
  const record = await f.registry.reserve(f.worktree);
  assert.deepEqual(record.processes.mailpitHttp, record.processes.mailpitSmtp);
  assert.deepEqual(record.processes.convexCloud, record.processes.convexSite);
  assert.deepEqual(probes, [
    "mailpitHttp",
    "mailpitSmtp",
    "convexCloud",
    "convexSite",
  ]);
  await f.lifecycle.start(f.worktree, definitions);
  assert.equal(f.calls.length, 2);
  await f.lifecycle.stop(f.worktree, status.stackId);
  assert.equal(f.calls.length, 4);
});
test("independent bootstrap mismatch never starts Metro or publishes public env", async (t) => {
  const f = await fixture(t, {
    readBootstrap: async () => ({ providerGeneration: "wrong" }),
  });
  await assert.rejects(
    f.lifecycle.start(f.worktree, (record) => [
      ...f.services(record),
      {
        name: "metro",
        command: ["fake-metro"],
        readiness: { http: "http://local/health" },
      },
    ]),
    /bootstrap.*mismatch/i,
  );
  assert.equal(f.calls.length, 1);
  assert.ok(
    f.calls.every(
      (call) =>
        !Object.keys(call.options.env).some((key) =>
          key.startsWith("EXPO_PUBLIC_"),
        ),
    ),
  );
});

test("only Metro receives public config after independent generation validation", async (t) => {
  let reads = 0;
  const f = await fixture(t, {
    readBootstrap: async (record) => {
      reads++;
      return { providerGeneration: record.providerGeneration };
    },
  });
  await f.lifecycle.start(f.worktree, (record) => [
    ...f.services(record),
    {
      name: "metro",
      command: ["fake-metro"],
      readiness: { http: "http://local/health" },
    },
  ]);
  assert.equal(reads, 1);
  assert.equal(
    f.calls[0].options.env.EXPO_PUBLIC_AUTH_ENVIRONMENT_ID,
    undefined,
  );
  const record = await f.registry.reserve(f.worktree);
  assert.equal(
    f.calls[1].options.env.EXPO_PUBLIC_AUTH_ENVIRONMENT_ID,
    `${record.stackId}:${record.providerGeneration}`,
  );
});
