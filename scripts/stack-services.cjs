// Private definitions: never serialize these into status/errors (native argv contains a secret).
// This module neither starts processes nor reads ambient credentials.
const fs = require("node:fs");
const path = require("node:path");
const names = [
  "convexCloud",
  "convexSite",
  "metro",
  "provider",
  "mailpitHttp",
  "mailpitSmtp",
];
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  );
const absolute = (value) =>
  typeof value === "string" &&
  !value.includes("\0") &&
  path.isAbsolute(value) &&
  path.normalize(value) === value;
function validate({ registry: r, worktree, backendBinary, seed } = {}) {
  if (
    !absolute(worktree) ||
    fs.realpathSync(worktree) !== worktree ||
    !r ||
    r.worktree !== worktree ||
    !uuid(r.stackId) ||
    !uuid(r.providerGeneration) ||
    r.stackId === r.providerGeneration ||
    !r.ports ||
    Object.keys(r.ports).length !== 6
  )
    throw Error();
  const ports = names.map((n) => r.ports[n]);
  if (
    !ports.every((p) => Number.isSafeInteger(p) && p > 0 && p <= 65535) ||
    new Set(ports).size !== 6
  )
    throw Error();
  if (backendBinary !== undefined && !absolute(backendBinary)) throw Error();
  return {
    backend: path.join(worktree, "packages/backend/.convex/local/default"),
    provider: path.join(worktree, ".recovery-stack/provider"),
    root: path.join(worktree, ".recovery-stack"),
  };
}
function buildStackServices(options = {}) {
  try {
    const state = validate(options),
      { registry: r, worktree, backendBinary, seed } = options;
    if (
      !absolute(backendBinary) ||
      !seed ||
      ![
        "LOCAL_CONVEX_INSTANCE_NAME",
        "LOCAL_CONVEX_INSTANCE_SECRET",
        "LOCAL_WORKOS_API_KEY",
      ].every(
        (k) =>
          typeof seed[k] === "string" &&
          seed[k].length > 0 &&
          !seed[k].includes("\0"),
      ) ||
      !/^sk_test_local_[a-f0-9]{64}$/.test(seed.LOCAL_WORKOS_API_KEY)
    )
      throw Error();
    const p = r.ports,
      origin = (n) => `http://127.0.0.1:${p[n]}`;
    const privateCommand = (args) => [
      "/bin/sh",
      "-c",
      'umask 077; exec "$@"',
      "recovery-local",
      ...args,
    ];
    const backend = privateCommand([
      backendBinary,
      "--interface",
      "127.0.0.1",
      "--port",
      String(p.convexCloud),
      "--site-proxy-port",
      String(p.convexSite),
      "--instance-name",
      seed.LOCAL_CONVEX_INSTANCE_NAME,
      "--instance-secret",
      seed.LOCAL_CONVEX_INSTANCE_SECRET,
      "--local-storage",
      path.join(state.backend, "storage"),
      "--disable-beacon",
      path.join(state.backend, "convex_local_backend.sqlite3"),
    ]);
    const provider = privateCommand([
      "node",
      "--experimental-strip-types",
      path.join(worktree, "packages/local-workos/src/cli.ts"),
      "--database",
      path.join(state.provider, "state.sqlite"),
      "--port",
      String(p.provider),
      "--provider-generation",
      r.providerGeneration,
    ]);
    const mailpit = privateCommand([
      "mailpit",
      "--listen",
      `127.0.0.1:${p.mailpitHttp}`,
      "--smtp",
      `127.0.0.1:${p.mailpitSmtp}`,
      "--database",
      path.join(state.root, "mailpit.sqlite"),
      "--disable-version-check",
      "--smtp-disable-rdns",
    ]);
    const metro = privateCommand([
      "node",
      path.join(worktree, "apps/mobile/node_modules/expo/bin/cli"),
      "start",
      path.join(worktree, "apps/mobile"),
      "--localhost",
      "--port",
      String(p.metro),
    ]);
    const entry = (name, command, url) => ({
      name,
      command,
      cwd: worktree,
      readiness: { http: url },
    });
    return [
      entry("convexCloud", backend, origin("convexCloud") + "/version"),
      entry("convexSite", backend, origin("convexCloud") + "/version"),
      entry("metro", metro, origin("metro") + "/status"),
      entry("provider", provider, origin("provider") + "/instance-info"),
      entry("mailpitHttp", mailpit, origin("mailpitHttp") + "/api/v1/info"),
      entry("mailpitSmtp", mailpit, origin("mailpitHttp") + "/api/v1/info"),
    ];
  } catch {
    throw Error("Local stack service definitions rejected");
  }
}
function prepareOwnedStateDirectories(options = {}) {
  try {
    const state = validate(options),
      { worktree, registry: r } = options;
    const uid = process.getuid(),
      marker = JSON.stringify({
        stackId: r.stackId,
        providerGeneration: r.providerGeneration,
      });
    function directory(dir, privateMode) {
      try {
        fs.mkdirSync(dir, { mode: 0o700 });
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
      }
      const st = fs.lstatSync(dir);
      if (
        !st.isDirectory() ||
        st.isSymbolicLink() ||
        st.uid !== uid ||
        (st.mode & 0o022) !== 0 ||
        (privateMode && (st.mode & 0o077) !== 0)
      )
        throw Error();
    }
    // Inspect every ancestor below the canonical worktree; never follow a state symlink.
    for (const dir of [state.backend, state.root, state.provider]) {
      let current = worktree;
      for (const part of path.relative(worktree, dir).split(path.sep)) {
        current = path.join(current, part);
        directory(current, current === dir || current.startsWith(state.root));
      }
      const file = path.join(dir, ".recovery-stack-owner.json");
      if (fs.existsSync(file)) {
        const st = fs.lstatSync(file);
        if (
          !st.isFile() ||
          st.isSymbolicLink() ||
          st.uid !== uid ||
          (st.mode & 0o077) !== 0 ||
          st.nlink !== 1 ||
          fs.readFileSync(file, "utf8") !== marker
        )
          throw Error();
      } else {
        if (fs.readdirSync(dir).length !== 0) throw Error();
        fs.writeFileSync(file, marker, { flag: "wx", mode: 0o600 });
      }
    }
    function inspectContents(dir) {
      for (const name of fs.readdirSync(dir)) {
        const file = path.join(dir, name),
          st = fs.lstatSync(file);
        if (
          st.isSymbolicLink() ||
          st.uid !== uid ||
          (st.mode & 0o077) !== 0 ||
          (!st.isDirectory() && (!st.isFile() || st.nlink !== 1))
        )
          throw Error();
        if (st.isDirectory()) inspectContents(file);
      }
    }
    inspectContents(state.backend);
    inspectContents(state.root);
    directory(path.join(state.backend, "storage"), true);
    return state;
  } catch {
    throw Error("Local stack state ownership rejected");
  }
}
module.exports = { buildStackServices, prepareOwnedStateDirectories };
