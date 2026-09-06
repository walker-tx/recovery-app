const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createRegistry } = require("./stack-registry.cjs");
async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "recovery-registry-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const worktree = path.join(root, "worktree"),
    sibling = path.join(root, "sibling");
  await Promise.all([fs.mkdir(worktree), fs.mkdir(sibling)]);
  const registryPath = path.join(root, "registry");
  return {
    registry: createRegistry({
      registryPath,
      portAvailable: async () => true,
      ...options,
    }),
    registryPath,
    worktree,
    sibling,
  };
}
test("concurrent siblings and repeated preparation retain independent identities/ports", async (t) => {
  const { registry, worktree, sibling } = await fixture(t);
  const [a, b, again] = await Promise.all([
    registry.reserve(worktree),
    registry.reserve(sibling),
    registry.reserve(worktree),
  ]);
  assert.deepEqual(a, again);
  assert.notEqual(a.stackId, b.stackId);
  assert.notEqual(a.providerGeneration, b.providerGeneration);
  assert.equal(
    new Set([...Object.values(a.ports), ...Object.values(b.ports)]).size,
    12,
  );
  assert.equal((await registry.status(worktree)).state, "reserved");
});
test("occupied ports skipped initially; existing reservations never silently move", async (t) => {
  const busy = new Set([24000]);
  const { registry, worktree } = await fixture(t, {
    portAvailable: async (port) => !busy.has(port),
  });
  const a = await registry.reserve(worktree);
  assert.ok(!Object.values(a.ports).includes(24000));
  busy.add(a.ports.metro);
  await assert.rejects(registry.reserve(worktree), /occupied/);
  assert.equal((await registry.status(worktree)).state, "conflict");
});
test("bounded lock contention never breaks a stale lock based on PID", async (t) => {
  const { registry, registryPath, worktree } = await fixture(t, {
    lockTimeoutMs: 30,
  });
  await fs.mkdir(registryPath, { mode: 0o700 });
  await fs.mkdir(path.join(registryPath, "lock"));
  await fs.writeFile(
    path.join(registryPath, "lock", "owner.json"),
    '{"pid":99999999}',
  );
  await assert.rejects(registry.reserve(worktree), /locked.*manual/);
  assert.ok(await fs.stat(path.join(registryPath, "lock")));
});
test("release explicit, ownership checked, idempotent and sibling safe", async (t) => {
  const { registry, worktree, sibling } = await fixture(t);
  const a = await registry.reserve(worktree),
    b = await registry.reserve(sibling);
  await assert.rejects(registry.release(worktree, b.stackId), /ownership/);
  await registry.release(worktree, a.stackId);
  await registry.release(worktree, a.stackId);
  assert.equal((await registry.status(worktree)).state, "absent");
  assert.equal((await registry.status(sibling)).stackId, b.stackId);
  const fresh = await registry.reserve(worktree);
  assert.notEqual(fresh.stackId, a.stackId);
  await assert.rejects(registry.release(worktree, a.stackId), /ownership/);
});
test("fake ownership permits resume; PID reuse blocks release and resume", async (t) => {
  const processes = new Map(),
    busy = new Set();
  const { registry, worktree } = await fixture(t, {
    portAvailable: async (port) => !busy.has(port),
    inspectProcess: async (pid) => processes.get(pid) ?? null,
  });
  const a = await registry.reserve(worktree);
  const identity = {
    pid: 123,
    startedAt: "boot-1:12345",
    worktree: a.worktree,
    stackId: a.stackId,
  };
  processes.set(123, identity);
  busy.add(a.ports.metro);
  await registry.recordProcess(worktree, a.stackId, "metro", identity);
  assert.equal((await registry.status(worktree)).services.metro, "running");
  assert.equal((await registry.reserve(worktree)).stackId, a.stackId);
  await assert.rejects(registry.release(worktree, a.stackId), /process/);
  processes.set(123, { ...identity, startedAt: "boot-1:99999" });
  assert.equal((await registry.status(worktree)).services.metro, "mismatched");
  await assert.rejects(registry.reserve(worktree), /ownership/);
  await assert.rejects(registry.release(worktree, a.stackId), /process/);
  processes.delete(123);
  busy.clear();
  await registry.release(worktree, a.stackId);
});
test("corrupt registry fails closed without overwrite", async (t) => {
  const { registry, registryPath, worktree } = await fixture(t);
  await fs.mkdir(registryPath, { mode: 0o700 });
  await fs.writeFile(path.join(registryPath, "registry.json"), "broken");
  await assert.rejects(registry.reserve(worktree));
  assert.equal(
    await fs.readFile(path.join(registryPath, "registry.json"), "utf8"),
    "broken",
  );
});

test("separate bootstrap processes serialize through the persistent registry", async (t) => {
  const { registry, registryPath, worktree, sibling } = await fixture(t);
  const { execFile } = require("node:child_process");
  const run = require("node:util").promisify(execFile);
  const program = `const {createRegistry}=require(process.argv[1]); createRegistry({registryPath:process.argv[2],portAvailable:async()=>true}).reserve(process.argv[3]).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1});`;
  const results = await Promise.all(
    [worktree, sibling].map((w) =>
      run(
        process.execPath,
        [
          "-e",
          program,
          require.resolve("./stack-registry.cjs"),
          registryPath,
          w,
        ],
        { timeout: 3000 },
      ),
    ),
  );
  const [a, b] = results.map((r) => JSON.parse(r.stdout));
  assert.notEqual(a.stackId, b.stackId);
  assert.equal(
    new Set([...Object.values(a.ports), ...Object.values(b.ports)]).size,
    12,
  );
  assert.equal((await registry.reserve(worktree)).stackId, a.stackId);
});
test("replaced worktree directory cannot inherit old ownership", async (t) => {
  const { registry, worktree } = await fixture(t);
  const a = await registry.reserve(worktree);
  await fs.rename(worktree, worktree + "-old");
  await fs.mkdir(worktree);
  await assert.rejects(registry.reserve(worktree), /ownership/);
  await assert.rejects(registry.release(worktree, a.stackId), /ownership/);
});

