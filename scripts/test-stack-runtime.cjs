const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createRuntime, runCli } = require("./stack-runtime.cjs");
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "stack-runtime-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const worktree = path.join(root, "worktree");
  await fs.mkdir(worktree);
  const calls = [];
  let closed = false;
  const runtime = await createRuntime({
    worktree,
    registryPath: path.join(root, "registry"),
    inspector: {
      inspect: async () => null,
      close: async () => {
        closed = true;
      },
    },
    identity: { identify: async () => null, inspectProcess: async () => null },
    run: async (...args) => {
      calls.push(args);
    },
    portAvailable: async () => true,
  });
  return { runtime, worktree, calls, closed: () => closed };
}
test("runtime reserves, checks explicit ownership and stops only selected stack", async (t) => {
  const f = await fixture(t);
  const a = await f.runtime.reserve();
  assert.equal((await f.runtime.status(a.stackId)).state, "reserved");
  await assert.rejects(
    f.runtime.status("00000000-0000-4000-8000-000000000000"),
    /ownership/,
  );
  await assert.rejects(f.runtime.stop("wrong"), /UUID/);
  assert.equal((await f.runtime.stop(a.stackId)).state, "reserved");
  assert.deepEqual(f.calls, []);
  await f.runtime.close();
  assert.equal(f.closed(), true);
});
test("start refuses before registry or service effects", async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.runtime.start(), /backend executable/);
  assert.deepEqual(await fs.readdir(f.worktree), []);
  assert.deepEqual(f.calls, []);
});
test("CLI rejects start and malformed requests before runtime construction", async () => {
  let opened = false;
  const open = async () => {
    opened = true;
    throw Error("secret argv");
  };
  for (const args of [
    ["start"],
    ["start", "relative"],
    ["start", "/bad\0path"],
    ["start", "/binary", "extra"],
    ["stop"],
    ["status", "--all"],
    ["reserve", "extra"],
  ]) {
    const output = [];
    assert.equal(await runCli(args, { open, write: (s) => output.push(s) }), 1);
    assert.equal(opened, false);
    assert.ok(!output.join("").includes("secret"));
  }
});
test("CLI uses explicit UUID, prints safe projection and always closes", async () => {
  const id = "00000000-0000-4000-8000-000000000000";
  let closed = false;
  const out = [];
  const code = await runCli(["status", id], {
    open: async () => ({
      status: async (value) => {
        assert.equal(value, id);
        return {
          stackId: id,
          state: "reserved",
          services: {},
          env: "SECRET",
          processes: { argv: "SECRET" },
        };
      },
      close: async () => {
        closed = true;
      },
    }),
    write: (s) => out.push(s),
  });
  assert.equal(code, 0);
  assert.equal(closed, true);
  assert.ok(!out.join("").includes("SECRET"));
});
test("composed stop verifies owned PID and sends only the exact stack daemon ID", async (t) => {
  const { createRegistry } = require("./stack-registry.cjs");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "stack-runtime-stop-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const worktree = path.join(root, "worktree");
  await fs.mkdir(worktree);
  const registryPath = path.join(root, "registry");
  let processIdentity = null;
  const inspectProcess = async () => processIdentity;
  const registry = createRegistry({
    registryPath,
    inspectProcess,
    portAvailable: async () => true,
  });
  const record = await registry.reserve(worktree);
  processIdentity = {
    pid: 12345,
    startedAt: "test-start",
    worktree: await fs.realpath(worktree),
    stackId: record.stackId,
  };
  await registry.recordProcess(
    worktree,
    record.stackId,
    ["provider"],
    processIdentity,
  );
  const calls = [];
  const runtime = await createRuntime({
    worktree,
    registryPath,
    portAvailable: async () => true,
    inspector: { inspect: inspectProcess, close: async () => {} },
    identity: { inspectProcess, identify: async () => processIdentity },
    run: async (command, args) => {
      calls.push([command, args]);
      processIdentity = null;
    },
  });
  assert.equal(
    (await runtime.status(record.stackId)).services.provider,
    "running",
  );
  await runtime.stop(record.stackId);
  assert.deepEqual(calls, [
    [
      "pitchfork",
      ["stop", `recovery-local/recovery-${record.stackId}-provider`],
    ],
  ]);
  assert.equal(
    (await runtime.status(record.stackId)).services.provider,
    "stopped",
  );
  await runtime.close();
});

