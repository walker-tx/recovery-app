const { EventEmitter } = require("node:events");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createRuntime, runCli } = require("./stack-runtime.cjs");
async function fixture(t, overrides = {}) {
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
    inherited: new Proxy(
      {},
      {
        get() {
          throw Error("Environment read");
        },
      },
    ),
    fetchImpl: async () => {
      throw Error("Unexpected HTTP probe");
    },
    connect: () => {
      throw Error("Unexpected transport probe");
    },
    startup: {
      prepareSeed: () => {
        throw Error("Unexpected credential read");
      },
      bootstrap: () => {
        throw Error("Unexpected bootstrap");
      },
      persist: () => {
        throw Error("Unexpected configuration write");
      },
    },
    ...overrides,
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
test("status exposes configured URLs, unchecked readiness and scoped log references only", async (t) => {
  const f = await fixture(t);
  const record = await f.runtime.reserve();
  const status = await f.runtime.status(record.stackId);
  assert.equal(status.worktree, await fs.realpath(f.worktree));
  assert.match(
    status.guidance,
    /mise run zero -- --isolated <absolute-backend-executable>/,
  );
  assert.match(status.guidance, /Never clear locks/);
  for (const [service, port] of Object.entries(record.ports)) {
    assert.equal(
      status.urls[service],
      `${service === "mailpitSmtp" ? "smtp" : "http"}://127.0.0.1:${port}`,
    );
    assert.deepEqual(status.readiness[service], {
      state: "unknown",
      reason: "not-probed",
    });
    assert.equal(status.services[service], "stopped");
  }
  assert.deepEqual(
    status.logs,
    Object.fromEntries(
      ["mailpitHttp", "provider", "convexCloud", "metro"].map((service) => [
        service,
        {
          manager: "pitchfork",
          name: `recovery-local/recovery-${record.stackId}-${service}`,
        },
      ]),
    ),
  );
  const output = [];
  assert.equal(
    await runCli(["status", record.stackId], {
      open: async () => f.runtime,
      write: (line) => output.push(line),
    }),
    0,
  );
  assert.deepEqual(JSON.parse(output[0]), status);
  assert.deepEqual(f.calls, []);
});
test("occupied listeners remain conflicts, never readiness evidence", async (t) => {
  let available = true;
  const f = await fixture(t, { portAvailable: async () => available });
  const record = await f.runtime.reserve();
  available = false;
  const status = await f.runtime.status(record.stackId);
  assert.equal(status.state, "conflict");
  assert.match(status.guidance, /Resume refused/);
  assert.doesNotMatch(status.guidance, /mise run zero/);
  assert.ok(
    Object.values(status.services).every((state) => state === "occupied"),
  );
  assert.ok(
    Object.values(status.readiness).every((value) => value.state === "unknown"),
  );
  assert.deepEqual(f.calls, []);
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
    identity: {
      inspectProcess,
      identify: async (id) => {
        assert.equal(id, `recovery-local/recovery-${record.stackId}-provider`);
        return processIdentity;
      },
    },
    fetchImpl: async () => new Response("{}"),
    connect: () => {
      throw Error("Unexpected socket");
    },
    run: async (command, args) => {
      calls.push([command, args]);
      processIdentity = null;
    },
  });
  assert.equal(
    (await runtime.status(record.stackId)).services.provider,
    "running",
  );
  assert.deepEqual((await runtime.status(record.stackId)).readiness.provider, {
    state: "ready",
    evidence: "protocol",
  });
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
  const providerFile = path.join(
    worktree,
    "packages/local-workos/src/server/main.ts",
  );
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
    backendBinary:
      failure === "unnormalized"
        ? `${worktree}/bin/../fake-backend`
        : backendBinary,
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
        (endpointName) => record.ports[endpointName] === port,
      );
      events.push("socket:" + name);
      const socket = new EventEmitter();
      socket.destroy = () => {};
      queueMicrotask(() => {
        if (failure === "readiness") {
          return;
        }
        if (name === "mailpitSmtp") {
          socket.emit("data", Buffer.from("220 fake SMTP\r\n"));
        } else if (name === "convexSite") {
          socket.emit("connect");
        } else {
          assert.fail("Unexpected socket");
        }
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
      if (args[0] === "stop") {
        processes.delete(args[1]);
        const endpoints =
          name === "mailpitHttp"
            ? ["mailpitHttp", "mailpitSmtp"]
            : name === "convexCloud"
              ? ["convexCloud", "convexSite"]
              : [name];
        endpoints.forEach((endpoint) => busy.delete(record.ports[endpoint]));
        return;
      }
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
        if (url.endsWith("/status")) {
          return new Response("packager-status:running");
        }
        if (url.endsWith("/instance_name")) {
          return new Response("fake");
        }
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
        assert.equal(options.searchPath, path.join(worktree, "bin"));
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
        if (failure === "push") {
          throw Error("fake push failure");
        }
        if (failure === "ambiguous") {
          throw Object.assign(Error("fake ambiguous failure"), {
            ambiguous: true,
          });
        }
        if (failure === "timeout") {
          return new Promise(() => {});
        }
      },
      persist: async ({ owned, deadlineMs }) => {
        if (failure === "syncDeadline") {
          clock = deadlineMs ?? 180000;
        }
        events.push("persist");
        assert.equal(
          owned.EXPO_PUBLIC_AUTH_ENVIRONMENT_ID,
          `${record.stackId}:${record.providerGeneration}`,
        );
        if (failure === "persist") {
          throw Error("fake persist failure");
        }
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
    const message = {
      generation: "Local stack configuration rejected",
      issuer: "Local stack configuration rejected",
      clientId: "Local stack configuration rejected",
      port: "Local stack configuration rejected",
      push: "fake push failure",
      persist: "fake persist failure",
      ambiguous: "fake ambiguous failure",
      timeout:
        "service setup timed out; manual reconciliation required; lifecycle lock retained",
      syncDeadline:
        "service setup timed out; manual reconciliation required; lifecycle lock retained",
      selector: "Inherited deployment selector rejected",
      readiness: "Readiness timeout",
    }[failure];
    await assert.rejects(f.runtime.start(), { message });
    assert.ok(!f.events.includes("start:metro"));
    if (failure === "push") {
      assert.ok(f.events.includes("bootstrap"));
      assert.ok(!f.events.includes("persist"));
    }
    if (failure === "persist") {
      assert.ok(f.events.includes("bootstrap"));
      assert.ok(f.events.includes("persist"));
    }
    if (failure === "selector") {
      assert.deepEqual(f.events, []);
    }
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
    const checkpoint = missing.startsWith("bin/")
      ? path.basename(missing)
      : missing;
    await assert.rejects(f.runtime.start(), (error) => {
      assert.ok(error.message.includes(`preflight failed at ${checkpoint}`));
      assert.ok(!error.message.includes(f.worktree));
      return true;
    });
    assert.deepEqual(f.events, []);
  });
}

