const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { createRegistry, resolveRegistryPath } = require("./stack-registry.cjs");
const { createMockTarget } = require("./mock-target.cjs");
const run = promisify(execFile);
async function fixture(t) {
  const temp = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "mock-target-")),
  );
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const worktree = path.join(temp, "main");
  const sibling = path.join(temp, "sibling");
  await fs.mkdir(worktree);
  const git = (args) => run("git", args, { cwd: worktree, timeout: 3000 });
  await git(["init", "-q"]);
  await git([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--allow-empty",
    "-qm",
    "fixture",
  ]);
  await git(["worktree", "add", "-qb", "sibling", sibling]);
  await fs.mkdir(path.join(worktree, "nested"));
  await fs.symlink(worktree, path.join(temp, "link"));
  const registryPath = await resolveRegistryPath(worktree);
  const actual = new Map();
  const inspectProcess = async (pid) => actual.get(pid) ?? null;
  const registry = createRegistry({
    registryPath,
    portAvailable: async () => true,
    inspectProcess,
  });
  const a = await registry.reserve(worktree);
  const b = await registry.reserve(sibling);
  // Synthetic OS evidence only: no provider, Mailpit, or Convex starts.
  const inspectOS = async (pid) => {
    const observed = actual.get(pid);
    return observed
      ? {
          pid: observed.pid,
          startedAt: observed.startedAt,
          worktree: observed.worktree,
        }
      : null;
  };
  const client = createMockTarget({
    createInspector: async () => ({
      inspect: inspectOS,
      close: async () => {},
    }),
    inspectListener: async () => true,
    inspectSocket: async () => actual.has(123),
    exec: async (file, args, options) => {
      assert.notEqual(path.basename(file), "pitchfork");
      return run(file, args, options);
    },
  });
  return {
    temp,
    worktree,
    sibling,
    registryPath,
    registry,
    actual,
    a,
    b,
    client,
  };
}
test("real linked worktrees: nested cwd, symlink, explicit target, sibling and nested repository", async (t) => {
  const f = await fixture(t);
  for (const options of [
    { cwd: path.join(f.worktree, "nested") },
    { cwd: path.join(f.temp, "link") },
    { cwd: f.sibling, worktree: f.worktree },
  ]) {
    const selection = await f.client.selectMockTarget(options);
    assert.equal(selection.worktree, f.worktree);
    assert.equal(selection.stackId, f.a.stackId);
    assert.equal(selection.providerState, "stopped");
  }
  assert.equal(
    (await f.client.selectMockTarget({ cwd: f.sibling })).stackId,
    f.b.stackId,
  );
  const nestedRepo = path.join(f.worktree, "nested");
  await run("git", ["init", "-q"], { cwd: nestedRepo, timeout: 3000 });
  await assert.rejects(f.client.selectMockTarget({ cwd: nestedRepo }), {
    code: "TARGET_MISMATCH",
  });
  assert.equal(
    await fs
      .stat(path.join(nestedRepo, ".git", "recovery-stacks"))
      .catch(() => null),
    null,
  );
});
test("synthetic ownership: live start identity and Mailpit epoch are revalidated", async (t) => {
  const f = await fixture(t);
  const provider = {
    pid: 123,
    startedAt: "synthetic:1",
    worktree: f.worktree,
    stackId: f.a.stackId,
  };
  const mailpit = { ...provider, pid: 124 };
  f.actual.set(123, provider);
  f.actual.set(124, mailpit);
  await f.registry.recordProcess(f.worktree, f.a.stackId, "provider", provider);
  await f.registry.recordProcess(
    f.worktree,
    f.a.stackId,
    ["mailpitHttp", "mailpitSmtp"],
    mailpit,
  );
  const selection = await f.client.selectMockTarget({ cwd: f.worktree });
  assert.equal(selection.providerState, "running");
  assert.equal(
    selection.inbox.baseUrl,
    `http://127.0.0.1:${f.a.ports.mailpitHttp}`,
  );
  assert.ok(selection.inbox.epoch);
  await f.client.verifyMockTarget(selection, { inbox: true });
  f.actual.set(124, { ...mailpit, startedAt: "synthetic:2" });
  await assert.rejects(f.client.verifyMockTarget(selection, { inbox: true }), {
    code: "TARGET_MISMATCH",
  });
  f.actual.set(124, mailpit);
  f.actual.set(123, { ...provider, startedAt: "synthetic:2" });
  await assert.rejects(f.client.selectMockTarget({ cwd: f.worktree }), {
    code: "TARGET_MISMATCH",
  });
});
test("missing registration, changed generation and abort fail closed without reserving", async (t) => {
  const f = await fixture(t);
  const selected = await f.client.selectMockTarget({ cwd: f.worktree });
  await assert.rejects(f.client.verifyMockTarget(selected), {
    code: "SERVICE_UNAVAILABLE",
  });
  const file = path.join(f.registryPath, "registry.json");
  const data = JSON.parse(await fs.readFile(file, "utf8"));
  data.stacks[f.worktree].providerGeneration =
    "33333333-3333-4333-8333-333333333333";
  await fs.writeFile(file, JSON.stringify(data));
  await assert.rejects(f.client.verifyMockTarget(selected), {
    code: "TARGET_MISMATCH",
  });
  await fs.mkdir(path.join(f.registryPath, "lock"));
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  const started = Date.now();
  await assert.rejects(
    f.client.selectMockTarget({ cwd: f.worktree, signal: controller.signal }),
    { code: "SERVICE_UNAVAILABLE" },
  );
  assert.ok(Date.now() - started < 500);
  assert.ok((await fs.stat(path.join(f.registryPath, "lock"))).isDirectory());
  assert.equal(await fs.readFile(file, "utf8"), JSON.stringify(data));
});

