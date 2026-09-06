const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { prepareBootstrapSeed } = require("./stack-bootstrap-seed.cjs");
const { persistLocalConfig } = require("./stack-local-config.cjs");
const { buildStackConfiguration } = require("./stack-configuration.cjs");
function fixture(t) {
  const worktree = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "stack-seed-")),
  );
  t.after(() => fs.rmSync(worktree, { recursive: true, force: true }));
  const registry = {
    worktree,
    stackId: "11111111-1111-4111-8111-111111111111",
    providerGeneration: "22222222-2222-4222-8222-222222222222",
    ports: {
      convexCloud: 3210,
      convexSite: 3211,
      provider: 4100,
      metro: 8081,
      mailpitHttp: 8025,
      mailpitSmtp: 1025,
    },
  };
  let calls = 0;
  const options = {
    registry,
    file: path.join(worktree, "mise.local.toml"),
    backendBinary: "/synthetic/backend",
    exec: (binary, args) => {
      calls++;
      assert.ok(
        binary === "/synthetic/backend" &&
          args[0] === "keygen" &&
          args[1] === "admin-key" &&
          args[2] === "--instance-name" &&
          args[4] === "--instance-secret",
      );
      return { status: 0, stdout: "synthetic-admin-key\n" };
    },
  };
  return { options, calls: () => calls };
}
test("absent config prepares private seeds, resumes unchanged, then preserves seeds in ready config", (t) => {
  const { options, calls } = fixture(t);
  const seed = prepareBootstrapSeed(options);
  assert.ok(
    calls() === 1 &&
      Object.keys(seed).length === 8 &&
      !Object.keys(seed).some((k) => k.startsWith("EXPO_")),
  );
  assert.ok(/^sk_test_local_[a-f0-9]{64}$/.test(seed.LOCAL_WORKOS_API_KEY));
  assert.ok(Buffer.from(seed.WORKOS_EMAIL_HMAC_KEY, "base64").length === 32);
  fs.appendFileSync(options.file, '\n# unrelated\nUNRELATED = "keep"\n');
  const before = fs.readFileSync(options.file);
  const resumed = prepareBootstrapSeed(options);
  assert.ok(
    JSON.stringify(resumed) === JSON.stringify(seed) &&
      calls() === 1 &&
      fs.readFileSync(options.file).equals(before),
  );
  const { registry } = options;
  const owned = buildStackConfiguration({
    registry,
    bootstrap: {
      providerGeneration: registry.providerGeneration,
      clientId: `client_local${registry.providerGeneration.replaceAll("-", "")}`,
      issuer: `https://local-workos.invalid/instances/${registry.providerGeneration}`,
      port: 4100,
    },
    credentials: {
      stackId: registry.stackId,
      providerGeneration: registry.providerGeneration,
      apiKey: seed.LOCAL_WORKOS_API_KEY,
    },
  }).owned;
  persistLocalConfig({ file: options.file, owned });
  assert.ok(
    JSON.stringify(prepareBootstrapSeed(options)) === JSON.stringify(seed) &&
      calls() === 1,
  );
  assert.ok(fs.readFileSync(options.file, "utf8").includes("# unrelated"));
});
test("keygen failures are sanitized and publish nothing", (t) => {
  const { options } = fixture(t);
  assert.throws(
    () =>
      prepareBootstrapSeed({
        ...options,
        exec: () => {
          throw Error("synthetic-sensitive-argv");
        },
      }),
    (e) => e.message === "Local stack bootstrap seed rejected",
  );
  assert.ok(!fs.existsSync(options.file));
});
for (const kind of [
  "unowned",
  "partial",
  "generation",
  "forbidden",
  "unsafe",
  "read-failure",
])
  test(`rejects ${kind} without regenerating`, (t) => {
    const { options, calls } = fixture(t);
    if (kind === "unowned")
      fs.writeFileSync(options.file, '[env]\nOTHER="keep"\n', { mode: 0o600 });
    else prepareBootstrapSeed(options);
    if (kind === "partial")
      fs.writeFileSync(
        options.file,
        fs
          .readFileSync(options.file, "utf8")
          .replace(/^LOCAL_CONVEX_ADMIN_KEY.*\n/m, ""),
      );
    if (kind === "generation")
      options.registry = {
        ...options.registry,
        providerGeneration: "33333333-3333-4333-8333-333333333333",
      };
    if (kind === "forbidden")
      fs.appendFileSync(options.file, '\nCONVEX_DEPLOY_KEY="synthetic"\n');
    if (kind === "unsafe") fs.chmodSync(options.file, 0o644);
    if (kind === "read-failure")
      options.run = () => ({ status: 1, stdout: "", stderr: "unexpected" });
    const before = fs.readFileSync(options.file);
    const count = calls();
    assert.throws(() => prepareBootstrapSeed(options));
    assert.ok(
      calls() === count && fs.readFileSync(options.file).equals(before),
    );
  });
for (const output of ["", "  ", "bad\nsecond\n", "x".repeat(4097)])
  test("invalid keygen output cannot publish config", (t) => {
    const { options } = fixture(t);
    assert.throws(() =>
      prepareBootstrapSeed({
        ...options,
        exec: () => ({ status: 0, stdout: output }),
      }),
    );
    assert.ok(!fs.existsSync(options.file));
  });
test("ready persistence rejects partial seed and seed replacement", (t) => {
  const { options } = fixture(t);
  const seed = prepareBootstrapSeed(options);
  assert.throws(() =>
    persistLocalConfig({
      file: options.file,
      owned: {
        ...seed,
        WORKOS_EMAIL_HMAC_KEY: Buffer.alloc(32, 7).toString("base64"),
      },
    }),
  );
  fs.writeFileSync(
    options.file,
    fs
      .readFileSync(options.file, "utf8")
      .replace(/^LOCAL_CONVEX_INSTANCE_NAME.*\n/m, ""),
  );
  assert.throws(() => persistLocalConfig({ file: options.file, owned: seed }));
});
