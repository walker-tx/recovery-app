const { test } = require("node:test");
const assert = require("node:assert/strict");
const { access } = require("node:fs/promises");
const { createProcessInspector } = require("./stack-process-inspector.cjs");

test("Darwin inspector compiles once in private disposable state and validates evidence", async () => {
  const calls = [];
  const evidence = {
    pid: 42,
    startedAt: "darwin:1234:56",
    worktree: "/owned/worktree",
  };
  const inspector = await createProcessInspector({
    platform: "darwin",
    exec: async (file, args, options) => {
      calls.push({ file, args, options });
      return {
        stdout: file === "/usr/bin/clang" ? "" : JSON.stringify(evidence),
      };
    },
  });
  try {
    assert.deepEqual(await inspector.inspect(42), evidence);
    assert.deepEqual(await inspector.inspect(42), evidence);
    assert.equal(
      calls.filter((call) => call.file === "/usr/bin/clang").length,
      1,
    );
    assert.ok(
      calls.every(
        (call) => call.options.timeout > 0 && call.options.maxBuffer <= 8192,
      ),
    );
    assert.ok(
      calls.every((call) =>
        Object.keys(call.options.env).every((key) =>
          ["PATH", "HOME", "TMPDIR"].includes(key),
        ),
      ),
    );
  } finally {
    await inspector.close();
  }
  await assert.rejects(access(calls[0].args.at(-1)));
  await assert.rejects(inspector.inspect(42), /closed/);
});

test("Darwin inspector preserves confirmed absence, rejects ambiguous or malformed evidence", async () => {
  let output = "null";
  const inspector = await createProcessInspector({
    platform: "darwin",
    exec: async (file) => ({ stdout: file === "/usr/bin/clang" ? "" : output }),
  });
  try {
    assert.equal(await inspector.inspect(42), null);
    for (const invalid of [
      "{}",
      "false",
      '{"pid":43,"startedAt":"darwin:1:1","worktree":"/owned"}',
      '{"pid":42,"startedAt":"x","worktree":"/owned"}',
      '{"pid":42,"startedAt":"darwin:1:1","worktree":"/a/../b"}',
    ]) {
      output = invalid;
      await assert.rejects(inspector.inspect(42), /identity/);
    }
    await assert.rejects(inspector.inspect(-1), /PID/);
  } finally {
    await inspector.close();
  }
});

test(
  "real wrapper inspects only a disposable child and cleans its compiler output",
  { skip: process.platform !== "darwin", timeout: 10000 },
  async () => {
    const { spawn } = require("node:child_process");
    const { once } = require("node:events");
    const { realpath } = require("node:fs/promises");
    const inspector = await createProcessInspector();
    const child = spawn(
      process.execPath,
      ["-e", 'process.stdout.write("ready");setInterval(()=>{},1000)'],
      { cwd: __dirname, env: {}, stdio: ["ignore", "pipe", "ignore"] },
    );
    const exited = once(child, "exit");
    try {
      await once(child.stdout, "data");
      const first = await inspector.inspect(child.pid);
      assert.equal(first.pid, child.pid);
      assert.equal(first.worktree, await realpath(__dirname));
      assert.deepEqual(await inspector.inspect(child.pid), first);
    } finally {
      child.kill("SIGTERM");
      await exited;
      await inspector.close();
    }
  },
);
test("unsupported OS and failed compilation are errors, never process absence", async () => {
  await assert.rejects(
    createProcessInspector({ platform: "unknown" }),
    /unsupported/,
  );
  await assert.rejects(
    createProcessInspector({
      platform: "darwin",
      exec: async () => {
        throw Error("synthetic-private-diagnostic");
      },
    }),
    { message: "Precise process inspector compilation failed" },
  );
});