test("synthetic identity with real disposable socket: starting, private running, stale and unsafe entries", async (t) => {
  const f = await fixture(t);
  const parent = await fs.realpath(await fs.mkdtemp("/tmp/mock-socket-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const socket = path.join(parent, "admin.sock");
  // Translate only socket stat reads to disposable storage. The registry keeps
  // its exact six fields; tests never create/chmod the user's shared socket root.
  const selectedSocket = require("./stack-registry.cjs").adminSocketPath(f.a);
  const selectedParent = path.dirname(selectedSocket);
  const lstat = fs.lstat;
  const realpath = fs.realpath;
  t.mock.method(fs, "lstat", (file, ...args) =>
    lstat(
      file === selectedSocket
        ? socket
        : file === selectedParent
          ? parent
          : file,
      ...args,
    ),
  );
  t.mock.method(fs, "realpath", async (file, ...args) =>
    file === selectedParent
      ? (await realpath(parent), selectedParent)
      : realpath(file, ...args),
  );
  const provider = {
    pid: 123,
    startedAt: "synthetic:1",
    worktree: f.worktree,
    stackId: f.a.stackId,
  };
  f.actual.set(123, provider);
  await f.registry.recordProcess(f.worktree, f.a.stackId, "provider", provider);
  const client = createMockTarget({
    createInspector: async () => ({
      inspect: async (pid) => {
        const observed = f.actual.get(pid);
        return observed
          ? {
              pid: observed.pid,
              startedAt: observed.startedAt,
              worktree: observed.worktree,
            }
          : null;
      },
      close: async () => {},
    }),
  });
  const starting = await client.selectMockTarget({ cwd: f.worktree });
  assert.equal(starting.providerState, "starting");
  await assert.rejects(client.verifyMockTarget(starting), {
    code: "SERVICE_UNAVAILABLE",
  });
  const server = require("node:net").createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socket, resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await fs.chmod(socket, 0o600);
  const selected = await client.selectMockTarget({ cwd: f.worktree });
  assert.equal(selected.providerState, "running");
  await fs.chmod(parent, 0o755);
  await assert.rejects(client.verifyMockTarget(selected), {
    code: "TARGET_MISMATCH",
  });
  await fs.chmod(parent, 0o700);
  await fs.chmod(socket, 0o666);
  await assert.rejects(client.verifyMockTarget(selected), {
    code: "TARGET_MISMATCH",
  });
  await fs.chmod(socket, 0o600);
  f.actual.delete(123);
  await assert.rejects(client.selectMockTarget({ cwd: f.worktree }), {
    code: "TARGET_MISMATCH",
  });
  assert.ok((await fs.lstat(socket)).isSocket());
});

test("synthetic blocked process inspection receives cancellation and closes its scope", async (t) => {
  const f = await fixture(t);
  const provider = {
    pid: 123,
    startedAt: "synthetic:1",
    worktree: f.worktree,
    stackId: f.a.stackId,
  };
  f.actual.set(123, provider);
  await f.registry.recordProcess(f.worktree, f.a.stackId, "provider", provider);
  let closed = false;
  const client = createMockTarget({
    createInspector: async ({ exec }) => {
      assert.equal(typeof exec, "function");
      return {
        inspect: async (_pid, { signal }) => {
          await require("node:timers/promises").setTimeout(2000, undefined, {
            signal,
          });
          return null;
        },
        close: async () => {
          closed = true;
        },
      };
    },
  });
  const started = Date.now();
  await assert.rejects(
    client.selectMockTarget({
      cwd: f.worktree,
      signal: AbortSignal.timeout(80),
    }),
    { code: "SERVICE_UNAVAILABLE" },
  );
  assert.ok(Date.now() - started < 500);
  assert.equal(closed, true);
});

test("real child OS tuple with synthetic listener continuity; no Pitchfork invocation", async (t) => {
  const f = await fixture(t);
  const { spawn } = require("node:child_process");
  const { once } = require("node:events");
  const { createProcessInspector } = require("./stack-process-inspector.cjs");
  const child = spawn(
    process.execPath,
    [
      "-e",
      `
    const server = require('node:net').createServer();
    server.listen(0, '127.0.0.1', () => console.log(server.address().port));
  `,
    ],
    {
      cwd: f.worktree,
      env: { PATH: process.env.PATH },
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
  });
  const [output] = await once(child.stdout, "data", {
    signal: AbortSignal.timeout(2000),
  });
  const port = Number(output.toString().trim());
  assert.ok(Number.isInteger(port) && port > 0);
  const inspector = await createProcessInspector();
  const tuple = await inspector.inspect(child.pid);
  await inspector.close();
  assert.equal(tuple.worktree, f.worktree);
  assert.equal("stackId" in tuple, false);
  // The fixture knows the child it launched; lifecycle adapters remain unchanged.
  f.actual.set(child.pid, { ...tuple, stackId: f.a.stackId });
  for (const service of ["provider", "mailpitHttp", "mailpitSmtp"]) {
    await f.registry.recordProcess(
      f.worktree,
      f.a.stackId,
      service,
      f.actual.get(child.pid),
    );
  }
  const file = path.join(f.registryPath, "registry.json");
  const data = JSON.parse(await fs.readFile(file, "utf8"));
  data.stacks[f.worktree].ports.mailpitHttp = port;
  await fs.writeFile(file, JSON.stringify(data));
  const commands = [];
  const client = createMockTarget({
    inspectSocket: async () => true,
    exec: async (command, args, options) => {
      commands.push(command);
      assert.notEqual(path.basename(command), "pitchfork");
      if (path.basename(command) === "lsof") {
        // Hermetic listener evidence; the real child still exercises OS identity.
        const listenerPid = args.includes(`-i4TCP:${port}`)
          ? child.pid
          : process.pid;
        const listenPort = args
          .find((arg) => arg.startsWith("-i4TCP:"))
          .slice(7);
        return { stdout: `p${listenerPid}\nf4\nn127.0.0.1:${listenPort}\n` };
      }
      return run(command, args, options);
    },
  });
  const selected = await client.selectMockTarget({ cwd: f.worktree });
  assert.equal(selected.providerState, "running");
  assert.equal(selected.inbox.baseUrl, `http://127.0.0.1:${port}`);
  await client.verifyMockTarget(selected, { inbox: true });
  assert.ok(commands.some((command) => path.basename(command) === "lsof"));
  // A live recorded PID cannot authorize another process listening on the port.
  const impostor = require("node:net").createServer();
  await new Promise((resolve) => impostor.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => impostor.close(resolve)));
  data.stacks[f.worktree].ports.mailpitHttp = impostor.address().port;
  await fs.writeFile(file, JSON.stringify(data));
  const impostorSelection = await client.selectMockTarget({ cwd: f.worktree });
  await assert.rejects(
    client.verifyMockTarget(impostorSelection, { inbox: true }),
    {
      code: "TARGET_MISMATCH",
    },
  );
  data.stacks[f.worktree].ports.mailpitHttp = port;
  for (const change of [
    { pid: child.pid + 1 },
    { worktree: f.sibling },
    { startedAt: tuple.startedAt + ":reused" },
  ]) {
    const rejected = createMockTarget({
      inspectSocket: async () => true,
      createInspector: async () => ({
        inspect: async () => ({ ...tuple, ...change }),
        close: async () => {},
      }),
    });
    await fs.writeFile(file, JSON.stringify(data));
    await assert.rejects(rejected.selectMockTarget({ cwd: f.worktree }), {
      code: "TARGET_MISMATCH",
    });
  }
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  await exited;
  await assert.rejects(client.selectMockTarget({ cwd: f.worktree }), {
    code: "TARGET_MISMATCH",
  });
});

test("listener evidence unavailable or ambiguous fails closed with sanitized output", async (t) => {
  const f = await fixture(t);
  const tuple = { pid: 123, startedAt: "synthetic:1", worktree: f.worktree };
  f.actual.set(123, { ...tuple, stackId: f.a.stackId });
  await f.registry.recordProcess(
    f.worktree,
    f.a.stackId,
    ["provider", "mailpitHttp", "mailpitSmtp"],
    f.actual.get(123),
  );
  const base = {
    inspectSocket: async () => true,
    createInspector: async () => ({
      inspect: async () => tuple,
      close: async () => {},
    }),
  };
  for (const output of [
    null,
    `p123\nf4\nn*:${f.a.ports.mailpitHttp}\n`,
    `p123\nf4\nn127.0.0.1:${f.a.ports.mailpitHttp}\np124\nf5\nn127.0.0.1:${f.a.ports.mailpitHttp}\n`,
  ]) {
    let listenerCalls = 0;
    const client = createMockTarget({
      ...base,
      exec: async (file, args, options) => {
        assert.notEqual(path.basename(file), "pitchfork");
        if (path.basename(file) !== "lsof") {
          return run(file, args, options);
        }
        listenerCalls++;
        assert.ok(options.timeout <= 1000 && options.maxBuffer <= 8192);
        assert.ok(options.signal instanceof AbortSignal);
        if (output === null) {
          throw Object.assign(Error("private-error-canary"), {
            code: "ENOENT",
          });
        }
        return { stdout: output };
      },
    });
    // Selection/status and provider verification never need optional lsof.
    const selection = await client.selectMockTarget({ cwd: f.worktree });
    await client.verifyMockTarget(selection);
    assert.equal(listenerCalls, 0);
    await assert.rejects(
      client.verifyMockTarget(selection, { inbox: true }),
      (error) => {
        assert.equal(error.message.includes("private-error-canary"), false);
        return (
          error.code ===
          (output === null ? "SERVICE_UNAVAILABLE" : "TARGET_MISMATCH")
        );
      },
    );
    assert.equal(listenerCalls, 1);
  }
});

test("legacy six-field selection derives its socket without rewriting registry or creating state", async (t) => {
  const f = await fixture(t);
  const { adminSocketPath } = require("./stack-registry.cjs");
  const file = path.join(f.registryPath, "registry.json");
  const before = await fs.readFile(file, "utf8");
  const mkdir = fs.mkdir;
  const created = [];
  t.mock.method(fs, "mkdir", async (directory, ...args) => {
    created.push(directory);
    return mkdir(directory, ...args);
  });
  t.mock.method(require("node:net"), "createServer", () => {
    throw Error("status attempted a port bind");
  });
  assert.equal(Object.keys(f.a).length, 6);
  assert.equal("adminSocket" in f.a, false);
  const selection = await f.client.selectMockTarget({ cwd: f.worktree });
  assert.equal(selection.adminSocket, adminSocketPath(f.a));
  assert.equal(selection.providerState, "stopped");
  assert.deepEqual(selection.record, f.a);
  assert.equal(await fs.readFile(file, "utf8"), before);
  assert.equal(
    await fs.stat(path.join(f.worktree, ".recovery-stack")).catch(() => null),
    null,
  );
  assert.ok(
    created.every(
      (directory) => directory === path.join(f.registryPath, "lock"),
    ),
  );
  const provider = {
    pid: 123,
    startedAt: "synthetic:legacy",
    worktree: f.worktree,
    stackId: f.a.stackId,
  };
  f.actual.set(123, provider);
  await f.registry.recordProcess(f.worktree, f.a.stackId, "provider", provider);
  // Registration is a fixture write, not a discovery effect.
  created.splice(0);
  const current = await fs.readFile(file, "utf8");
  const legacy = createMockTarget({
    createInspector: async () => ({
      inspect: async () => ({
        pid: provider.pid,
        startedAt: provider.startedAt,
        worktree: provider.worktree,
      }),
      close: async () => {},
    }),
    inspectSocket: async (socket) => {
      assert.equal(socket, adminSocketPath(f.a));
      return false;
    },
  });
  const runningWithoutSocket = await legacy.selectMockTarget({
    cwd: f.worktree,
  });
  assert.equal(runningWithoutSocket.providerState, "starting");
  await assert.rejects(legacy.verifyMockTarget(runningWithoutSocket), {
    code: "SERVICE_UNAVAILABLE",
  });
  assert.equal(await fs.readFile(file, "utf8"), current);
  assert.ok(
    created.every(
      (directory) => directory === path.join(f.registryPath, "lock"),
    ),
  );
});

test("native ESM CLI bridge can import the declared CommonJS target functions", async () => {
  const helper = await import("./mock-target.cjs");
  assert.equal(typeof helper.selectMockTarget, "function");
  assert.equal(typeof helper.verifyMockTarget, "function");
});