for (const alias of [false, true]) {
  test(`Darwin startup rejects non-ASCII canonical worktree before side effects (alias=${alias})`, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-unicode-"));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const canonical = path.join(root, "caf\u00e9");
    await fs.mkdir(canonical);
    const worktree = alias ? path.join(root, "ascii-alias") : canonical;
    if (alias) {
      await fs.symlink(canonical, worktree);
    }
    const effects = [];
    const runtime = await createRuntime({
      platform: "darwin",
      worktree,
      registryPath: path.join(root, "registry"),
      backendBinary: path.join(root, "missing-backend"),
      inherited: {},
      inspector: { inspect: async () => null, close: async () => {} },
      identity: {
        inspectProcess: async () => null,
        identify: async () => null,
      },
      run: async () => effects.push("run"),
      startup: { prepareSeed: async () => effects.push("seed") },
    });
    t.after(() => runtime.close());
    await assert.rejects(runtime.start(), {
      message: "Darwin startup requires an ASCII canonical worktree path",
    });
    assert.deepEqual(effects, []);
    assert.deepEqual(await fs.readdir(canonical), []);
    await assert.rejects(fs.stat(path.join(root, "registry")), {
      code: "ENOENT",
    });
  });
}

test("startup rejects an unnormalized absolute executable before effects", async (t) => {
  const f = await startupFixture(t, "unnormalized");
  await assert.rejects(f.runtime.start(), /absolute backend executable/);
  assert.deepEqual(f.events, []);
  await assert.rejects(fs.stat(path.join(f.worktree, "registry")), {
    code: "ENOENT",
  });
});