test("unsafe persisted JSON fails closed before every operation without overwrite", async (t) => {
  const {
    registry,
    registryPath,
    worktree: requestedWorktree,
    sibling: requestedSibling,
  } = await fixture(t);
  const a = await registry.reserve(requestedWorktree);
  const b = await registry.reserve(requestedSibling);
  const worktree = a.worktree,
    sibling = b.worktree;
  const file = path.join(registryPath, "registry.json");
  const original = JSON.parse(await fs.readFile(file, "utf8"));
  const identity = {
    pid: 123,
    startedAt: "boot:123",
    worktree: a.worktree,
    stackId: a.stackId,
  };
  const mutations = [
    (d) => {
      d.stacks[sibling].ports.metro = 0;
    },
    (d) => {
      d.stacks[sibling] = null;
    },
    ...[0, -1, 65536, 24000.5].map((value) => (d) => {
      d.stacks[sibling].ports.metro = value;
    }),
    (d) => {
      d.stacks[sibling].ports.metro = d.stacks[sibling].ports.provider;
    },
    (d) => {
      d.stacks[sibling].ports.metro = a.ports.metro;
    },
    (d) => {
      d.stacks[sibling].stackId = "not-uuid";
    },
    (d) => {
      d.stacks[sibling].stackId = a.stackId;
    },
    (d) => {
      d.stacks[sibling].providerGeneration = a.providerGeneration;
    },
    (d) => {
      d.stacks[sibling].owner = "device:inode";
    },
    (d) => {
      d.stacks[sibling].owner = "1:9007199254740992";
    },
    (d) => {
      d.stacks.relative = { ...d.stacks[sibling], worktree: "relative" };
      delete d.stacks[sibling];
    },
    ...[[], false, "map", { unknown: identity }, { metro: null }].map(
      (value) => (d) => {
        d.stacks[worktree].processes = value;
      },
    ),
    ...[
      { ...identity, pid: 0 },
      { ...identity, pid: 1.5 },
      { ...identity, startedAt: {} },
      { ...identity, startedAt: "" },
      { ...identity, worktree: sibling },
      { ...identity, stackId: "wrong" },
    ].map((value) => (d) => {
      d.stacks[worktree].processes.metro = value;
    }),
  ];
  for (const [index, mutate] of mutations.entries()) {
    const data = structuredClone(original);
    mutate(data);
    const contents = JSON.stringify(data);
    await fs.writeFile(file, contents);
    for (const operation of [
      () => registry.status(worktree),
      () => registry.reserve(worktree),
      () => registry.release(worktree, a.stackId),
      () => registry.recordProcess(worktree, a.stackId, "metro", identity),
    ]) {
      await assert.rejects(
        operation,
        /Invalid (registry|reservation)/,
        `mutation ${index}`,
      );
      assert.equal(await fs.readFile(file, "utf8"), contents);
    }
  }
});

test("only explicit null inspection confirms recorded process absence on a free port", async (t) => {
  let actual;
  const { registry, worktree } = await fixture(t, {
    inspectProcess: async () => actual,
  });
  const a = await registry.reserve(worktree);
  actual = {
    pid: 123,
    startedAt: "boot:123",
    worktree: a.worktree,
    stackId: a.stackId,
  };
  await registry.recordProcess(worktree, a.stackId, "metro", actual);
  for (const unknown of [undefined, false, 0, "", {}, [], { pid: 123 }]) {
    actual = unknown;
    assert.equal((await registry.status(worktree)).state, "conflict");
    await assert.rejects(registry.reserve(worktree), /ownership/);
    await assert.rejects(registry.release(worktree, a.stackId), /process/);
  }
  actual = null;
  await registry.release(worktree, a.stackId);
});

test("group ownership transaction rejects conflicts without partially recording endpoints", async (t) => {
  const processes = new Map();
  const { registry, registryPath, worktree } = await fixture(t, {
    inspectProcess: async (pid) => processes.get(pid) ?? null,
  });
  const record = await registry.reserve(worktree);
  const old = {
    pid: 200,
    startedAt: "old",
    worktree: record.worktree,
    stackId: record.stackId,
  };
  const next = { ...old, pid: 201, startedAt: "new" };
  processes.set(old.pid, old);
  processes.set(next.pid, next);
  await registry.recordProcess(worktree, record.stackId, "mailpitSmtp", old);
  const before = await fs.readFile(
    path.join(registryPath, "registry.json"),
    "utf8",
  );
  await assert.rejects(
    registry.recordProcess(
      worktree,
      record.stackId,
      ["mailpitHttp", "mailpitSmtp"],
      next,
    ),
    /unresolved/,
  );
  assert.equal(
    await fs.readFile(path.join(registryPath, "registry.json"), "utf8"),
    before,
  );
});
