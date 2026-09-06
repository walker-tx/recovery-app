// Pitchfork orchestration only: registry remains the sole identity/process owner.
// Integrators supply command execution, independently verified process inspection,
// and protocol readiness (including provider bootstrap identity verification).
const fs = require("node:fs/promises");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const { isDeepStrictEqual } = require("node:util");
const groups = [
  ["mailpitHttp", "mailpitSmtp"],
  ["provider"],
  ["convexCloud", "convexSite"],
  ["metro"],
];
const names = groups.flat();
const processName = (record, service) =>
  `recovery-local/recovery-${record.stackId}-${service}`;
function localConfiguration(record, bootstrap) {
  if (
    !bootstrap ||
    bootstrap.providerGeneration !== record.providerGeneration
  ) {
    throw Error("Provider bootstrap identity mismatch");
  }
  return {
    RECOVERY_STACK_ID: record.stackId,
    RECOVERY_PROVIDER_GENERATION: record.providerGeneration,
    EXPO_PUBLIC_AUTH_ENVIRONMENT_ID: `${record.stackId}:${record.providerGeneration}`,
    EXPO_PUBLIC_CONVEX_URL: `http://127.0.0.1:${record.ports.convexCloud}`,
  };
}
function createLifecycle({
  registry,
  run,
  identify,
  ready,
  readBootstrap,
  prepare,
  environment,
  afterReady,
  timeoutMs = 30000,
  setupTimeoutMs = timeoutMs,
  now = () => performance.now(),
}) {
  if (!Number.isSafeInteger(setupTimeoutMs) || setupTimeoutMs < 1)
    throw Error("Invalid setup timeout");
  if (
    ![run, identify, ready].every((f) => typeof f === "function") ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1
  ) {
    throw Error(
      "Lifecycle requires bounded command, identity and readiness adapters",
    );
  }
  // Adapters must honor AbortSignal. Timeout never implies a daemon was stopped;
  // preserve reservations and require inspection after an ambiguous command.
  async function bounded(label, action, budget = timeoutMs) {
    const controller = new AbortController();
    let timer;
    const deadlineMs = now() + budget;
    const checkDeadline = () => {
      if (now() >= deadlineMs) {
        controller.abort();
        throw Object.assign(
          Error(
            `${label} timed out; manual reconciliation required; lifecycle lock retained`,
          ),
          { ambiguousTimeout: true },
        );
      }
    };
    try {
      const result = await Promise.race([
        Promise.resolve().then(() => {
          checkDeadline();
          return action(controller.signal, { deadlineMs, now, checkDeadline });
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(
              Object.assign(
                Error(
                  `${label} timed out; manual reconciliation required; lifecycle lock retained`,
                ),
                { ambiguousTimeout: true },
              ),
            );
          }, budget);
        }),
      ]);
      checkDeadline();
      return result;
    } catch (error) {
      checkDeadline();
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  async function locked(worktree, action) {
    const canonical = await fs.realpath(worktree);
    const lock = path.join(canonical, ".recovery-stack-lifecycle.lock");
    try {
      await fs.mkdir(lock, { mode: 0o700 });
    } catch (error) {
      if (error.code === "EEXIST")
        throw Error(
          "Lifecycle locked; inspect active operation before manual repair",
        );
      throw error;
    }
    let retain = false;
    try {
      return await action(canonical);
    } catch (error) {
      retain = error.ambiguousTimeout === true || error.ambiguous === true;
      throw error;
    } finally {
      if (!retain) await fs.rmdir(lock);
    }
  }
  async function status(worktree) {
    return bounded("status", () => registry.status(worktree));
  }
  return {
    status,
    start: (worktree, definitions) =>
      locked(worktree, async (canonical) => {
        const record = await bounded("reservation", () =>
          registry.reserve(canonical),
        );
        const prepared = prepare
          ? await bounded(
              "preparation",
              (signal) => prepare(record, { signal }),
              setupTimeoutMs,
            )
          : undefined;
        const services = definitions(record, prepared);
        const seen = new Set();
        for (const service of services) {
          if (
            !names.includes(service.name) ||
            seen.has(service.name) ||
            !Array.isArray(service.command) ||
            !service.command.length ||
            !service.command.every(
              (s) => typeof s === "string" && s.length > 0 && !s.includes("\0"),
            ) ||
            !service.readiness ||
            Object.keys(service.readiness).length !== 1 ||
            !["cmd", "http"].includes(Object.keys(service.readiness)[0]) ||
            typeof Object.values(service.readiness)[0] !== "string" ||
            !Object.values(service.readiness)[0]
          )
            throw Error("Invalid service definition");
          seen.add(service.name);
        }
        for (const group of groups) {
          if (
            group.some((name) => seen.has(name)) &&
            !group.every((name) => seen.has(name))
          )
            throw Error("Incomplete process group");
        }
        for (const group of groups) {
          const service = services.find((service) => service.name === group[0]);
          if (!service) continue;
          let env = {
            RECOVERY_STACK_ID: record.stackId,
            RECOVERY_PROVIDER_GENERATION: record.providerGeneration,
          };
          if (service.name === "metro") {
            if (typeof readBootstrap !== "function")
              throw Error("Independent provider bootstrap adapter required");
            env = localConfiguration(
              record,
              await bounded("bootstrap", (signal) =>
                readBootstrap(record, { signal }),
              ),
            );
          }
          if (environment) {
            const extra = await bounded("service environment", (signal) =>
              environment(service, record, prepared, { signal }),
            );
            if (
              !extra ||
              typeof extra !== "object" ||
              Array.isArray(extra) ||
              Object.entries(extra).some(
                ([key, value]) =>
                  typeof value !== "string" ||
                  (key in env && value !== env[key]) ||
                  (service.name !== "metro" && key.startsWith("EXPO_PUBLIC_")),
              )
            )
              throw Error("Invalid service environment");
            env = { ...env, ...extra };
          }
          const current = await status(canonical);
          if (current.state === "conflict")
            throw Error("Stack ownership conflict; manual repair required");
          const id = processName(record, service.name);
          if (current.services[service.name] !== "running") {
            // Do not let Pitchfork silently reuse an unrecorded daemon with this ID.
            if (
              (await bounded("identity", (signal) =>
                identify(id, { signal }),
              )) !== null
            )
              throw Error(
                "Unrecorded process ownership; manual repair required",
              );
            const [kind, value] = Object.entries(service.readiness)[0];
            await bounded("start", (signal) =>
              run(
                "pitchfork",
                [
                  "run",
                  id,
                  `--${kind}`,
                  value,
                  "--expected-port",
                  String(record.ports[service.name]),
                  "--",
                  ...service.command,
                ],
                { cwd: service.cwd ?? canonical, env, signal, timeoutMs },
              ),
            );
            const identity = await bounded("identity", (signal) =>
              identify(id, { signal }),
            );
            await bounded("record ownership", () =>
              registry.recordProcess(
                canonical,
                record.stackId,
                group,
                identity,
              ),
            );
          }
          for (const name of group) {
            const endpoint = services.find((service) => service.name === name);
            if (
              (await bounded("readiness", (signal) =>
                ready(endpoint, record, { signal }, prepared),
              )) !== true
            )
              throw Error(`${name} not ready; reservation retained`);
          }
          if (afterReady)
            await bounded(
              "service setup",
              (signal, deadline) =>
                afterReady(service, record, prepared, { signal, ...deadline }),
              setupTimeoutMs,
            );
        }
        return status(canonical);
      }),
    stop: (worktree, stackId) =>
      locked(worktree, async (canonical) => {
        let current = await status(canonical);
        if (current.stackId !== stackId)
          throw Error("Stack ownership mismatch");
        if (current.state === "conflict")
          throw Error("Stack ownership conflict; no processes stopped");
        for (const group of [...groups].reverse()) {
          const service = group[0];
          current = await status(canonical);
          if (current.state === "conflict")
            throw Error("Stack ownership conflict; stopping halted");
          if (current.services[service] === "running") {
            const record = await bounded("ownership", () =>
              registry.reserve(canonical),
            );
            const actual = await bounded("identity", (signal) =>
              identify(processName(current, service), { signal }),
            );
            if (!isDeepStrictEqual(actual, record.processes[service]))
              throw Error(
                "Pitchfork process ownership mismatch; stopping halted",
              );
            await bounded("stop", (signal) =>
              run("pitchfork", ["stop", processName(current, service)], {
                cwd: canonical,
                signal,
                timeoutMs,
              }),
            );
            const stopped = await status(canonical);
            if (group.some((name) => stopped.services[name] !== "stopped"))
              throw Error(`${service} did not stop; reservation retained`);
          }
        }
        return status(canonical);
      }),
  };
}
module.exports = { createLifecycle, localConfiguration, processName };
