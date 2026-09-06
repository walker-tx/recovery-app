// Official v2.22.0 src/cli/{list,json_output}.rs: successful list JSON is an
// array, qualified IDs are namespace/name. No private state/config reads.
const { execFile } = require("node:child_process");
const { promisify, isDeepStrictEqual } = require("node:util");
const path = require("node:path");
const namespace = "recovery-local";
const serviceId =
  /^recovery-local\/recovery-([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-(convexCloud|convexSite|metro|provider|mailpitHttp|mailpitSmtp)$/;
const failure = () => Error("Pitchfork identity unavailable or mismatched");
function createPitchforkIdentity({
  inspectOS,
  exec = promisify(execFile),
  baseEnv = process.env,
  cwd,
  timeoutMs = 5000,
}) {
  if (
    typeof inspectOS !== "function" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > 30000
  )
    throw failure();
  const env = Object.fromEntries(
    [
      "PATH",
      "HOME",
      "USER",
      "LOGNAME",
      "TMPDIR",
      "XDG_CACHE_HOME",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
      "XDG_STATE_HOME",
      "XDG_RUNTIME_DIR",
    ]
      .filter((k) => baseEnv[k] !== undefined)
      .map((k) => [k, baseEnv[k]]),
  );
  async function query(args, signal) {
    try {
      if (signal?.aborted) throw failure();
      const { stdout } = await exec("pitchfork", args, {
        cwd,
        env,
        signal,
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 65536,
        shell: false,
      });
      if (typeof stdout !== "string" || Buffer.byteLength(stdout) > 65536)
        throw failure();
      return stdout;
    } catch {
      throw failure();
    }
  }
  async function list(signal) {
    if ((await query(["--version"], signal)).trim() !== "pitchfork 2.22.0")
      throw failure();
    let rows;
    try {
      rows = JSON.parse(
        await query(["list", "--json", "--namespace", namespace], signal),
      );
    } catch {
      throw failure();
    }
    if (!Array.isArray(rows) || rows.length > 512) throw failure();
    const ids = new Set();
    for (const row of rows) {
      if (
        !row ||
        typeof row.id !== "string" ||
        row.namespace !== namespace ||
        row.id !== `${namespace}/${row.name}` ||
        ids.has(row.id) ||
        ![
          "running",
          "stopped",
          "waiting",
          "stopping",
          "failed",
          "errored",
          "available",
          "disabled",
        ].includes(row.status) ||
        (row.pid !== null &&
          (!Number.isSafeInteger(row.pid) ||
            row.pid < 1 ||
            row.pid > 2147483647))
      )
        throw failure();
      ids.add(row.id);
    }
    return rows;
  }
  async function attribute(row, signal) {
    const match = serviceId.exec(row.id);
    if (
      !match ||
      row.available !== false ||
      row.disabled !== false ||
      row.pid === null
    )
      throw failure();
    try {
      const first = await inspectOS(row.pid, { signal });
      // Daemon metadata can retain an old PID after exit. Only independently
      // confirmed OS absence permits reuse; stopped status alone never does.
      if (first === null) return null;
      if (row.status !== "running") throw failure();
      const secondRow = (await list(signal)).find((r) => r.id === row.id);
      const second = await inspectOS(row.pid, { signal });
      if (
        !secondRow ||
        secondRow.pid !== row.pid ||
        secondRow.status !== "running" ||
        secondRow.available !== false ||
        secondRow.disabled !== false ||
        !first ||
        !isDeepStrictEqual(first, second) ||
        first.pid !== row.pid ||
        typeof first.startedAt !== "string" ||
        !first.startedAt.trim() ||
        first.startedAt.length > 256 ||
        /[\x00-\x1f\x7f]/.test(first.startedAt) ||
        typeof first.worktree !== "string" ||
        !path.isAbsolute(first.worktree) ||
        path.normalize(first.worktree) !== first.worktree ||
        /[\x00-\x1f\x7f]/.test(first.worktree)
      )
        throw failure();
      return {
        pid: first.pid,
        startedAt: first.startedAt,
        worktree: first.worktree,
        stackId: match[1],
      };
    } catch {
      throw failure();
    }
  }
  return {
    async identify(id, { signal } = {}) {
      if (!serviceId.test(id)) throw failure();
      const row = (await list(signal)).find((r) => r.id === id);
      if (!row || (row.status === "stopped" && row.pid === null)) return null;
      return attribute(row, signal);
    },
    async inspectProcess(pid, { signal } = {}) {
      if (!Number.isSafeInteger(pid) || pid < 1) throw failure();
      const rows = (await list(signal)).filter((r) => r.pid === pid);
      if (rows.length === 0) {
        // Missing daemon metadata is not proof a recorded PID is gone.
        try {
          if ((await inspectOS(pid, { signal })) === null) return null;
        } catch {
          throw failure();
        }
        throw failure();
      }
      if (rows.length !== 1) throw failure();
      return attribute(rows[0], signal);
    },
  };
}
module.exports = { createPitchforkIdentity };
