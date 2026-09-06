const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

test("opt-in Mise stack tasks forward exact argv without starting services", async (t) => {
  const config = await fs.readFile(path.join(__dirname, "../mise.toml"), "utf8");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "stack-entrypoints-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, "node"),
    `#!${process.execPath}\nprocess.stdout.write(JSON.stringify(process.argv.slice(2)));\n`,
    { mode: 0o755 });
  // Only copy task declarations: never load repository tools, secrets or hooks.
  const tasks = ["start", "status", "stop"].map((command) => {
    const header = `[tasks."stack:${command}"]`;
    assert.ok(config.includes(header), `missing stack:${command} task`);
    return header + config.split(header)[1].split("\n[")[0];
  });
  await fs.writeFile(path.join(root, "mise.toml"), tasks.join("\n"));
  const mise = execFileSync("which", ["mise"], { encoding: "utf8" }).trim();
  const env = {
    HOME: root,
    XDG_CONFIG_HOME: root,
    XDG_DATA_HOME: root,
    XDG_CACHE_HOME: root,
    PATH: `${bin}:/usr/bin:/bin`,
    MISE_TRUSTED_CONFIG_PATHS: root,
    MISE_AUTO_INSTALL: "false",
    MISE_NO_ENV: "1",
    MISE_NO_HOOKS: "1",
  };
  for (const [command, argument] of [
    ["start", "/tmp/Convex binary 'quoted' $literal;not-a-command"],
    ["status", "6c64e416-fd56-4afd-917b-bcebc51d169f"],
    ["stop", "ae3458fa-c244-45bb-b343-f0bf91ded5ca"],
  ]) {
    const output = execFileSync(mise, ["run", "--quiet", `stack:${command}`, "--", argument],
      { cwd: root, env, encoding: "utf8", timeout: 15000 });
    assert.deepEqual(JSON.parse(output), ["scripts/stack-runtime.cjs", command, argument]);
  }
});
