const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

// Tests the wrapper's process contract. Real provider/CLI behavior belongs to
// package integration tests; this synthetic entry point does not prove it.
function fixture(t) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "mock wrapper ")),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.mkdirSync(path.join(root, "packages/local-workos/src"), {
    recursive: true,
  });
  fs.mkdirSync(path.join(root, "nested/child"), { recursive: true });
  const wrapper = path.join(root, "scripts/mock.sh");
  assert.ok(
    fs.existsSync(path.join(__dirname, "mock.sh")),
    "package-owned wrapper must exist",
  );
  fs.copyFileSync(path.join(__dirname, "mock.sh"), wrapper);
  fs.writeFileSync(
    path.join(root, "packages/local-workos/src/mock.ts"),
    `
import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
const record = JSON.stringify({ cwd: process.cwd(), args, input: readFileSync(0, "utf8") }) + "\\n";
if (args.includes("--fail")) {
  process.stderr.write(record);
  process.exitCode = 5;
} else {
  process.stdout.write(record);
}
`,
  );
  return { root, wrapper, nested: path.join(root, "nested/child") };
}

function invoke(f, args, cwd, originalCwd) {
  return spawnSync("/bin/sh", [f.wrapper, ...args], {
    cwd,
    input: "exact synthetic password\n",
    encoding: "utf8",
    timeout: 5000,
    env: {
      PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
      ...(originalCwd === undefined ? {} : { MISE_ORIGINAL_CWD: originalCwd }),
    },
  });
}

test("wrapper restores Mise's original nested cwd without banners or argument changes", (t) => {
  const f = fixture(t);
  const args = [
    "users",
    "create",
    "--first-name",
    "Name with spaces",
    "--json",
  ];
  const result = invoke(f, args, f.root, f.nested);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.deepEqual(JSON.parse(result.stdout), {
    cwd: f.nested,
    args,
    input: "exact synthetic password\n",
  });
});

test("direct wrapper preserves cwd, closed stdin, failure stream and exit code", (t) => {
  const f = fixture(t);
  const result = invoke(f, ["--fail", "--worktree", f.root], f.nested);
  assert.equal(result.status, 5);
  assert.equal(result.stdout, "");
  assert.deepEqual(JSON.parse(result.stderr), {
    cwd: f.nested,
    args: ["--fail", "--worktree", f.root],
    input: "exact synthetic password\n",
  });
});
