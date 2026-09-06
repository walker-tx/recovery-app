// Pitchfork 2.22.0 run/stop flags verified with installed --help. No daemon
// metadata assumptions here: ID -> PID resolution remains a separate adapter.
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
function createPitchforkRunner({
  exec = promisify(execFile),
  baseEnv = process.env,
} = {}) {
  return async (
    command,
    args,
    { cwd, env = {}, signal, timeoutMs = 30000 } = {},
  ) => {
    if (
      command !== "pitchfork" ||
      !Array.isArray(args) ||
      !args.every(
        (a) => typeof a === "string" && a.length && !a.includes("\0"),
      ) ||
      !/^recovery-local\/recovery-[a-zA-Z0-9-]+$/.test(args[1] ?? "") ||
      !Number.isSafeInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 30000
    )
      throw Error("Invalid Pitchfork command");
    const stop = args[0] === "stop" && args.length === 2;
    const run =
      args[0] === "run" &&
      ["--http", "--cmd"].includes(args[2]) &&
      args[4] === "--expected-port" &&
      /^\d+$/.test(args[5]) &&
      Number(args[5]) > 0 &&
      Number(args[5]) < 65536 &&
      args[6] === "--" &&
      args.length > 7;
    if (!stop && !run) throw Error("Unsupported Pitchfork command");
    if (
      run &&
      [baseEnv, env].some(
        (source) =>
          source.CONVEX_DEPLOY_KEY ||
          (source.CONVEX_DEPLOYMENT &&
            !/^(?:local|anonymous):[A-Za-z0-9._-]+$/.test(
              source.CONVEX_DEPLOYMENT,
            )),
      )
    )
      throw Error("Inherited cloud deployment configuration is not permitted");
    // Retain only OS lookup/location settings. Auth, destination, Node injection,
    // and Mise activation variables must never leak in from another preview.
    const childEnv = Object.fromEntries(
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
        .filter((key) => baseEnv[key] !== undefined)
        .map((key) => [key, baseEnv[key]]),
    );
    if (signal?.aborted)
      throw Error("Pitchfork command aborted before execution");
    try {
      await exec(command, args, {
        cwd,
        env: { ...childEnv, ...env },
        signal,
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: 65536,
        shell: false,
      });
    } catch (error) {
      // Never propagate argv, captured logs, environment or child error text.
      // Killing the CLI does NOT establish that its managed daemon stopped.
      throw Object.assign(
        Error("Pitchfork command failed; inspect ownership before retry"),
        {
          ambiguousTimeout:
            error.killed === true ||
            error.name === "AbortError" ||
            signal?.aborted === true,
        },
      );
    }
  };
}
// This is OS evidence only, intentionally not a registry identity: stackId must
// not be invented from a PID or copied from an expected record. Integration needs
// independently verified daemon ownership. Darwin requires a native precise
// start-time/cwd adapter; ps lstart is only second resolution and is insufficient.
async function inspectLinuxProcess(
  pid,
  { io = fs, platform = process.platform, signal } = {},
) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw Error("Invalid process PID");
  if (io === fs && platform !== "linux")
    throw Error("Precise process inspection unsupported on this OS");
  const check = () => {
    if (signal?.aborted) throw Error("Process inspection aborted");
  };
  const read = async (file) => {
    check();
    return io.readFile(file, { encoding: "utf8", signal });
  };
  const ticks = (raw) => {
    const end = raw.lastIndexOf(") ");
    const fields = raw
      .slice(end + 2)
      .trim()
      .split(/\s+/);
    if (
      !raw.startsWith(`${pid} (`) ||
      end < 0 ||
      !/^\d+$/.test(fields[19] ?? "")
    )
      throw Error("Invalid process start evidence");
    return fields[19];
  };
  try {
    const first = ticks(await read(`/proc/${pid}/stat`));
    const boot = (await read("/proc/sys/kernel/random/boot_id")).trim();
    if (!/^[a-zA-Z0-9-]+$/.test(boot)) throw Error("Invalid boot identity");
    check();
    const worktree = await io.readlink(`/proc/${pid}/cwd`);
    if (
      !worktree.startsWith("/") ||
      worktree.endsWith(" (deleted)") ||
      worktree.includes("\0")
    )
      throw Error("Invalid process directory");
    const second = ticks(await read(`/proc/${pid}/stat`));
    if (first !== second)
      throw Error("Process identity changed during inspection");
    check();
    return { pid, startedAt: `linux:${boot}:${first}`, worktree };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error.code) throw Error("Cannot inspect process identity");
    throw error;
  }
}
module.exports = { createPitchforkRunner, inspectLinuxProcess };
