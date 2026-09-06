const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { persistLocalConfig } = require("./stack-local-config.cjs");
const { buildStackConfiguration } = require("./stack-configuration.cjs");
const stackId = "11111111-1111-4111-8111-111111111111";
const providerGeneration = "22222222-2222-4222-8222-222222222222";
const ports = {
  convexCloud: 3210,
  convexSite: 3211,
  metro: 8081,
  provider: 4100,
  mailpitHttp: 8025,
  mailpitSmtp: 1025,
};
const owned = buildStackConfiguration({
  registry: { stackId, providerGeneration, ports },
  bootstrap: {
    providerGeneration,
    clientId: `client_local${providerGeneration.replaceAll("-", "")}`,
    issuer: `https://local-workos.invalid/instances/${providerGeneration}`,
    port: 4100,
  },
  credentials: {
    stackId,
    providerGeneration,
    apiKey: `sk_test_local_${"a".repeat(64)}`,
  },
}).owned;
function fixture(t) {
  const dir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "stack-config-")),
  );
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "mise.local.toml");
  const run = (args, input) =>
    spawnSync("mise", args, {
      cwd: dir,
      env: {
        PATH: process.env.PATH,
        HOME: dir,
        MISE_TRUSTED_CONFIG_PATHS: dir,
      },
      input,
      encoding: "utf8",
      timeout: 5000,
    });
  return { dir, file, run };
}
test("real Mise scalar reads are raw strings; missing is nonzero", (t) => {
  const { file, run } = fixture(t);
  fs.writeFileSync(file, "[env]\nQUOTE = 'a\"b'\n", { mode: 0o600 });
  assert.equal(
    run(["config", "get", "--file", file, "env.QUOTE"]).stdout,
    'a"b\n',
  );
  const missing = run(["config", "get", "--file", file, "env.MISSING"]);
  assert.ok(
    missing.status === 1 &&
      !missing.error &&
      missing.stdout === "" &&
      missing.stderr ===
        "mise ERROR Key not found: env.MISSING in ~/mise.local.toml\nmise ERROR Version: 2026.8.8 macos-arm64 (2026-08-17)\nmise ERROR Run with --verbose or MISE_VERBOSE=1 for more information\n",
  );
});
test("new private config then matching update preserves unrelated comments", (t) => {
  const { file, run } = fixture(t);
  persistLocalConfig({ file, owned, run });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  fs.appendFileSync(file, '\n# unrelated comment\nUNRELATED = "keep"\n');
  persistLocalConfig({ file, owned, run });
  assert.ok(fs.readFileSync(file, "utf8").includes("# unrelated comment"));
  assert.equal(
    run(["config", "get", "--file", file, "env.UNRELATED"]).stdout,
    "keep\n",
  );
  assert.ok(
    run(["config", "get", "--file", file, "env.LOCAL_WORKOS_API_KEY"])
      .stdout ===
      owned.LOCAL_WORKOS_API_KEY + "\n",
  );
});
test("rejects unowned, nonprivate and symlink targets without changes", (t) => {
  const { file, run, dir } = fixture(t);
  fs.writeFileSync(file, '# staging\n[env]\nOTHER = "keep"\n', { mode: 0o600 });
  const before = fs.readFileSync(file);
  assert.throws(() => persistLocalConfig({ file, owned, run }));
  assert.ok(fs.readFileSync(file).equals(before));
  fs.chmodSync(file, 0o644);
  assert.throws(() => persistLocalConfig({ file, owned, run }));
  assert.equal(fs.statSync(file).mode & 0o777, 0o644);
  fs.renameSync(file, path.join(dir, "other"));
  fs.symlinkSync(path.join(dir, "other"), file);
  assert.throws(() => persistLocalConfig({ file, owned, run }));
  assert.ok(fs.lstatSync(file).isSymbolicLink());
});
test("validates entire map before writing and leaves target untouched on failure", (t) => {
  const { file, run } = fixture(t);
  persistLocalConfig({ file, owned, run });
  const before = fs.readFileSync(file);
  assert.throws(() =>
    persistLocalConfig({ file, owned: { ...owned, UNOWNED: "bad" }, run }),
  );
  assert.throws(() =>
    persistLocalConfig({
      file,
      owned,
      run: (args, input) =>
        args[0] === "set" ? { status: 1 } : run(args, input),
    }),
  );
  assert.ok(fs.readFileSync(file).equals(before));
});
test("detects concurrent content or symlink replacement and lock contention", (t) => {
  const { file, run } = fixture(t);
  persistLocalConfig({ file, owned, run });
  let changed = false;
  const racing = (args, input) => {
    const result = run(args, input);
    if (args[0] === "set" && !changed) {
      changed = true;
      fs.appendFileSync(file, "\n# concurrent\n");
    }
    return result;
  };
  assert.throws(() => persistLocalConfig({ file, owned, run: racing }));
  assert.ok(fs.readFileSync(file, "utf8").endsWith("# concurrent\n"));
  changed = false;
  const replacing = (args, input) => {
    const result = run(args, input);
    if (args[0] === "set" && !changed) {
      changed = true;
      fs.renameSync(file, file + ".saved");
      fs.symlinkSync(file + ".saved", file);
    }
    return result;
  };
  assert.throws(() => persistLocalConfig({ file, owned, run: replacing }));
  assert.ok(fs.lstatSync(file).isSymbolicLink());
  fs.mkdirSync(file + ".lock");
  assert.throws(() => persistLocalConfig({ file, owned, run }));
  assert.ok(fs.existsSync(file + ".lock"));
});
test("default runner works without ambient config and rejects ownership mismatch", (t) => {
  const { file, run } = fixture(t);
  persistLocalConfig({ file, owned });
  const before = fs.readFileSync(file);
  assert.throws(() =>
    persistLocalConfig({
      file,
      owned: { ...owned, LOCAL_WORKOS_API_KEY: "invalid" },
      run,
    }),
  );
  assert.ok(fs.readFileSync(file).equals(before));
  const changed = fs
    .readFileSync(file, "utf8")
    .replace(stackId, "33333333-3333-4333-8333-333333333333");
  fs.writeFileSync(file, changed);
  assert.throws(() => persistLocalConfig({ file, owned, run }));
  assert.ok(fs.readFileSync(file, "utf8") === changed);
});

