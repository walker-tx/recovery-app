const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { validateSeed } = require("./stack-local-config.cjs");
const { buildStackConfiguration } = require("./stack-configuration.cjs");

// Deliberately inert on import. Only the runtime's explicit bootstrap callback
// may invoke this helper after reserving and starting its local backend.
const rejected = () => Error("Local Convex bootstrap rejected");
async function bounded(operation, milliseconds, effect) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = rejected();
          if (effect) error.ambiguous = true; // lifecycle must retain its lock
          reject(error);
          controller.abort();
        }, milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function execute(file, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      ...options,
      shell: false,
      stdio: "ignore",
    });
    child.once("error", (error) => {
      const safe = rejected();
      if (error.code === "ABORT_ERR") safe.ambiguous = true;
      reject(safe);
    });
    child.once("close", (code) => resolve({ code }));
  });
}
async function bootstrapLocalConvex({
  registry,
  worktree,
  seed,
  configuration,
  fetchImpl = globalThis.fetch,
  exec = execute,
} = {}) {
  try {
    if (
      !path.isAbsolute(worktree) ||
      fs.realpathSync(worktree) !== worktree ||
      registry.worktree !== worktree
    )
      throw rejected();
    validateSeed(seed);
    if (
      seed.RECOVERY_STACK_ID !== registry.stackId ||
      seed.RECOVERY_PROVIDER_GENERATION !== registry.providerGeneration ||
      seed.LOCAL_CONVEX_ADMIN_KEY === "pending"
    )
      throw rejected();
    const backend = configuration.backend;
    const expected = buildStackConfiguration({
      registry,
      bootstrap: {
        providerGeneration: registry.providerGeneration,
        clientId: backend.WORKOS_CLIENT_ID,
        issuer: backend.WORKOS_ISSUER,
        port: registry.ports.provider,
      },
      credentials: {
        stackId: registry.stackId,
        providerGeneration: registry.providerGeneration,
        apiKey: seed.LOCAL_WORKOS_API_KEY,
      },
    }).backend;
    for (const [name, value] of Object.entries(expected))
      if (backend[name] !== value) throw rejected();
    const url = expected.CONVEX_URL;
    const site = expected.CONVEX_SITE_URL;
    // Reject ambient deployment selection before even probing. Everything else
    // is excluded from the child through a small environment allowlist.
    for (const name of [
      "CONVEX_DEPLOY_KEY",
      "CONVEX_DEPLOYMENT",
      "CONVEX_SELF_HOSTED_ADMIN_KEY",
      "CONVEX_SELF_HOSTED_URL",
      "CONVEX_ADMIN_KEY",
    ]) {
      if (name in process.env) throw rejected();
    }
    for (const [name, value] of Object.entries({
      CONVEX_URL: url,
      CONVEX_CLOUD_URL: url,
      CONVEX_SITE_URL: site,
    })) {
      if (name in process.env && process.env[name] !== value) throw rejected();
    }
    const changes = Object.entries(expected)
      .filter(([name]) => !name.startsWith("CONVEX_"))
      .map(([name, value]) => ({ name, value }));
    for (const name of [
      "WORKOS_EMAIL_HMAC_KEY",
      "WORKOS_INTENT_ENCRYPTION_KEY",
    ])
      changes.push({ name, value: seed[name] });
    async function request(endpoint, options = {}, effect = false) {
      return bounded(
        async (signal) => {
          const response = await fetchImpl(url + endpoint, {
            ...options,
            redirect: "error",
            signal,
          });
          if (
            !response ||
            response.redirected ||
            response.status < 200 ||
            response.status >= 300 ||
            (response.url && response.url !== url + endpoint)
          )
            throw rejected();
          if (Number(response.headers.get("content-length")) > 8192)
            throw rejected();
          const reader = response.body?.getReader();
          if (!reader) return "";
          const chunks = [];
          let size = 0;
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              size += value.byteLength;
              if (size > 8192) {
                void reader.cancel().catch(() => {});
                throw rejected();
              }
              chunks.push(Buffer.from(value));
            }
          } finally {
            reader.releaseLock();
          }
          return Buffer.concat(chunks).toString("utf8");
        },
        5000,
        effect,
      );
    }
    async function verify() {
      if ((await request("/instance_name")) !== seed.LOCAL_CONVEX_INSTANCE_NAME)
        throw rejected();
    }
    await verify();
    await request(
      "/api/update_environment_variables",
      {
        method: "POST",
        headers: {
          Authorization: "Convex " + seed.LOCAL_CONVEX_ADMIN_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ changes }),
      },
      true,
    );
    await verify();
    const env = {
      CONVEX_URL: url,
      CONVEX_CLOUD_URL: url,
      CONVEX_SITE_URL: site,
      CI: "1",
    };
    for (const name of ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SystemRoot"])
      if (process.env[name]) env[name] = process.env[name];
    const result = await bounded(
      (signal) =>
        exec(
          "pnpm",
          [
            "--filter",
            "@recovery/backend",
            "exec",
            "convex",
            "deploy",
            "--url",
            url,
            "--admin-key",
            seed.LOCAL_CONVEX_ADMIN_KEY,
          ],
          { cwd: worktree, env, signal, shell: false, stdio: "ignore" },
        ),
      120000,
      true,
    );
    if (!result || result.code !== 0) throw rejected();
    return { environmentSynced: true, functionsPushed: true };
  } catch (error) {
    const safe = rejected();
    if (error?.ambiguous === true) safe.ambiguous = true;
    throw safe;
  }
}
module.exports = { bootstrapLocalConvex };