test("previously started stack refuses missing persisted identity before seed", async (t) => {
  const f = await startupFixture(t);
  await f.runtime.start();
  await f.runtime.stop((await f.runtime.reserve()).stackId);
  const before = [...f.events];
  await assert.rejects(f.runtime.start(), /persisted identity/);
  assert.deepEqual(f.events, before);
});

for (const invalid of [
  "generation",
  "keys",
  "config",
  "hardlink",
  "file-mode",
  "directory-mode",
  "symlink",
  "owner",
  null,
]) {
  test(`stopped restart validates retained persisted identity (${invalid ?? "compatible"})`, async (t) => {
    const f = await startupFixture(t);
    await f.runtime.start();
    const record = await f.runtime.reserve();
    await f.runtime.stop(record.stackId);
    const { DatabaseSync } = require("node:sqlite");
    const { generateKeyPairSync } = require("node:crypto");
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const database = new DatabaseSync(
      path.join(f.worktree, ".recovery-stack/provider/state.sqlite"),
    );
    database.exec(
      "CREATE TABLE instance (id INTEGER PRIMARY KEY, body TEXT NOT NULL)",
    );
    database.prepare("INSERT INTO instance VALUES (1, ?)").run(
      JSON.stringify({
        generation:
          invalid === "generation" ? "wrong" : record.providerGeneration,
        privateKey:
          invalid === "keys" ? {} : keys.privateKey.export({ format: "jwk" }),
        publicKey: keys.publicKey.export({ format: "jwk" }),
      }),
    );
    database.close();
    await fs.chmod(
      path.join(f.worktree, ".recovery-stack/provider/state.sqlite"),
      0o600,
    );
    const seed = {
      RECOVERY_STACK_ID: invalid === "config" ? "wrong" : record.stackId,
      RECOVERY_PROVIDER_GENERATION: record.providerGeneration,
      LOCAL_WORKOS_API_KEY: "sk_test_local_" + "a".repeat(64),
      LOCAL_CONVEX_INSTANCE_NAME:
        "recovery_" + record.stackId.replaceAll("-", ""),
      LOCAL_CONVEX_INSTANCE_SECRET: "a".repeat(64),
      LOCAL_CONVEX_ADMIN_KEY: "synthetic-admin",
      WORKOS_EMAIL_HMAC_KEY: Buffer.alloc(32).toString("base64"),
      WORKOS_INTENT_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
    };
    await fs.writeFile(
      path.join(f.worktree, "mise.local.toml"),
      "[env]\n" +
        Object.entries(seed)
          .map(([key, value]) => `${key} = ${JSON.stringify(value)}`)
          .join("\n") +
        "\n",
      { mode: 0o600 },
    );
    const databaseFile = path.join(
      f.worktree,
      ".recovery-stack/provider/state.sqlite",
    );
    if (invalid === "hardlink") {
      await fs.link(databaseFile, path.join(f.worktree, "linked.sqlite"));
    }
    if (invalid === "file-mode") {
      await fs.chmod(databaseFile, 0o640);
    }
    if (invalid === "directory-mode") {
      await fs.chmod(path.dirname(databaseFile), 0o750);
    }
    if (invalid === "symlink") {
      const target = path.join(f.worktree, "target.sqlite");
      await fs.rename(databaseFile, target);
      await fs.symlink(target, databaseFile);
    }
    if (invalid === "owner") {
      const lstat = fs.lstat;
      t.mock.method(fs, "lstat", async (file, ...args) => {
        const stat = await lstat(file, ...args);
        if (file === databaseFile) {
          stat.uid = process.getuid() + 1;
        }
        return stat;
      });
    }
    let reads = 0;
    const prepare = DatabaseSync.prototype.prepare;
    t.mock.method(DatabaseSync.prototype, "prepare", function (...args) {
      reads++;
      return prepare.apply(this, args);
    });
    const before = [...f.events];
    if (invalid) {
      await assert.rejects(f.runtime.start(), /persisted identity/);
      assert.deepEqual(f.events, before);
      if (
        [
          "hardlink",
          "file-mode",
          "directory-mode",
          "symlink",
          "owner",
        ].includes(invalid)
      ) {
        assert.equal(
          reads,
          0,
          "unsafe persisted state must be refused before SQLite reads",
        );
      }
    } else {
      await f.runtime.start();
      const resumed = await f.runtime.reserve();
      assert.equal(resumed.stackId, record.stackId);
      assert.equal(resumed.providerGeneration, record.providerGeneration);
    }
  });
}
