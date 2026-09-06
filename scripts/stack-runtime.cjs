// Explicit local-only boundary. Legacy zero/status/stop scripts remain unchanged.
const path = require("node:path");
const { isDeepStrictEqual } = require("node:util");
const os = require("node:os");
const fs = require("node:fs/promises");
const { constants } = require("node:fs");
const { preflightDestruction } = require("./stack-destruction-preflight.cjs");
const { createReadiness } = require("./stack-readiness.cjs");
const { prepareBootstrapSeed } = require("./stack-bootstrap-seed.cjs");
const {
  buildStackServices,
  prepareOwnedStateDirectories,
} = require("./stack-services.cjs");
const { buildStackConfiguration } = require("./stack-configuration.cjs");
const { bootstrapLocalConvex } = require("./stack-convex-bootstrap.cjs");
const { persistLocalConfig } = require("./stack-local-config.cjs");
const { createProcessInspector } = require("./stack-process-inspector.cjs");
const { createPitchforkIdentity } = require("./stack-pitchfork-identity.cjs");
const { createPitchforkRunner } = require("./stack-adapters.cjs");
const { createRegistry, portAvailable: observePort } = require("./stack-registry.cjs");
const { createLifecycle, processName, StopFailure, groups } = require("./stack-lifecycle.cjs");
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  );
async function createRuntime({
  worktree = process.cwd(),
  registryPath = path.join(
    os.homedir(),
    ".local",
    "state",
    "recovery",
    "stacks",
  ),
  inspector,
  identity,
  run,
  portAvailable = observePort,
  backendBinary,
  fetchImpl = globalThis.fetch,
  connect,
  readinessTimeoutMs = 2000,
  inherited = process.env,
  setupTimeoutMs = 180000,
  startup = {},
  now,
} = {}) {
  inspector ??= await createProcessInspector();
  try {
    identity ??= createPitchforkIdentity({
      inspectOS: inspector.inspect,
      cwd: worktree,
    });
    const registry = createRegistry({
      registryPath,
      inspectProcess: identity.inspectProcess,
      portAvailable,
    });
    const prepareSeed = startup.prepareSeed ?? prepareBootstrapSeed;
    const bootstrap = startup.bootstrap ?? bootstrapLocalConvex;
    const persist = startup.persist ?? persistLocalConfig;

    const readiness = createReadiness({
      fetchImpl,
      connect,
      timeoutMs: readinessTimeoutMs,
    });
    const readProvider = readiness.readProviderInfo;

    function configuration(record, seed, provider) {
      return buildStackConfiguration({
        registry: record,
        bootstrap: provider,
        inherited,
        credentials: {
          stackId: record.stackId,
          providerGeneration: record.providerGeneration,
          apiKey: seed.LOCAL_WORKOS_API_KEY,
        },
      });
    }

    const lifecycle = createLifecycle({
      registry,
      identify: identity.identify,
      run: run ?? createPitchforkRunner(),
      setupTimeoutMs,
      now,
      prepare: async (record) => {
        // Reject ambient deployment selectors before credential or service effects.
        for (const key of [
          "CONVEX_DEPLOY_KEY",
          "CONVEX_DEPLOYMENT",
          "CONVEX_SELF_HOSTED_ADMIN_KEY",
          "CONVEX_SELF_HOSTED_URL",
          "CONVEX_ADMIN_KEY",
          "WORKOS_ADMIN_API_KEY",
        ]) {
          if (key in inherited)
            throw Error("Inherited deployment selector rejected");
        }
        prepareOwnedStateDirectories({
          registry: record,
          worktree: record.worktree,
        });
        const file = path.join(record.worktree, "mise.local.toml");
        const seed = await prepareSeed({
          registry: record,
          file,
          backendBinary,
        });
        return { seed, file };
      },
      environment: async (service, _record, prepared) => {
        if (service.name === "provider") {
          return { LOCAL_WORKOS_API_KEY: prepared.seed.LOCAL_WORKOS_API_KEY };
        }
        if (service.name === "metro") {
          if (!prepared.persisted)
            throw Error("Metro configuration not persisted");
          return prepared.configuration.mobile;
        }
        return {};
      },
      ready:
        startup.ready ??
        ((service, record, options) =>
          readiness.ready(service.name, record, options)),
      afterReady: async (service, record, prepared, options) => {
        if (service.name === "provider") {
          const provider = await readProvider(record, options);
          prepared.configuration = configuration(
            record,
            prepared.seed,
            provider,
          );
        }
        if (service.name === "convexCloud") {
          if (!prepared.configuration)
            throw Error("Validated provider configuration required");
          await bootstrap({
            registry: record,
            worktree: record.worktree,
            seed: prepared.seed,
            configuration: prepared.configuration,
          });
          // A setup timeout may not cancel an injected or underlying effect.
          // Never publish config or advance to Metro after its deadline.
          options.signal.throwIfAborted();
          options.checkDeadline();
          await persist({
            file: prepared.file,
            deadlineMs: options.deadlineMs,
            now: options.now,
            owned: { ...prepared.configuration.owned, ...prepared.seed },
          });
          options.signal.throwIfAborted();
          options.checkDeadline();
          prepared.persisted = true;
        }
      },
      readBootstrap: async (record, options) => {
        const provider = await readProvider(record, options);
        // Validate the full authoritative identity again, not generation alone.
        // No credentials are read from the public provider response.
        const clientId = `client_local${record.providerGeneration.replaceAll("-", "")}`;
        if (
          provider.providerGeneration !== record.providerGeneration ||
          provider.clientId !== clientId ||
          provider.port !== record.ports.provider ||
          provider.issuer !==
            `https://local-workos.invalid/instances/${record.providerGeneration}`
        ) {
          throw Error("Provider bootstrap identity mismatch");
        }
        return provider;
      },
    });
    async function check(stackId) {
      if (!uuid(stackId)) throw Error("Explicit stack UUID required");
      const status = await lifecycle.status(worktree);
      if (status.stackId !== stackId) throw Error("Stack ownership mismatch");
      return status;
    }
    return {
      // No transaction, lock acquisition, state preparation, or route inference.
      // Production route evidence is intentionally unavailable until #49.
      destructionPreflight: (target, confirmation) => preflightDestruction({
        worktree, registryPath, target, confirmation,
        inspectProcess: identity.inspectProcess,
        portAvailable,
      }),
      // Explicit local capability only, not exposed by the CLI. Never re-pairs trust.
      destroyProvider: confirmation => lifecycle.destroyProvider(worktree, confirmation),
      reserve: () => registry.reserve(worktree),
      status: async (stackId) => {
        if (!uuid(stackId)) throw Error("Explicit stack UUID required");
        const record = await registry.readOwned(worktree, stackId);
        const status = await check(stackId);
        const observations = Object.fromEntries(Object.keys(status.ports).map(service => [
          service, { state: "unknown", reason: "not-probed" },
        ]));
        await Promise.all(groups.map(async group => {
          const original = record.processes[group[0]];
          if (!original || !group.every(service =>
            status.services[service] === "running" &&
            isDeepStrictEqual(record.processes[service], original)
          )) return;
          try {
            // Check the canonical paired daemon against the original registry
            // identity, never using HTTP to establish process ownership.
            if (!isDeepStrictEqual(await identity.identify(processName(record, group[0])), original)) return;
          } catch { return; }
          await Promise.all(group.map(async service => {
            try {
              await readiness.ready(service, record);
              observations[service] = {
                state: "ready", evidence: service === "convexSite" ? "transport" : "protocol",
              };
            } catch {
              observations[service] = { state: "not-ready", reason: "probe-failed" };
            }
          }));
        }));
        // Single-attempt bounded protocol observations, not application health
        // or identity evidence. URLs remain configured destinations.
        return {
          ...status,
          urls: Object.fromEntries(Object.entries(status.ports).map(([service, port]) => [
            service, `${service === "mailpitSmtp" ? "smtp" : "http"}://127.0.0.1:${port}`,
          ])),
          readiness: observations,
          guidance: status.state === "reserved" && Object.entries(status.services).every(
            ([service, state]) => state === "stopped" ||
              (state === "running" && observations[service]?.state === "ready")
          )
            ? "To explicitly resume when authorized, run from the reported worktree: mise run zero -- --isolated <absolute-backend-executable>. Replace the placeholder with your verified executable; its path is not inferred. Startup still enforces ownership and lock checks. Never clear locks or reset state to retry."
            : "Resume refused: process ownership or readiness is conflicted, unknown, or not ready. Inspect the reported services and scoped logs; status cannot prescribe a safe repair. Never clear locks, kill unknown processes, or reset state to retry.",
          // Paired endpoints share one daemon; do not invent filesystem log paths.
          logs: Object.fromEntries(["mailpitHttp", "provider", "convexCloud", "metro"].map(service => [
            service, { manager: "pitchfork", name: processName(status, service) },
          ])),
        };
      },
      stop: async (stackId) => {
        await check(stackId);
        return lifecycle.stop(worktree, stackId);
      },
      start: async () => {
        if (
          typeof backendBinary !== "string" ||
          !path.isAbsolute(backendBinary) ||
          backendBinary.includes("\0")
        ) {
          throw Error(
            "Startup preflight requires an absolute backend executable",
          );
        }
        try {
          if (!(await fs.stat(backendBinary)).isFile()) throw Error();
          await fs.access(backendBinary, constants.X_OK);
          const providerFile = path.join(
            worktree,
            "packages/local-workos/src/cli.ts",
          );
          if (!(await fs.stat(providerFile)).isFile()) throw Error();
          await fs.access(providerFile, constants.R_OK);
          for (const relative of [
            "apps/mobile/node_modules/expo/bin/cli",
            "packages/backend/node_modules/.bin/convex",
          ]) {
            const file = path.join(worktree, relative);
            if (!(await fs.stat(file)).isFile()) throw Error();
            await fs.access(
              file,
              relative.endsWith("/convex") ? constants.X_OK : constants.R_OK,
            );
          }
          for (const command of ["node", "pnpm", "mailpit"]) {
            let found = false;
            for (const directory of (inherited.PATH ?? "").split(
              path.delimiter,
            )) {
              if (!path.isAbsolute(directory)) continue;
              const file = path.join(directory, command);
              try {
                if (!(await fs.stat(file)).isFile()) continue;
                await fs.access(file, constants.X_OK);
                found = true;
                break;
              } catch {
                /* Try the next explicit PATH entry. */
              }
            }
            if (!found) throw Error();
          }
        } catch {
          throw Error(
            "Startup preflight requires provider source, backend executable, and installed node/pnpm/mailpit/Expo/Convex dependencies",
          );
        }
        return lifecycle.start(worktree, (record, prepared) =>
          buildStackServices({
            registry: record,
            worktree: record.worktree,
            backendBinary,
            seed: prepared.seed,
          }),
        );
      },
      close: () => inspector.close(),
    };
  } catch (error) {
    await inspector.close();
    throw error;
  }
}
async function runCli(
  args,
  {
    open = createRuntime,
    write = (line) => process.stdout.write(`${line}\n`),
  } = {},
) {
  const [command, stackId] = args;
  const starting = command === "start";
  const validStart =
    starting &&
    args.length === 2 &&
    typeof stackId === "string" &&
    path.isAbsolute(stackId) &&
    !stackId.includes("\0");
  if (!(
    validStart ||
    (command === "reserve" && args.length === 1) ||
    (["status", "stop"].includes(command) && args.length === 2 && uuid(stackId))
  )) {
    write(
      "Usage: node scripts/stack-runtime.cjs start <absolute-backend-executable> | reserve | status <stack-UUID> | stop <stack-UUID>",
    );
    return 1;
  }
  let runtime;
  try {
    runtime = starting ? await open({ backendBinary: stackId }) : await open();
    const result = starting
      ? await runtime.start()
      : await runtime[command](stackId);
    // Never serialize full records, process metadata, argv or adapter errors.
    write(
      JSON.stringify({
        stackId: result.stackId,
        providerGeneration: result.providerGeneration,
        state: result.state ?? "reserved",
        ports: result.ports,
        services: result.services,
        ...(command === "stop" && result.stopReport ? { stopReport: result.stopReport } : {}),
        ...(command === "status" ? {
          worktree: result.worktree,
          urls: result.urls,
          readiness: result.readiness,
          guidance: result.guidance,
          logs: result.logs,
        } : {}),
      }),
    );
    return 0;
  } catch (error) {
    if (error instanceof StopFailure) {
      write(JSON.stringify(error.stopReport));
      return 1;
    }
    write(
      "Local stack operation refused: verify provider source, executable/dependencies, stack UUID, registry ownership/locks, free reserved ports, and Pitchfork 2.22.0/process inspector availability. No automatic repair attempted.",
    );
    return 1;
  } finally {
    if (runtime) await runtime.close();
  }
}
if (require.main === module)
  runCli(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    () => {
      process.stderr.write(
        "Local stack runtime cleanup failed; inspect ownership before retry.\n",
      );
      process.exitCode = 1;
    },
  );
module.exports = { createRuntime, runCli };
