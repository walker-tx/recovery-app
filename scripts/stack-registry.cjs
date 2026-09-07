// Nonsecret reservation foundation, not a service supervisor. Release is only for
// explicitly verified teardown, never ordinary stop. No PID-only process adapter.
const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const { randomUUID } = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const { setTimeout: delay } = require("node:timers/promises");
const services = [
  "convexCloud",
  "convexSite",
  "metro",
  "provider",
  "mailpitHttp",
  "mailpitSmtp",
];

const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  );
const absolutePath = (value) =>
  typeof value === "string" &&
  !value.includes("\0") &&
  path.isAbsolute(value) &&
  path.normalize(value) === value;
function validIdentity(identity, record) {
  return (
    object(identity) &&
    Object.keys(identity).length === 4 &&
    Number.isSafeInteger(identity.pid) &&
    identity.pid > 0 &&
    typeof identity.startedAt === "string" &&
    identity.startedAt.trim().length > 0 &&
    !identity.startedAt.includes("\0") &&
    identity.worktree === record.worktree &&
    identity.stackId === record.stackId
  );
}
function validateRegistry(data) {
  if (
    !object(data) ||
    Object.keys(data).length !== 2 ||
    data.version !== 1 ||
    !object(data.stacks)
  ) {
    throw Error("Invalid registry; manual repair required");
  }
  const ports = new Set(),
    stackIds = new Set(),
    generations = new Set(),
    names = new Set();
  for (const [key, record] of Object.entries(data.stacks)) {
    if (
      !object(record) ||
      Object.keys(record).length !== 6 ||
      !absolutePath(key) ||
      record.worktree !== key ||
      names.has(path.basename(key)) ||
      !uuid(record.stackId) ||
      !uuid(record.providerGeneration) ||
      stackIds.has(record.stackId) ||
      generations.has(record.providerGeneration) ||
      typeof record.owner !== "string" ||
      !/^(0|[1-9][0-9]*):(0|[1-9][0-9]*)$/.test(record.owner) ||
      !record.owner.split(":").every((n) => Number.isSafeInteger(Number(n))) ||
      !object(record.ports) ||
      Object.keys(record.ports).length !== services.length ||
      !object(record.processes) ||
      Object.entries(record.processes).some(
        ([service, identity]) =>
          !services.includes(service) || !validIdentity(identity, record),
      )
    ) {
      throw Error("Invalid reservation; manual repair required");
    }
    names.add(path.basename(key));
    stackIds.add(record.stackId);
    generations.add(record.providerGeneration);
    for (const service of services) {
      const port = record.ports[service];
      if (
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65535 ||
        ports.has(port)
      ) {
        throw Error("Invalid reservation ports; manual repair required");
      }
      ports.add(port);
    }
  }
}

async function portAvailable(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) =>
      error.code === "EADDRINUSE" ? resolve(false) : reject(error),
    );
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () =>
      server.close(() => resolve(true)),
    );
  });
}

