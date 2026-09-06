// Explicit owned map only. No credential generation, ambient configuration merge,
// ownership adoption, or chmod of existing files. Callers never receive child output.
const fs = require("node:fs");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { buildStackConfiguration } = require("./stack-configuration.cjs");
const reject = () => {
  throw Error("Local stack config persistence rejected");
};
const seedKeys = [
  "RECOVERY_STACK_ID",
  "RECOVERY_PROVIDER_GENERATION",
  "LOCAL_WORKOS_API_KEY",
  "LOCAL_CONVEX_INSTANCE_NAME",
  "LOCAL_CONVEX_INSTANCE_SECRET",
  "LOCAL_CONVEX_ADMIN_KEY",
  "WORKOS_EMAIL_HMAC_KEY",
  "WORKOS_INTENT_ENCRYPTION_KEY",
];
const extraSeedKeys = seedKeys.slice(3);
function validateSeed(seed) {
  const uuid = (value) =>
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    );
  if (
    !seed ||
    Object.keys(seed).length !== seedKeys.length ||
    !seedKeys.every((k) => typeof seed[k] === "string") ||
    !uuid(seed.RECOVERY_STACK_ID) ||
    !uuid(seed.RECOVERY_PROVIDER_GENERATION) ||
    seed.RECOVERY_STACK_ID === seed.RECOVERY_PROVIDER_GENERATION ||
    !/^sk_test_local_[0-9a-f]{64}$/.test(seed.LOCAL_WORKOS_API_KEY) ||
    seed.LOCAL_CONVEX_INSTANCE_NAME !==
      "recovery_" + seed.RECOVERY_STACK_ID.replaceAll("-", "") ||
    !/^[0-9a-f]{64}$/.test(seed.LOCAL_CONVEX_INSTANCE_SECRET) ||
    !seed.LOCAL_CONVEX_ADMIN_KEY.trim() ||
    seed.LOCAL_CONVEX_ADMIN_KEY.length > 4096 ||
    /[\r\n\0]/.test(seed.LOCAL_CONVEX_ADMIN_KEY) ||
    !["WORKOS_EMAIL_HMAC_KEY", "WORKOS_INTENT_ENCRYPTION_KEY"].every(
      (k) =>
        Buffer.from(seed[k], "base64").length === 32 &&
        Buffer.from(seed[k], "base64").toString("base64") === seed[k],
    )
  )
    reject();
  return { ...seed };
}
function validate(owned) {
  if (!owned || typeof owned !== "object" || Array.isArray(owned)) reject();
  if (!Object.hasOwn(owned, "CONVEX_URL")) return validateSeed(owned);
  const extras = Object.fromEntries(
    extraSeedKeys
      .filter((k) => Object.hasOwn(owned, k))
      .map((k) => [k, owned[k]]),
  );
  if (Object.keys(extras).length)
    validateSeed(Object.fromEntries(seedKeys.map((k) => [k, owned[k]])));
  owned = Object.fromEntries(
    Object.entries(owned).filter(([k]) => !extraSeedKeys.includes(k)),
  );
  const port = (value) => {
    if (typeof value !== "string") reject();
    const url = new URL(value);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1") reject();
    return Number(url.port);
  };
  // Reuse the source-of-truth validator and compare every key; never guess a
  // broader key allowlist or accept deployment/admin selectors.
  const stackId = owned.RECOVERY_STACK_ID;
  const providerGeneration = owned.RECOVERY_PROVIDER_GENERATION;
  const ports = {
    convexCloud: port(owned.CONVEX_URL),
    convexSite: port(owned.CONVEX_SITE_URL),
    provider: port(owned.WORKOS_API_URL),
    mailpitHttp: port(owned.AUTH_EMAIL_DELIVERY_URL),
  };
  // Metro/SMTP do not occur in persisted owned values; supply unused valid ports.
  const unused = [1, 2, 3, 4, 5, 6].filter(
    (p) => !Object.values(ports).includes(p),
  );
  ports.metro = unused[0];
  ports.mailpitSmtp = unused[1];
  const expected = buildStackConfiguration({
    registry: { stackId, providerGeneration, ports },
    bootstrap: {
      providerGeneration,
      clientId: owned.WORKOS_CLIENT_ID,
      issuer: owned.WORKOS_ISSUER,
      port: ports.provider,
    },
    credentials: {
      stackId,
      providerGeneration,
      apiKey: owned.LOCAL_WORKOS_API_KEY,
    },
  }).owned;
  if (
    Object.keys(owned).length !== Object.keys(expected).length ||
    !Object.keys(expected).every(
      (k) => Object.hasOwn(owned, k) && owned[k] === expected[k],
    )
  )
    reject();
  return { ...expected, ...extras };
}
function snapshot(file) {
  let stat;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (
    !stat.isFile() ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.nlink !== 1
  )
    reject();
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(fd);
    if (opened.ino !== stat.ino || opened.dev !== stat.dev) reject();
    return { stat, bytes: fs.readFileSync(fd) };
  } finally {
    fs.closeSync(fd);
  }
}
function same(a, b) {
  return a === null || b === null
    ? a === b
    : a.stat.ino === b.stat.ino &&
        a.stat.dev === b.stat.dev &&
        a.stat.mtimeMs === b.stat.mtimeMs &&
        a.stat.ctimeMs === b.stat.ctimeMs &&
        a.bytes.equals(b.bytes);
}
function runMise(args, input) {
  const file = args[args.indexOf("--file") + 1];
  return spawnSync("mise", args, {
    cwd: os.tmpdir(),
    env: {
      PATH: process.env.PATH,
      HOME: os.tmpdir(),
      MISE_TRUSTED_CONFIG_PATHS: file,
    },
    input,
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  });
}
// Synchronous narrow lock serializes cooperating writers. A stale lock fails
// closed and requires operator cleanup. Parent directories must be trusted;
// hostile same-uid writers cannot be excluded by a portable rename protocol.
function persistLocalConfig({
  file,
  owned,
  run = runMise,
  deadlineMs = Infinity,
  now = () => performance.now(),
} = {}) {
  const checkDeadline = () => {
    if (now() >= deadlineMs)
      throw Object.assign(Error("Local stack config persistence rejected"), {
        ambiguousTimeout: true,
      });
  };
  let lock,
    temporary,
    locked = false;
  try {
    let values = validate(owned);
    if (typeof file !== "string" || !path.isAbsolute(file)) reject();
    const parent = path.dirname(file);
    if (fs.realpathSync(parent) !== parent) reject();
    lock = file + ".lock";
    fs.mkdirSync(lock, { mode: 0o700 });
    locked = true;
    const original = snapshot(file);
    if (original) {
      checkForbidden(file, run);
    }

    if (
      original &&
      extraSeedKeys
        .map((key) => readScalar(file, key, run, true))
        .some((value) => value !== null)
    ) {
      const seed = readLocalSeed({
        file,
        stackId: values.RECOVERY_STACK_ID,
        providerGeneration: values.RECOVERY_PROVIDER_GENERATION,
        run,
      });
      for (const key of seedKeys)
        if (Object.hasOwn(values, key) && values[key] !== seed[key]) reject();
      values = validate({ ...values, ...seed });
    }
    temporary = path.join(parent, `.stack-config-${randomUUID()}.toml`);
    fs.writeFileSync(temporary, original ? original.bytes : "", {
      flag: "wx",
      mode: 0o600,
    });
    const invoke = (args, input) => {
      const result = run(args, input);
      if (!result || result.status !== 0 || result.error) reject();
      return result.stdout;
    };
    const read = (key) =>
      invoke(["config", "get", "--file", temporary, `env.${key}`]);
    if (original) {
      for (const key of ["RECOVERY_STACK_ID", "RECOVERY_PROVIDER_GENERATION"]) {
        if (read(key) !== values[key] + "\n") reject();
      }
    }
    for (const [key, value] of Object.entries(values))
      invoke(["set", "--file", temporary, "--stdin", key], value);
    for (const [key, value] of Object.entries(values))
      if (read(key) !== value + "\n") reject();
    snapshot(temporary); // Mise must not have weakened private permissions.
    if (!same(original, snapshot(file))) reject();
    checkDeadline(); // Synchronous Mise calls cannot deliver an AbortSignal timer.
    fs.renameSync(temporary, file);
    temporary = undefined;
    checkDeadline(); // Publication cannot be undone if the atomic syscall crossed the deadline.
  } catch (error) {
    if (error?.ambiguousTimeout === true)
      throw Object.assign(Error("Local stack config persistence rejected"), {
        ambiguousTimeout: true,
      });
    reject();
  } finally {
    if (temporary) fs.rmSync(temporary, { force: true });
    if (locked) fs.rmdirSync(lock);
  }
}
function readScalar(file, key, run, optional = false) {
  const result = run(["config", "get", "--file", file, `env.${key}`]);
  if (
    result &&
    result.status === 0 &&
    !result.error &&
    typeof result.stdout === "string" &&
    result.stdout.endsWith("\n")
  )
    return result.stdout.slice(0, -1);
  const lines =
    typeof result?.stderr === "string" ? result.stderr.split("\n") : [];
  const prefix = `mise ERROR Key not found: env.${key} in `;
  const display = lines[0]?.startsWith(prefix)
    ? lines[0].slice(prefix.length)
    : "";
  const matchesFile =
    display === file ||
    (display.startsWith("~/") && file.endsWith(display.slice(1)));
  if (
    optional &&
    result?.status === 1 &&
    !result.error &&
    result.stdout === "" &&
    matchesFile &&
    lines.length === 4 &&
    /^mise ERROR Version: [^\r\n]+$/.test(lines[1]) &&
    lines[2] ===
      "mise ERROR Run with --verbose or MISE_VERBOSE=1 for more information" &&
    lines[3] === ""
  )
    return null;
  reject();
}
function checkForbidden(file, run) {
  for (const key of [
    "CONVEX_DEPLOY_KEY",
    "CONVEX_DEPLOYMENT",
    "CONVEX_SELF_HOSTED_ADMIN_KEY",
    "WORKOS_ADMIN_API_KEY",
  ])
    if (readScalar(file, key, run, true) !== null) reject();
}
function readLocalSeed({ file, stackId, providerGeneration, run = runMise }) {
  try {
    if (
      !path.isAbsolute(file) ||
      fs.realpathSync(path.dirname(file)) !== path.dirname(file)
    )
      reject();
    const original = snapshot(file);
    if (!original) return null;
    checkForbidden(file, run);
    const seed = validateSeed(
      Object.fromEntries(
        seedKeys.map((key) => [key, readScalar(file, key, run)]),
      ),
    );
    if (
      seed.RECOVERY_STACK_ID !== stackId ||
      seed.RECOVERY_PROVIDER_GENERATION !== providerGeneration ||
      !same(original, snapshot(file))
    )
      reject();
    return seed;
  } catch {
    reject();
  }
}
module.exports = { persistLocalConfig, readLocalSeed, validateSeed };
