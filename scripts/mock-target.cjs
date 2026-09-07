// Read-only CLI discovery. Never reserves, starts, repairs, or unlinks a socket.
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify, isDeepStrictEqual } = require("node:util");
const { createHash } = require("node:crypto");
const {
  createRegistry,
  resolveRegistryPath,
  adminSocketPath,
} = require("./stack-registry.cjs");
const { createProcessInspector } = require("./stack-process-inspector.cjs");
const run = promisify(execFile);
function failure(code) {
  return Object.assign(
    new Error(
      code === "TARGET_MISMATCH"
        ? "Selected stack registration or process ownership changed. Check the explicit worktree and stack status; no repair was attempted."
        : "Selected local service is unavailable or discovery was cancelled. Check stack status, registry locks and local process tools; start or restart the selected stack explicitly if its admin socket is unavailable.",
    ),
    { code },
  );
}
async function inspectSocket(socket) {
  const parent = path.dirname(socket);
  try {
    const directory = await fs.lstat(parent);
    if (
      !directory.isDirectory() ||
      directory.uid !== process.getuid() ||
      (directory.mode & 0o777) !== 0o700 ||
      (await fs.realpath(parent)) !== parent
    ) {
      throw failure("TARGET_MISMATCH");
    }
    const stat = await fs.lstat(socket);
    if (
      !stat.isSocket() ||
      stat.uid !== process.getuid() ||
      (stat.mode & 0o777) !== 0o600
    ) {
      throw failure("TARGET_MISMATCH");
    }
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
// lsof is native on macOS and optional on Linux; missing/denied evidence fails
// closed. Inspect only the allocated IPv4 TCP LISTEN port, never argv or labels.
async function inspectListener({ pid, port, signal, exec }) {
  const { stdout } = await exec(
    process.platform === "darwin" ? "/usr/sbin/lsof" : "lsof",
    ["-nP", "-a", `-i4TCP:${port}`, "-sTCP:LISTEN", "-Fpn"],
    {
      signal,
      timeout: 1000,
      maxBuffer: 8192,
      env: { PATH: process.env.PATH },
      shell: false,
    },
  );
  let currentPid = null;
  let listeners = 0;
  for (const field of stdout.trim().split("\n")) {
    if (/^p[1-9][0-9]*$/.test(field)) {
      currentPid = Number(field.slice(1));
    } else if (/^f[0-9]+$/.test(field)) {
      // lsof always emits the descriptor field even with an explicit field list.
    } else if (field === `n127.0.0.1:${port}` && currentPid === pid) {
      listeners++;
    } else {
      throw failure("TARGET_MISMATCH");
    }
  }
  if (listeners !== 1) {
    throw failure("TARGET_MISMATCH");
  }
  return true;
}
// Adapter seam for disposable tests; production always uses the existing authority.
function createMockTarget({
  createInspector = createProcessInspector,
  exec: execute = run,
  inspectListener: listenerOwned = inspectListener,
  inspectSocket: socketExists = inspectSocket,
} = {}) {
  async function read(options, expected, requireInbox = false) {
    const signal = options.signal ?? AbortSignal.timeout(5000);
    let inspector;
    try {
      signal.throwIfAborted();
      const directory = await fs.realpath(
        path.resolve(options.worktree ?? options.cwd ?? process.cwd()),
      );
      const exec = (command, args, settings) =>
        execute(command, args, { ...settings, signal });
      const { stdout } = await exec("git", ["rev-parse", "--show-toplevel"], {
        cwd: directory,
        timeout: 3000,
        maxBuffer: 8192,
      });
      const worktree = await fs.realpath(stdout.trim());
      let record;
      try {
        const registryPath = await resolveRegistryPath(worktree, { signal });
        record = await createRegistry({ registryPath }).readOwned(
          worktree,
          expected?.stackId,
          { signal },
        );
      } catch {
        throw failure(
          signal.aborted ? "SERVICE_UNAVAILABLE" : "TARGET_MISMATCH",
        );
      }
      const adminSocket = adminSocketPath(record);
      if (
        expected &&
        (!isDeepStrictEqual(expected.record, record) ||
          expected.worktree !== worktree ||
          expected.stackId !== record.stackId ||
          expected.providerGeneration !== record.providerGeneration ||
          expected.adminSocket !== adminSocket)
      ) {
        throw failure("TARGET_MISMATCH");
      }
      inspector = await createInspector({ exec });
      async function owned(service) {
        signal.throwIfAborted();
        const recorded = record.processes[service];
        if (!recorded) {
          return null;
        }
        const actual = await inspector.inspect(recorded.pid, { signal });
        // Stack UUID is selected registry authority, not an OS-observed property.
        // Preserve exact continuity without inventing stackId on the OS evidence.
        const tuple = {
          pid: recorded.pid,
          startedAt: recorded.startedAt,
          worktree: recorded.worktree,
        };
        if (actual !== null && !isDeepStrictEqual(actual, tuple)) {
          throw failure("TARGET_MISMATCH");
        }
        return actual;
      }
      const provider = await owned("provider");
      const socket = await socketExists(adminSocket);
      if (provider === null && socket) {
        // A leftover socket is not proof of an owned daemon; never reclaim it here.
        throw failure("TARGET_MISMATCH");
      }
      const providerState =
        provider === null ? "stopped" : socket ? "running" : "starting";
      let inbox = null;
      if (
        record.processes.mailpitHttp ||
        record.processes.mailpitSmtp ||
        requireInbox
      ) {
        const http = await owned("mailpitHttp");
        const smtp = await owned("mailpitSmtp");
        if (!isDeepStrictEqual(http, smtp)) {
          throw failure("TARGET_MISMATCH");
        }
        if (http !== null) {
          // Provider/status discovery does not require the optional listener tool.
          // Inbox callers must verify immediately before using this address.
          if (
            requireInbox &&
            (await listenerOwned({
              pid: http.pid,
              port: record.ports.mailpitHttp,
              signal,
              exec,
            })) !== true
          ) {
            throw failure("TARGET_MISMATCH");
          }
          if (!isDeepStrictEqual(http, await owned("mailpitHttp"))) {
            throw failure("TARGET_MISMATCH");
          }
          inbox = {
            baseUrl: `http://127.0.0.1:${record.ports.mailpitHttp}`,
            epoch: createHash("sha256")
              .update(
                JSON.stringify([
                  record.stackId,
                  record.providerGeneration,
                  record.owner,
                  http,
                ]),
              )
              .digest("hex"),
          };
        }
      }
      if (
        expected &&
        requireInbox &&
        !isDeepStrictEqual(expected.inbox, inbox)
      ) {
        throw failure("TARGET_MISMATCH");
      }
      if (
        expected &&
        (providerState !== "running" || (requireInbox && inbox === null))
      ) {
        throw failure("SERVICE_UNAVAILABLE");
      }
      signal.throwIfAborted();
      return {
        worktree,
        stackId: record.stackId,
        providerGeneration: record.providerGeneration,
        adminSocket,
        providerState,
        inbox,
        record,
      };
    } catch (error) {
      if (signal.aborted) {
        throw failure("SERVICE_UNAVAILABLE");
      }
      if (["TARGET_MISMATCH", "SERVICE_UNAVAILABLE"].includes(error.code)) {
        throw error;
      }
      throw failure("SERVICE_UNAVAILABLE");
    } finally {
      await inspector?.close();
    }
  }
  return {
    selectMockTarget: (options = {}) => read(options),
    verifyMockTarget: (selection, options = {}) =>
      read(
        { worktree: selection.worktree, signal: options.signal },
        selection,
        options.inbox === true,
      ),
  };
}
// Static named exports are required by the native Node ESM CLI bridge.
const { selectMockTarget, verifyMockTarget } = createMockTarget();
module.exports = { selectMockTarget, verifyMockTarget, createMockTarget };