function createRegistry({
  registryPath,
  portAvailable: available = portAvailable,
  inspectProcess = async () => {
    throw Error("Process inspection adapter required; ownership unknown");
  },
  lockTimeoutMs = 1000,
}) {
  if (!path.isAbsolute(registryPath)) {
    throw Error("Registry path must be absolute");
  }
  const file = path.join(registryPath, "registry.json"),
    lock = path.join(registryPath, "lock");
  async function releaseOwnedLock(token) {
    // An externally replaced lock is not ours to remove. A crash leaves a
    // bounded, actionable busy result rather than an unsafe PID-based steal.
    const current = JSON.parse(
      await fs.readFile(path.join(lock, "owner.json"), "utf8"),
    );
    if (current.token !== token) {
      throw Error("Lock ownership changed; manual repair required");
    }
    await fs.rm(path.join(lock, "owner.json"));
    await fs.rmdir(lock);
  }
  async function transact(worktree, change, renewOwner = false) {
    const canonical = await fs.realpath(worktree);
    const stat = await fs.stat(canonical);
    if (!stat.isDirectory()) {
      throw Error("Worktree must be a directory");
    }
    const owner = `${stat.dev}:${stat.ino}`;
    await fs.mkdir(registryPath, { recursive: true, mode: 0o700 });
    const rootStat = await fs.lstat(registryPath);
    if (
      !rootStat.isDirectory() ||
      rootStat.uid !== process.getuid() ||
      rootStat.mode & 0o077
    ) {
      throw Error("Registry directory ownership/permissions unsafe");
    }
    const deadline = Date.now() + lockTimeoutMs;
    while (true) {
      try {
        await fs.mkdir(lock, { mode: 0o700 });
        break;
      } catch (error) {
        if (error.code !== "EEXIST") {
          throw error;
        }
      }
      // Only EEXIST reaches this boundary; do not retain filesystem error data.
      if (Date.now() >= deadline) {
        throw Error(
          "Registry locked; manual ownership investigation required (no automatic lock reclamation)",
        );
      }
      await delay(10);
    }
    const token = randomUUID();
    try {
      await fs.writeFile(
        path.join(lock, "owner.json"),
        JSON.stringify({ token, pid: process.pid }),
        { mode: 0o600, flag: "wx" },
      );
      let data;
      try {
        data = JSON.parse(await fs.readFile(file, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
        data = { version: 1, stacks: {} };
      }
      validateRegistry(data);
      const record = data.stacks[canonical];
      if (
        Object.values(data.stacks).some(
          (entry) =>
            entry.worktree !== canonical &&
            path.basename(entry.worktree) === path.basename(canonical),
        )
      ) {
        throw Error(
          "Stack name already claimed by another worktree; manual repair required",
        );
      }
      if (record && record.owner !== owner && !renewOwner) {
        throw Error("Worktree ownership mismatch; manual repair required");
      }
      const before = JSON.stringify(data);
      const result = await change(data, record, canonical, owner);
      if (JSON.stringify(data) !== before) {
        const temporary = `${file}.${token}.tmp`;
        try {
          await fs.writeFile(temporary, JSON.stringify(data) + "\n", {
            mode: 0o600,
            flag: "wx",
          });
          await fs.rename(temporary, file);
        } finally {
          await fs.rm(temporary, { force: true });
        }
      }
      return result;
    } finally {
      await releaseOwnedLock(token);
    }
  }
  async function observe(record) {
    const states = {};
    for (const service of services) {
      const identity = record.processes[service];
      const actual = identity ? await inspectProcess(identity.pid) : null;
      states[service] =
        actual === null
          ? "stopped"
          : isDeepStrictEqual(actual, identity)
            ? "running"
            : "mismatched";
      if (
        states[service] === "stopped" &&
        (await available(record.ports[service])) !== true
      ) {
        states[service] = "occupied";
      }
    }
    return states;
  }
  function owned(record, stackId) {
    if (!stackId || (record && record.stackId !== stackId)) {
      throw Error("Stack ownership mismatch");
    }
  }
  return {
    readOwned: (worktree, stackId) =>
      transact(worktree, async (_data, record) => {
        owned(record, stackId);
        if (!record) {
          throw Error("Stack ownership missing");
        }
        return record;
      }),
    reserve: (worktree) =>
      transact(
        worktree,
        async (data, record, canonical, owner) => {
          if (record) {
            const states = Object.values(await observe(record));
            if (states.includes("mismatched")) {
              throw Error("Process ownership mismatch; manual repair required");
            }
            if (states.includes("occupied")) {
              throw Error("Reserved port occupied; manual repair required");
            }
            if (record.owner !== owner) {
              if (states.some((state) => state !== "stopped")) {
                throw Error(
                  "Worktree ownership changed with live resources; manual repair required",
                );
              }
              record.owner = owner;
            }
            return record;
          }
          const used = new Set(
            Object.values(data.stacks).flatMap((r) => Object.values(r.ports)),
          );
          const ports = {};
          let candidate = 24000;
          for (const service of services) {
            while (
              candidate < 25000 &&
              (used.has(candidate) || (await available(candidate)) !== true)
            ) {
              candidate++;
            }
            if (candidate >= 25000) {
              throw Error(
                "Port allocation exhausted (24000-24999); no reservations changed",
              );
            }
            ports[service] = candidate++;
          }
          record = {
            stackId: randomUUID(),
            providerGeneration: randomUUID(),
            worktree: canonical,
            owner,
            ports,
            processes: {},
          };
          data.stacks[canonical] = record;
          return record;
        },
        true,
      ),
    status: (worktree) =>
      transact(worktree, async (_data, record) => {
        if (!record) {
          return { state: "absent" };
        }
        const states = await observe(record);
        return {
          stackId: record.stackId,
          providerGeneration: record.providerGeneration,
          worktree: record.worktree,
          ports: record.ports,
          state: Object.values(states).some((s) =>
            ["mismatched", "occupied"].includes(s),
          )
            ? "conflict"
            : "reserved",
          services: states,
        };
      }),
    recordProcess: (worktree, stackId, service, identity) =>
      transact(worktree, async (_data, record) => {
        owned(record, stackId);
        const endpoints = Array.isArray(service) ? service : [service];
        if (
          !record ||
          !endpoints.length ||
          new Set(endpoints).size !== endpoints.length ||
          !endpoints.every((name) => services.includes(name)) ||
          !validIdentity(identity, record)
        ) {
          throw Error("Invalid process ownership");
        }
        if (!isDeepStrictEqual(await inspectProcess(identity.pid), identity)) {
          throw Error("Process ownership mismatch");
        }
        for (const endpoint of endpoints) {
          const previous = record.processes[endpoint];
          if (
            previous &&
            !isDeepStrictEqual(previous, identity) &&
            (await inspectProcess(previous.pid)) !== null
          ) {
            throw Error("Existing process ownership unresolved");
          }
        }
        for (const endpoint of endpoints) {
          record.processes[endpoint] = {
            pid: identity.pid,
            startedAt: identity.startedAt,
            worktree: identity.worktree,
            stackId: identity.stackId,
          };
        }
      }),
    release: (worktree, stackId) =>
      transact(worktree, async (_data, record) => {
        owned(record, stackId);
        if (!record) {
          return { released: false };
        }
        if (Object.values(await observe(record)).some((s) => s !== "stopped")) {
          throw Error(
            "Cannot release: process/port remains occupied or ownership mismatched",
          );
        }
        // Process/port absence is not proof that every owned domain is gone.
        throw Error(
          "Reservation release unavailable: complete domain teardown not implemented",
        );
      }),
  };
}
async function resolveRegistryPath(worktree) {
  const canonical = await fs.realpath(worktree);
  const run = require("node:util").promisify(
    require("node:child_process").execFile,
  );
  const { stdout: topLevel } = await run(
    "git",
    ["rev-parse", "--show-toplevel"],
    { cwd: canonical, timeout: 3000 },
  );
  if (canonical !== (await fs.realpath(topLevel.trim()))) {
    throw Error("Supplied directory must be the Git worktree root");
  }
  const legacyFile = path.join(
    require("node:os").homedir(),
    ".local",
    "state",
    "recovery",
    "stacks",
    "registry.json",
  );
  let legacy;
  try {
    legacy = JSON.parse(await fs.readFile(legacyFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
  if (legacy !== undefined) {
    validateRegistry(legacy);
    if (
      Object.values(legacy.stacks).some(
        (record) => path.basename(record.worktree) === path.basename(canonical),
      )
    ) {
      throw Error(
        "Legacy registry claims this stack name; manual ownership investigation required",
      );
    }
  }
  const { stdout } = await run(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: canonical, timeout: 3000 },
  );
  return path.join(await fs.realpath(stdout.trim()), "recovery-stacks");
}
module.exports = { createRegistry, portAvailable, resolveRegistryPath };

// Release is deliberately unavailable for existing reservations until complete
// domain teardown can be revalidated, including route ownership.
if (require.main === module) {
  (async () => {
    const [command, stackId, ...extra] = process.argv.slice(2);
    if (
      !["reserve", "status", "release"].includes(command) ||
      extra.length !== 0 ||
      (command === "release" ? !stackId : stackId !== undefined)
    ) {
      throw Error(
        "Usage: node scripts/stack-registry.cjs reserve|status OR release <stack-uuid> (reservation bookkeeping only)",
      );
    }
    const { execFile } = require("node:child_process");
    const run = require("node:util").promisify(execFile);
    const git = async (args) =>
      (await run("git", args, { timeout: 3000 })).stdout.trim();
    const worktree = await git(["rev-parse", "--show-toplevel"]);
    const registry = createRegistry({
      registryPath: await resolveRegistryPath(worktree),
    });
    console.log(JSON.stringify(await registry[command](worktree, stackId)));
  })().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
