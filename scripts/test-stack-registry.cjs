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
test("release stays unavailable even with stopped processes and free ports", async (t) => {
  const { registry, worktree, sibling } = await fixture(t);
  const a = await registry.reserve(worktree);
  const b = await registry.reserve(sibling);
  await assert.rejects(registry.release(worktree, b.stackId), /ownership/);
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(
      registry.release(worktree, a.stackId),
      /release unavailable.*domain teardown/,
    );
    assert.equal((await registry.reserve(worktree)).stackId, a.stackId);
    assert.equal((await registry.status(sibling)).stackId, b.stackId);
  }
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
  await assert.rejects(
    registry.release(worktree, a.stackId),
    /release unavailable/,
  );
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
test("replaced stopped directory renews resource pin and retains identity", async (t) => {
  const { registry, worktree } = await fixture(t);
  const a = await registry.reserve(worktree);
  await fs.rename(worktree, worktree + "-old");
  await fs.mkdir(worktree);
  await assert.rejects(registry.readOwned(worktree, a.stackId), /ownership/);
  await assert.rejects(registry.release(worktree, a.stackId), /ownership/);
  const b = await registry.reserve(worktree);
  assert.equal(b.stackId, a.stackId);
  assert.equal(b.providerGeneration, a.providerGeneration);
  assert.deepEqual(b.ports, a.ports);
  assert.notEqual(b.owner, a.owner);
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
  await assert.rejects(
    registry.release(worktree, a.stackId),
    /release unavailable/,
  );
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

for (const args of [
  ["status", "unexpected-uuid"],
  ["reserve", "unexpected-uuid"],
  ["release", "uuid", "extra"],
]) {
  test(`registry CLI rejects unexpected operands: ${args.join(" ")}`, async (t) => {
    const { spawnSync } = require("node:child_process");
    const { worktree } = await fixture(t);
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, "stack-registry.cjs"), ...args],
      { cwd: worktree, encoding: "utf8", timeout: 3000 },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /^Usage:/);
    assert.equal(result.stdout, "");
  });
}

for (const alias of [false, true]) {
  test(`canonical regular-file worktree rejects before registry creation (alias=${alias})`, async (t) => {
    const f = await fixture(t);
    const file = path.join(f.worktree, "file");
    await fs.writeFile(file, "untouched");
    const selected = alias ? path.join(f.worktree, "alias") : file;
    if (alias) {
      await fs.symlink(file, selected);
    }
    await assert.rejects(
      f.registry.reserve(selected),
      /Worktree must be a directory/,
    );
    await assert.rejects(fs.stat(f.registryPath), { code: "ENOENT" });
    assert.equal(await fs.readFile(file, "utf8"), "untouched");
  });
}