async function startupFixture(t, failure) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-start-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const worktree = await fs.realpath(root);
  const providerFile = path.join(worktree, "packages/local-workos/src/cli.ts");
  await fs.mkdir(path.dirname(providerFile), { recursive: true });
  await fs.writeFile(providerFile, "// fake source; never executed");
  const backendBinary = path.join(worktree, "fake-backend");
  await fs.writeFile(backendBinary, "", { mode: 0o700 });
  const dependencyFiles = [
    "apps/mobile/node_modules/expo/bin/cli",
    "packages/backend/node_modules/.bin/convex",
    "bin/node",
    "bin/pnpm",
    "bin/mailpit",
  ];
  for (const file of dependencyFiles) {
    const target = path.join(worktree, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "", { mode: 0o700 });
  }
  const events = [];
  const processes = new Map();
  const busy = new Set();
  const environments = {};
  let record;
  let pid = 200;
  let clock = 0;
  const runtime = await createRuntime({
    now: () => clock,
    worktree,
    backendBinary,
    registryPath: path.join(root, "registry"),
    inherited: {
      PATH: path.join(worktree, "bin"),
      ...(failure === "selector"
        ? { CONVEX_DEPLOY_KEY: "fake-forbidden" }
        : {}),
    },
    readinessTimeoutMs: 20,
    connect: ({ host, port }) => {
      assert.equal(host, "127.0.0.1");
      const name = Object.keys(record.ports).find(
        (name) => record.ports[name] === port,
      );
      events.push("socket:" + name);
      const socket = new EventEmitter();
      socket.destroy = () => {};
      queueMicrotask(() => {
        if (failure === "readiness") return;
        if (name === "mailpitSmtp")
          socket.emit("data", Buffer.from("220 fake SMTP\r\n"));
        else if (name === "convexSite") socket.emit("connect");
        else assert.fail("Unexpected socket");
      });
      return socket;
    },
    setupTimeoutMs: failure === "timeout" ? 20 : 180000,
    inspector: { close: async () => {} },
    identity: {
      identify: async (id) => processes.get(id) ?? null,
      inspectProcess: async (id) =>
        [...processes.values()].find((value) => value.pid === id) ?? null,
    },
    portAvailable: async (port) => !busy.has(port),
    run: async (_command, args, options) => {
      const name = args[1].split("-").at(-1);
      events.push("start:" + name);
      environments[name] = options.env;
      const endpoints =
        name === "mailpitHttp"
          ? ["mailpitHttp", "mailpitSmtp"]
          : name === "convexCloud"
            ? ["convexCloud", "convexSite"]
            : [name];
      endpoints.forEach((endpoint) => busy.add(record.ports[endpoint]));
      processes.set(args[1], {
        pid: ++pid,
        startedAt: "fake-" + pid,
        worktree,
        stackId: record.stackId,
      });
    },
    fetchImpl: async (url) => {
      if (!url.endsWith("/instance-info")) {
        events.push("http:" + new URL(url).pathname);
        if (url.endsWith("/status"))
          return new Response("packager-status:running");
        if (url.endsWith("/instance_name")) return new Response("fake");
        assert.ok(url.endsWith("/api/v1/info"));
        return Response.json({});
      }
      events.push("identity");
      assert.equal(
        url,
        `http://127.0.0.1:${record.ports.provider}/instance-info`,
      );
      return Response.json({
        providerGeneration:
          failure === "generation" ? "wrong" : record.providerGeneration,
        issuer:
          failure === "issuer"
            ? "https://wrong.invalid"
            : `https://local-workos.invalid/instances/${record.providerGeneration}`,
        clientId:
          failure === "clientId"
            ? "wrong"
            : "client_local" + record.providerGeneration.replaceAll("-", ""),
        port:
          failure === "port"
            ? record.ports.provider + 1
            : record.ports.provider,
      });
    },
    startup: {
      prepareSeed: async (options) => {
        record = options.registry;
        await fs.access(path.join(worktree, ".recovery-stack-lifecycle.lock"));
        events.push("seed");
        return {
          LOCAL_WORKOS_API_KEY: "sk_test_local_" + "a".repeat(64),
          LOCAL_CONVEX_INSTANCE_NAME: "fake",
          LOCAL_CONVEX_INSTANCE_SECRET: "fake",
        };
      },
      ready: ["readiness", "default"].includes(failure)
        ? undefined
        : async (service) => {
            events.push("ready:" + service.name);
            return true;
          },
      bootstrap: async () => {
        events.push("bootstrap");
        if (failure === "push") throw Error("fake push failure");
        if (failure === "ambiguous")
          throw Object.assign(Error("fake ambiguous failure"), {
            ambiguous: true,
          });
        if (failure === "timeout") return new Promise(() => {});
      },
      persist: async ({ owned, deadlineMs }) => {
        if (failure === "syncDeadline") clock = deadlineMs ?? 180000;
        events.push("persist");
        assert.equal(
          owned.EXPO_PUBLIC_AUTH_ENVIRONMENT_ID,
          `${record.stackId}:${record.providerGeneration}`,
        );
        if (failure === "persist") throw Error("fake persist failure");
      },
    },
  });
  t.after(() => runtime.close());
  return {
    runtime,
    events,
    environments,
    worktree,
    providerFile,
    backendBinary,
  };
}

