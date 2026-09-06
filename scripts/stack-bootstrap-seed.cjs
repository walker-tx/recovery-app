const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const {
  persistLocalConfig,
  readLocalSeed,
  validateSeed,
} = require("./stack-local-config.cjs");
// Registry identity is supplied by the verified reservation, never ambient env.
// Returns private values only after persistence; caller may now start provider.
function prepareBootstrapSeed({
  registry,
  file,
  backendBinary,
  exec = spawnSync,
  run,
} = {}) {
  try {
    if (
      !registry ||
      !path.isAbsolute(registry.worktree) ||
      fs.realpathSync(registry.worktree) !== registry.worktree ||
      file !== path.join(registry.worktree, "mise.local.toml") ||
      !path.isAbsolute(backendBinary)
    )
      throw Error();
    const existing = readLocalSeed({
      file,
      stackId: registry.stackId,
      providerGeneration: registry.providerGeneration,
      run,
    });
    if (existing) return existing;
    const seed = {
      RECOVERY_STACK_ID: registry.stackId,
      RECOVERY_PROVIDER_GENERATION: registry.providerGeneration,
      LOCAL_WORKOS_API_KEY: "sk_test_local_" + randomBytes(32).toString("hex"),
      LOCAL_CONVEX_INSTANCE_NAME:
        "recovery_" + registry.stackId.replaceAll("-", ""),
      LOCAL_CONVEX_INSTANCE_SECRET: randomBytes(32).toString("hex"),
      LOCAL_CONVEX_ADMIN_KEY: "pending",
      WORKOS_EMAIL_HMAC_KEY: randomBytes(32).toString("base64"),
      WORKOS_INTENT_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    };
    validateSeed(seed);
    const result = exec(
      backendBinary,
      [
        "keygen",
        "admin-key",
        "--instance-name",
        seed.LOCAL_CONVEX_INSTANCE_NAME,
        "--instance-secret",
        seed.LOCAL_CONVEX_INSTANCE_SECRET,
      ],
      {
        cwd: registry.worktree,
        env: {},
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 8192,
      },
    );
    if (
      !result ||
      result.status !== 0 ||
      result.error ||
      typeof result.stdout !== "string"
    )
      throw Error();
    seed.LOCAL_CONVEX_ADMIN_KEY = result.stdout.endsWith("\n")
      ? result.stdout.slice(0, -1)
      : result.stdout;
    validateSeed(seed);
    persistLocalConfig({ file, owned: seed, run });
    return seed;
  } catch {
    throw Error("Local stack bootstrap seed rejected");
  }
}
module.exports = { prepareBootstrapSeed };
