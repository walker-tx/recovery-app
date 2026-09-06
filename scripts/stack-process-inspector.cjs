const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const path = require("node:path");
const { tmpdir } = require("node:os");
const { inspectLinuxProcess } = require("./stack-adapters.cjs");

// One inspector per CLI operation, not a persistent native cache or supervisor.
async function createProcessInspector({
  platform = process.platform,
  exec = promisify(execFile),
} = {}) {
  if (!["linux", "darwin"].includes(platform))
    throw Error("Precise process inspection unsupported");
  let directory,
    binary,
    closed = false;
  const env = Object.fromEntries(
    ["PATH", "HOME", "TMPDIR"]
      .filter((key) => process.env[key] !== undefined)
      .map((key) => [key, process.env[key]]),
  );
  if (platform === "darwin") {
    directory = await fs.mkdtemp(
      path.join(tmpdir(), "recovery-process-inspector-"),
    );
    binary = path.join(directory, "inspect");
    try {
      await exec(
        "/usr/bin/clang",
        [
          "-Wall",
          "-Wextra",
          "-Werror",
          path.join(__dirname, "stack-process-darwin.c"),
          "-o",
          binary,
        ],
        { env, timeout: 5000, maxBuffer: 8192, shell: false },
      );
    } catch {
      await fs.rm(directory, { recursive: true, force: true });
      throw Error("Precise process inspector compilation failed");
    }
  }
  return {
    async inspect(pid, { signal } = {}) {
      if (closed) throw Error("Process inspector closed");
      if (!Number.isSafeInteger(pid) || pid < 1 || pid > 2147483647)
        throw Error("Invalid process PID");
      if (platform === "linux") return inspectLinuxProcess(pid, { signal });
      try {
        const { stdout } = await exec(binary, [String(pid)], {
          env,
          signal,
          timeout: 1000,
          maxBuffer: 8192,
          shell: false,
        });
        const evidence = JSON.parse(stdout);
        if (evidence === null) return null;
        if (
          !evidence ||
          evidence.pid !== pid ||
          typeof evidence.startedAt !== "string" ||
          !/^darwin:[1-9][0-9]*:[0-9]{1,6}$/.test(evidence.startedAt) ||
          typeof evidence.worktree !== "string" ||
          !path.isAbsolute(evidence.worktree) ||
          path.normalize(evidence.worktree) !== evidence.worktree ||
          evidence.worktree.includes("\0")
        )
          throw Error();
        return {
          pid,
          startedAt: evidence.startedAt,
          worktree: evidence.worktree,
        };
      } catch {
        throw Error("Cannot establish precise process identity");
      }
    },
    async close() {
      if (closed) return;
      closed = true;
      if (directory) await fs.rm(directory, { recursive: true, force: true });
    },
  };
}
module.exports = { createProcessInspector };