test("runtime composes private seed, authoritative identity, bootstrap, persist, then Metro", async (t) => {
  const f = await startupFixture(t);
  await f.runtime.start();
  assert.deepEqual(f.events, [
    "seed",
    "start:mailpitHttp",
    "ready:mailpitHttp",
    "ready:mailpitSmtp",
    "start:provider",
    "ready:provider",
    "identity",
    "start:convexCloud",
    "ready:convexCloud",
    "ready:convexSite",
    "bootstrap",
    "persist",
    "identity",
    "start:metro",
    "ready:metro",
  ]);
  assert.ok(f.environments.provider.LOCAL_WORKOS_API_KEY);
  assert.equal(f.environments.metro.LOCAL_WORKOS_API_KEY, undefined);
  assert.ok(f.environments.metro.EXPO_PUBLIC_CONVEX_URL);
  assert.equal(f.environments.provider.EXPO_PUBLIC_CONVEX_URL, undefined);
});
for (const failure of [
  "generation",
  "issuer",
  "clientId",
  "port",
  "push",
  "persist",
  "ambiguous",
  "timeout",
  "syncDeadline",
  "selector",
  "readiness",
]) {
  test(`runtime ${failure} failure prevents Metro`, async (t) => {
    const f = await startupFixture(t, failure);
    await assert.rejects(f.runtime.start());
    assert.ok(!f.events.includes("start:metro"));
    if (failure === "selector") assert.deepEqual(f.events, []);
    if (failure === "readiness") {
      assert.ok(f.events.includes("socket:mailpitSmtp"));
      assert.ok(!f.events.includes("bootstrap"));
    }
    if (["generation", "issuer", "clientId", "port"].includes(failure)) {
      assert.ok(!f.events.includes("start:convexCloud"));
    }
    if (["ambiguous", "timeout", "syncDeadline"].includes(failure)) {
      await fs.access(path.join(f.worktree, ".recovery-stack-lifecycle.lock"));
    }
  });
}
for (const missing of ["providerFile", "backendBinary"]) {
  test(`runtime preflight rejects missing ${missing} before seed or services`, async (t) => {
    const f = await startupFixture(t);
    await fs.unlink(f[missing]);
    await assert.rejects(f.runtime.start(), /preflight/);
    assert.deepEqual(f.events, []);
  });
}

test("CLI starts with an explicit absolute executable and closes", async () => {
  let closed = false;
  const code = await runCli(["start", "/fake/backend"], {
    open: async (options) => {
      assert.deepEqual(options, { backendBinary: "/fake/backend" });
      return {
        start: async () => ({ state: "running" }),
        close: async () => {
          closed = true;
        },
      };
    },
    write: () => {},
  });
  assert.equal(code, 0);
  assert.equal(closed, true);
});
test("default readiness uses only injected HTTP and socket adapters", async (t) => {
  const f = await startupFixture(t, "default");
  await f.runtime.start();
  for (const event of [
    "http:/api/v1/info",
    "socket:mailpitSmtp",
    "http:/instance_name",
    "socket:convexSite",
    "http:/status",
  ]) {
    assert.ok(f.events.includes(event), event);
  }
  assert.equal(f.events.filter((event) => event === "identity").length, 3);
});
for (const missing of [
  "apps/mobile/node_modules/expo/bin/cli",
  "packages/backend/node_modules/.bin/convex",
  "bin/mailpit",
  "bin/pnpm",
  "bin/node",
]) {
  test(`missing dependency ${missing} fails before daemon startup`, async (t) => {
    const f = await startupFixture(t);
    await fs.unlink(path.join(f.worktree, missing));
    await assert.rejects(f.runtime.start(), /preflight/);
    assert.deepEqual(f.events, []);
  });
}
