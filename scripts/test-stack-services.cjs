const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildStackServices,
  prepareOwnedStateDirectories,
} = require("./stack-services.cjs");
function fixture(t) {
  const worktree = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "stack-services-")),
  );
  t.after(() => fs.rmSync(worktree, { recursive: true, force: true }));
  fs.mkdirSync(path.join(worktree, "packages/backend"), { recursive: true });
  return {
    worktree,
    backendBinary: "/synthetic/convex",
    registry: {
      worktree,
      stackId: "11111111-1111-4111-8111-111111111111",
      providerGeneration: "22222222-2222-4222-8222-222222222222",
      ports: {
        convexCloud: 24001,
        convexSite: 24002,
        metro: 24003,
        provider: 24004,
        mailpitHttp: 24005,
        mailpitSmtp: 24006,
      },
    },
    seed: {
      LOCAL_CONVEX_INSTANCE_NAME: "local-test",
      LOCAL_CONVEX_INSTANCE_SECRET: "synthetic-secret",
      LOCAL_WORKOS_API_KEY: "sk_test_local_" + "a".repeat(64),
    },
  };
}
test("six endpoint definitions, loopback and explicit state", (t) => {
  const o = fixture(t),
    defs = buildStackServices(o);
  assert.deepEqual(
    defs.map((d) => d.name),
    [
      "convexCloud",
      "convexSite",
      "metro",
      "provider",
      "mailpitHttp",
      "mailpitSmtp",
    ],
  );
  const cloud = defs[0].command;
  assert.ok(cloud[0] === "/bin/sh" && cloud[2] === 'umask 077; exec "$@"');
  assert.ok(
    cloud.includes("--interface") &&
      cloud[cloud.indexOf("--interface") + 1] === "127.0.0.1",
  );
  assert.ok(
    cloud.includes("--disable-beacon") &&
      cloud.includes(
        path.join(
          o.worktree,
          "packages/backend/.convex/local/default/convex_local_backend.sqlite3",
        ),
      ),
  );
  assert.ok(JSON.stringify(cloud) === JSON.stringify(defs[1].command));
  assert.ok(
    defs[2].command.includes("--localhost") &&
      defs[2].command.includes("24003"),
  );
  assert.ok(defs[3].readiness.http === "http://127.0.0.1:24004/instance-info");
  assert.ok(defs[4].command.includes("127.0.0.1:24006"));
  assert.ok(!fs.existsSync(path.join(o.worktree, ".recovery-stack")));
});
test("Metro uses an explicit mobile project with its exact allocated port", (t) => {
  const options = fixture(t);
  options.registry.ports.metro = 25379;
  const metro = buildStackServices(options).find(
    (service) => service.name === "metro",
  );
  assert.deepEqual(metro.command.slice(4), [
    "node",
    path.join(options.worktree, "apps/mobile/node_modules/expo/bin/cli"),
    "start",
    path.join(options.worktree, "apps/mobile"),
    "--localhost",
    "--port",
    "25379",
  ]);
  assert.equal(metro.readiness.http, "http://127.0.0.1:25379/status");
});

test("service cwd gives the inspector canonical root ownership", async (t) => {
  const { createRegistry } = require("./stack-registry.cjs");
  const options = fixture(t);
  const processes = new Map();
  const registry = createRegistry({
    registryPath: path.join(options.worktree, "registry"),
    portAvailable: async () => true,
    inspectProcess: async (pid) => processes.get(pid) ?? null,
  });
  options.registry = await registry.reserve(options.worktree);
  let pid = 100;
  for (const service of buildStackServices(options)) {
    // Model the real inspector: ownership is the launched process's cwd.
    const identity = {
      pid: ++pid,
      startedAt: `fake-start-${pid}`,
      worktree: service.cwd,
      stackId: options.registry.stackId,
    };
    processes.set(identity.pid, identity);
    await registry.recordProcess(
      options.worktree,
      options.registry.stackId,
      service.name,
      identity,
    );
    assert.equal(service.cwd, options.worktree);
  }
  const status = await registry.status(options.worktree);
  for (const state of Object.values(status.services))
    assert.equal(state, "running");
});

for (const kind of ["relative", "worktree", "ports", "seed"])
  test(`rejects ${kind} safely`, (t) => {
    const o = fixture(t);
    if (kind === "relative") o.backendBinary = "relative";
    if (kind === "worktree") o.registry.worktree = "/other";
    if (kind === "ports") o.registry.ports.metro = 24001;
    if (kind === "seed") o.seed.LOCAL_CONVEX_INSTANCE_SECRET = "";
    assert.throws(
      () => buildStackServices(o),
      (e) => e.message === "Local stack service definitions rejected",
    );
  });
test("private marked state resumes and refuses generation mismatch", (t) => {
  const o = fixture(t),
    state = prepareOwnedStateDirectories(o);
  assert.ok((fs.statSync(state.backend).mode & 0o777) === 0o700);
  assert.ok(
    fs.existsSync(path.join(state.backend, ".recovery-stack-owner.json")),
  );
  assert.ok(prepareOwnedStateDirectories(o).backend === state.backend);
  o.registry.providerGeneration = "33333333-3333-4333-8333-333333333333";
  assert.throws(() => prepareOwnedStateDirectories(o));
});
for (const kind of ["nonempty", "symlink", "permissions"])
  test(`refuses unsafe ${kind} backend state`, (t) => {
    const o = fixture(t),
      dir = path.join(o.worktree, "packages/backend/.convex/local/default");
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    if (kind === "symlink") fs.symlinkSync(o.worktree, dir);
    else {
      fs.mkdirSync(dir, { mode: 0o700 });
      if (kind === "nonempty")
        fs.writeFileSync(path.join(dir, "staging.sqlite"), "fixture");
      else fs.chmodSync(dir, 0o755);
    }
    assert.throws(() => prepareOwnedStateDirectories(o));
  });
test("refuses unsafe existing data files inside marked state", (t) => {
  const o = fixture(t),
    state = prepareOwnedStateDirectories(o);
  fs.symlinkSync(
    path.join(o.worktree, "outside"),
    path.join(state.root, "mailpit.sqlite"),
  );
  assert.throws(() => prepareOwnedStateDirectories(o));
});