for (const key of [
  "CONVEX_DEPLOY_KEY",
  "CONVEX_DEPLOYMENT",
  "CONVEX_SELF_HOSTED_ADMIN_KEY",
  "WORKOS_ADMIN_API_KEY",
])
  test(`rejects existing quoted ${key} before temporary mutation`, (t) => {
    const { file, run, dir } = fixture(t);
    persistLocalConfig({ file, owned, run });
    fs.appendFileSync(file, `\n"${key}" = "synthetic"\n`);
    const before = fs.readFileSync(file);
    let temporarySeen = false;
    const guarded = (args, input) => {
      temporarySeen ||= fs
        .readdirSync(dir)
        .some((name) => name.startsWith(".stack-config-"));
      return run(args, input);
    };
    assert.throws(() => persistLocalConfig({ file, owned, run: guarded }));
    assert.ok(!temporarySeen);
    assert.ok(fs.readFileSync(file).equals(before));
  });
test("unexpected forbidden-key read failure fails closed without temporary mutation", (t) => {
  const { file, run, dir } = fixture(t);
  persistLocalConfig({ file, owned, run });
  const before = fs.readFileSync(file);
  let injected = false;
  const failing = (args, input) => {
    if (args.at(-1) === "env.CONVEX_DEPLOY_KEY") {
      injected = true;
      assert.ok(
        !fs.readdirSync(dir).some((name) => name.startsWith(".stack-config-")),
      );
      return { status: 1, stdout: "", stderr: "unexpected synthetic failure" };
    }
    return run(args, input);
  };
  assert.throws(() => persistLocalConfig({ file, owned, run: failing }));
  assert.ok(injected);
  assert.ok(fs.readFileSync(file).equals(before));
});

for (const existing of [false, true]) {
  test(`elapsed preparation deadline prevents publication (existing=${existing})`, (t) => {
    const { file, dir } = fixture(t);
    const before = Buffer.from("[env]\n# unchanged\n");
    if (existing) fs.writeFileSync(file, before, { mode: 0o600 });
    let clock = 0;
    const values = {
      RECOVERY_STACK_ID: stackId,
      RECOVERY_PROVIDER_GENERATION: providerGeneration,
    };
    const run = (args, input) => {
      const key = args.at(-1).replace(/^env\./, "");
      if (args[0] === "set") {
        values[key] = input;
        clock = 10;
        return { status: 0, stdout: "" };
      }
      if (Object.hasOwn(values, key))
        return { status: 0, stdout: values[key] + "\n" };
      return {
        status: 1,
        stdout: "",
        stderr: `mise ERROR Key not found: env.${key} in ${file}\nmise ERROR Version: fake\nmise ERROR Run with --verbose or MISE_VERBOSE=1 for more information\n`,
      };
    };
    assert.throws(
      () =>
        persistLocalConfig({
          file,
          owned,
          run,
          deadlineMs: 10,
          now: () => clock,
        }),
      (error) =>
        error.ambiguousTimeout === true &&
        error.message === "Local stack config persistence rejected",
    );
    if (existing) assert.deepEqual(fs.readFileSync(file), before);
    else assert.equal(fs.existsSync(file), false);
    assert.deepEqual(fs.readdirSync(dir), existing ? ["mise.local.toml"] : []);
  });
}
