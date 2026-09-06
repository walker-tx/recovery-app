const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createPitchforkRunner,
  inspectLinuxProcess,
} = require("./stack-adapters.cjs");
test("runner bounds execFile, preserves env and suppresses output", async () => {
  let seen;
  const run = createPitchforkRunner({
    exec: async (...args) => {
      seen = args;
      return { stdout: "secret" };
    },
  });
  assert.equal(
    await run("pitchfork", ["stop", "recovery-local/recovery-owned-provider"], {
      cwd: "/tmp",
      env: { RECOVERY_STACK_ID: "owned" },
      timeoutMs: 50,
    }),
    undefined,
  );
  assert.equal(seen[0], "pitchfork");
  assert.equal(seen[2].timeout, 50);
  assert.equal(seen[2].shell, false);
  assert.equal(seen[2].env.RECOVERY_STACK_ID, "owned");
  assert.equal(seen[2].killSignal, "SIGKILL");
});
test("runner redacts failures and retains timeout ambiguity", async () => {
  const run = createPitchforkRunner({
    exec: async () => {
      throw Object.assign(Error("credential"), { killed: true });
    },
  });
  await assert.rejects(
    run("pitchfork", ["stop", "recovery-local/recovery-owned-provider"]),
    (e) => e.ambiguousTimeout === true && !e.message.includes("credential"),
  );
});
test("runner refuses broad operations and pre-aborted calls", async () => {
  let calls = 0;
  const run = createPitchforkRunner({
    exec: async () => {
      calls++;
    },
  });
  await assert.rejects(run("pitchfork", ["stop", "--all"]));
  await assert.rejects(
    run("sh", ["stop", "recovery-local/recovery-owned-provider"]),
  );
  await assert.rejects(
    run("pitchfork", ["stop", "recovery-local/recovery-owned-provider"], {
      signal: AbortSignal.abort(),
    }),
  );
  assert.equal(calls, 0);
});
test("runner never inherits auth credentials or public destinations from its parent", async () => {
  let seen;
  const run = createPitchforkRunner({
    baseEnv: {
      PATH: "/bin",
      HOME: "/owned",
      WORKOS_API_KEY: "synthetic-real-provider-placeholder",
      EXPO_PUBLIC_CONVEX_URL: "https://wrong.invalid",
      NODE_OPTIONS: "--inspect",
    },
    exec: async (...args) => {
      seen = args[2].env;
    },
  });
  await run("pitchfork", ["stop", "recovery-local/recovery-owned-provider"], {
    env: { RECOVERY_STACK_ID: "owned" },
  });
  assert.ok(
    Object.keys(seen).sort().join(",") === "HOME,PATH,RECOVERY_STACK_ID",
    "Unexpected inherited environment keys",
  );
  assert.ok(
    seen.PATH === "/bin" &&
      seen.HOME === "/owned" &&
      seen.RECOVERY_STACK_ID === "owned",
    "Explicit environment not preserved",
  );
});
test("runner rejects inherited cloud deployment credentials before starting", async () => {
  let calls = 0;
  const args = [
    "run",
    "recovery-local/recovery-owned-provider",
    "--http",
    "http://127.0.0.1:4100/health",
    "--expected-port",
    "4100",
    "--",
    "provider",
  ];
  for (const baseEnv of [
    { CONVEX_DEPLOY_KEY: "synthetic-cloud-placeholder" },
    { CONVEX_DEPLOYMENT: "prod:placeholder" },
  ]) {
    const run = createPitchforkRunner({
      baseEnv,
      exec: async () => {
        calls++;
      },
    });
    await assert.rejects(run("pitchfork", args), /inherited.*deployment/i);
  }
  assert.equal(calls, 0);
});
const stat = (ticks) =>
  `42 (name with ) spaces) S ${Array(18).fill("0").join(" ")} ${ticks} 0`;
test("Linux identity uses boot ID + start ticks and observed cwd, never environment", async () => {
  const reads = [];
  const io = {
    readFile: async (p) => {
      reads.push(p);
      return p.endsWith("/stat") ? stat("987654321") : "boot-id\n";
    },
    readlink: async () => "/worktree",
  };
  assert.deepEqual(await inspectLinuxProcess(42, { io }), {
    pid: 42,
    startedAt: "linux:boot-id:987654321",
    worktree: "/worktree",
  });
  assert.ok(reads.every((p) => !p.includes("environ")));
});
test("identity refuses PID reuse and inaccessible processes", async () => {
  let count = 0;
  await assert.rejects(
    inspectLinuxProcess(42, {
      io: {
        readFile: async (p) =>
          p.endsWith("/stat") ? stat(String(++count)) : "boot",
        readlink: async () => "/worktree",
      },
    }),
    /changed/,
  );
  await assert.rejects(
    inspectLinuxProcess(42, { io: { readFile: async () => "bad" } }),
  );
  await assert.rejects(
    inspectLinuxProcess(42, {
      io: {
        readFile: async () => {
          throw Object.assign(Error("private"), { code: "EACCES" });
        },
      },
    }),
    /inspect/,
  );
  assert.equal(
    await inspectLinuxProcess(42, {
      io: {
        readFile: async () => {
          throw Object.assign(Error(), { code: "ENOENT" });
        },
      },
    }),
    null,
  );
});
test("runner forwards only the supported start contract without force or bump", async () => {
  let actual;
  const run = createPitchforkRunner({
    exec: async (_, args) => {
      actual = args;
    },
  });
  const args = [
    "run",
    "recovery-local/recovery-owned-provider",
    "--http",
    "http://127.0.0.1:4100/health",
    "--expected-port",
    "4100",
    "--",
    "provider",
    "--port",
    "4100",
  ];
  await run("pitchfork", args);
  assert.deepEqual(actual, args);
  await assert.rejects(
    run("pitchfork", [
      "run",
      "recovery-local/recovery-owned-provider",
      "--force",
      "--",
      "provider",
    ]),
  );
});
test("unsupported host inspection fails closed rather than using second-resolution ps", async () => {
  await assert.rejects(
    inspectLinuxProcess(42, { platform: "darwin" }),
    /unsupported/,
  );
});
