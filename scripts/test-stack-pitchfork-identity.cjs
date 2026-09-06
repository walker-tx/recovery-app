const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createPitchforkIdentity } = require("./stack-pitchfork-identity.cjs");
const stackId = "12345678-1234-4123-8123-123456789abc";
const id = `recovery-local/recovery-${stackId}-provider`;
function fixture() {
  const f = {
    rows: [
      {
        id,
        namespace: "recovery-local",
        name: id.split("/")[1],
        pid: 42,
        status: "running",
        available: false,
        disabled: false,
      },
    ],
    os: { pid: 42, startedAt: "darwin:1:123456", worktree: "/work/project" },
    calls: [],
  };
  f.adapter = createPitchforkIdentity({
    baseEnv: { PATH: "/bin", SECRET: "never-copy" },
    inspectOS: async () => f.os,
    exec: async (cmd, args, opts) => {
      f.calls.push(args);
      assert.equal(cmd, "pitchfork");
      assert.deepEqual(opts.env, { PATH: "/bin" });
      assert.equal(opts.shell, false);
      assert.equal(opts.maxBuffer, 65536);
      if (f.error) throw Error("private error never-copy");
      if (args[0] === "--version")
        return { stdout: f.version || "pitchfork 2.22.0\n" };
      assert.deepEqual(args, [
        "list",
        "--json",
        "--namespace",
        "recovery-local",
      ]);
      return { stdout: f.raw ?? JSON.stringify(f.rows) };
    },
  });
  return f;
}
test("first registration requires no recorded identity; PID inspector agrees", async () => {
  const f = fixture();
  const expected = { ...f.os, stackId };
  assert.deepEqual(await f.adapter.identify(id), expected);
  assert.deepEqual(await f.adapter.inspectProcess(42), expected);
});
test("successful empty list is absence, never a CLI error", async () => {
  const f = fixture();
  f.rows = [];
  assert.equal(await f.adapter.identify(id), null);
  await assert.rejects(f.adapter.inspectProcess(42));
  f.os = null;
  assert.equal(await f.adapter.inspectProcess(42), null);
  f.error = true;
  await assert.rejects(f.adapter.identify(id), {
    message: "Pitchfork identity unavailable or mismatched",
  });
});
for (const [name, change] of Object.entries({
  version: (f) => (f.version = "pitchfork 2.23.0"),
  malformed: (f) => (f.raw = "secret"),
  object: (f) => (f.raw = "{}"),
  duplicate: (f) => f.rows.push(f.rows[0]),
  namespace: (f) => (f.rows[0].namespace = "other"),
  pid: (f) => (f.rows[0].pid = 43),
  waiting: (f) => (f.rows[0].status = "waiting"),
  cwd: (f) => (f.os.worktree = "relative"),
  available: (f) => (f.rows[0].available = true),
})) {
  test(`fails closed: ${name}`, async () => {
    const f = fixture();
    change(f);
    await assert.rejects(f.adapter.identify(id), {
      message: "Pitchfork identity unavailable or mismatched",
    });
  });
}
test("stale stopped metadata is absent only when the OS confirms the PID is gone", async () => {
  const f = fixture();
  f.rows[0].status = "stopped";
  await assert.rejects(f.adapter.inspectProcess(42));
  f.os = null;
  assert.equal(await f.adapter.inspectProcess(42), null);
  assert.equal(await f.adapter.identify(id), null);
});

test("OS precise identity is observed anew, not copied from a record", async () => {
  const f = fixture();
  const before = await f.adapter.identify(id);
  f.os = { ...f.os, startedAt: "darwin:1:123457" };
  assert.notDeepEqual(await f.adapter.inspectProcess(42), before);
});
test("real lifecycle + registry uses queried daemon ID for initial registration and rejects PID reuse", async (t) => {
  const fs = require("node:fs/promises");
  const os = require("node:os");
  const path = require("node:path");
  const { createRegistry } = require("./stack-registry.cjs");
  const { createLifecycle } = require("./stack-lifecycle.cjs");
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "identity-integration-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const worktree = await fs.realpath(root);
  const f = fixture();
  f.rows = [];
  f.os = null;
  let starts = 0;
  const registry = createRegistry({
    registryPath: path.join(root, "registry"),
    portAvailable: async () => true,
    inspectProcess: f.adapter.inspectProcess,
  });
  const lifecycle = createLifecycle({
    registry,
    identify: f.adapter.identify,
    ready: async () => true,
    run: async (_cmd, args) => {
      assert.equal(args[0], "run");
      starts++;
      // Fake daemon query result derives from the command accepted by the daemon,
      // never from the registry's expected identity. OS has no stack metadata.
      f.rows = [
        {
          id: args[1],
          name: args[1].split("/")[1],
          namespace: "recovery-local",
          pid: 42,
          status: "running",
          available: false,
          disabled: false,
        },
      ];
      f.os = { pid: 42, startedAt: "darwin:1:123456", worktree };
    },
  });
  const definitions = (r) => [
    {
      name: "provider",
      command: ["fake"],
      readiness: { http: `http://127.0.0.1:${r.ports.provider}/health` },
    },
  ];
  const first = await lifecycle.start(worktree, definitions);
  assert.equal(first.services.provider, "running");
  await lifecycle.start(worktree, definitions);
  assert.equal(starts, 1);
  f.os = { ...f.os, startedAt: "darwin:1:123457" };
  assert.equal((await lifecycle.status(worktree)).state, "conflict");
  await assert.rejects(lifecycle.stop(worktree, first.stackId), /conflict/);
  assert.equal(starts, 1);
});