test("concurrent same-name paths have one winner; separate registries allow names", async (t) => {
  const { registry, registryPath, worktree, sibling } = await fixture(t);
  const other = path.join(sibling, path.basename(worktree));
  await fs.mkdir(other);
  const results = await Promise.allSettled([
    registry.reserve(worktree),
    registry.reserve(other),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.match(
    results.find((r) => r.status === "rejected").reason.message,
    /name/,
  );
  const loser = results[0].status === "rejected" ? worktree : other;
  await assert.rejects(registry.reserve(loser), /name/);
  await createRegistry({
    registryPath: registryPath + "-other",
    portAvailable: async () => true,
  }).reserve(loser);
});

test("duplicate persisted names fail closed", async (t) => {
  const { registry, registryPath, worktree, sibling } = await fixture(t);
  const a = await registry.reserve(worktree);
  const b = await registry.reserve(sibling);
  const file = path.join(registryPath, "registry.json");
  const data = JSON.parse(await fs.readFile(file, "utf8"));
  delete data.stacks[b.worktree];
  const duplicate = path.join(b.worktree, path.basename(a.worktree));
  data.stacks[duplicate] = { ...b, worktree: duplicate };
  const contents = JSON.stringify(data);
  await fs.writeFile(file, contents);
  await assert.rejects(registry.reserve(worktree), /Invalid reservation/);
  assert.equal(await fs.readFile(file, "utf8"), contents);
});

test("replacement cannot adopt live, mismatched, unknown or occupied resources", async (t) => {
  let actual = null;
  let free = true;
  const { registry, worktree, registryPath } = await fixture(t, {
    inspectProcess: async () => actual,
    portAvailable: async () => free,
  });
  const a = await registry.reserve(worktree);
  const identity = {
    pid: 987,
    startedAt: "boot:1",
    stackId: a.stackId,
    worktree: a.worktree,
  };
  actual = identity;
  await registry.recordProcess(worktree, a.stackId, "metro", identity);
  assert.equal((await registry.reserve(worktree)).stackId, a.stackId);
  await fs.rename(worktree, worktree + "-old");
  await fs.mkdir(worktree);
  const file = path.join(registryPath, "registry.json");
  const before = await fs.readFile(file, "utf8");
  for (const value of [
    identity,
    { ...identity, startedAt: "other" },
    undefined,
  ]) {
    actual = value;
    await assert.rejects(registry.reserve(worktree));
    assert.equal(await fs.readFile(file, "utf8"), before);
  }
  actual = null;
  for (const value of [false, undefined, "unknown", {}]) {
    free = value;
    await assert.rejects(registry.reserve(worktree));
    assert.equal(await fs.readFile(file, "utf8"), before);
  }
  free = true;
  assert.equal((await registry.reserve(worktree)).stackId, a.stackId);
});

test("port probes require strict true", async (t) => {
  let free = true;
  const { registry, worktree } = await fixture(t, {
    portAvailable: async (port) => (port === 24000 ? "unknown" : free),
  });
  const a = await registry.reserve(worktree);
  assert.equal(a.ports.convexCloud, 24001);
  for (const value of [undefined, null, "unknown", {}, 1]) {
    free = value;
    await assert.rejects(registry.reserve(worktree), /occupied/);
  }
});

test("Git common-directory resolution refuses legacy name claims", async (t) => {
  const { worktree, sibling } = await fixture(t);
  const run = require("node:util").promisify(
    require("node:child_process").execFile,
  );
  const git = (args) => run("git", args, { cwd: worktree, timeout: 3000 });
  await git(["init", "--quiet"]);
  await git([
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--allow-empty",
    "-qm",
    "fixture",
  ]);
  const linked = path.join(sibling, "linked");
  await git(["worktree", "add", "--quiet", "-b", "linked", linked]);
  const home = path.join(sibling, "home");
  const resolve = (target) =>
    run(
      process.execPath,
      [
        "-e",
        `require(process.argv[1]).resolveRegistryPath(process.argv[2]).then(console.log).catch(e=>{console.error(e.message);process.exitCode=1})`,
        require.resolve("./stack-registry.cjs"),
        target,
      ],
      { env: { ...process.env, HOME: home }, timeout: 3000 },
    );
  const expected = path.join(
    await fs.realpath(worktree),
    ".git",
    "recovery-stacks",
  );
  assert.equal((await resolve(worktree)).stdout.trim(), expected);
  assert.equal((await resolve(linked)).stdout.trim(), expected);
  const subdirectory = path.join(worktree, "nested");
  await fs.mkdir(subdirectory);
  await assert.rejects(resolve(subdirectory), /worktree root/i);
  const alias = path.join(sibling, "alias");
  await fs.symlink(worktree, alias);
  assert.equal((await resolve(alias)).stdout.trim(), expected);
  const legacy = path.join(home, ".local", "state", "recovery", "stacks");
  const registry = createRegistry({
    registryPath: legacy,
    portAvailable: async () => true,
  });
  const other = path.join(sibling, path.basename(worktree));
  await fs.mkdir(other);
  await registry.reserve(other);
  const file = path.join(legacy, "registry.json");
  const before = await fs.readFile(file, "utf8");
  await assert.rejects(resolve(worktree), /legacy/i);
  assert.equal(await fs.readFile(file, "utf8"), before);
  assert.equal((await resolve(linked)).stdout.trim(), expected);
});
