const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync, execFileSync } = require("node:child_process");
const { once } = require("node:events");
const { setTimeout: delay } = require("node:timers/promises");
const {
  WorkOS,
} = require("../packages/local-workos/node_modules/@workos-inc/node");
const {
  createRegistry,
  resolveRegistryPath,
  adminSocketPath,
} = require("./stack-registry.cjs");
const { createProcessInspector } = require("./stack-process-inspector.cjs");

const root = path.resolve(__dirname, "..");
const wrapper = path.join(root, "scripts/mock.sh");
const providerCli = path.join(root, "packages/local-workos/src/cli.ts");
const key = "sk_test_local_" + "a".repeat(64);
const password = "synthetic test password";

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 5000,
    stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: process.env.PATH, HOME: cwd, GIT_CONFIG_NOSYSTEM: "1" },
  }).trim();
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const kill = setTimeout(() => child.kill("SIGKILL"), 3000);
  try {
    await exited;
  } finally {
    clearTimeout(kill);
  }
}

async function fixture(t) {
  const directory = await fs.realpath(
    await fs.mkdtemp(path.join(os.tmpdir(), "recovery-cli-e2e-")),
  );
  const children = [];
  const sockets = [];
  t.after(async () => {
    await Promise.all(children.map(stop));
    for (const socket of sockets) {
      // The provider must remove its owned socket. Never unlink an unknown endpoint.
      assert.equal(
        await fs.lstat(socket).then(
          () => true,
          (error) => {
            if (error.code === "ENOENT") {
              return false;
            }
            throw error;
          },
        ),
        false,
        "provider leaked owned socket",
      );
    }
    await fs.rm(directory, { recursive: true, force: true });
  });
  const first = path.join(directory, "first");
  const second = path.join(directory, "second");
  await fs.mkdir(first, { mode: 0o700 });
  git(first, ["init", "-q"]);
  await fs.writeFile(
    path.join(first, "synthetic.txt"),
    "Synthetic CLI integration only\n",
  );
  await fs.writeFile(
    path.join(first, "mise.toml"),
    '[tools]\nnode = "24.16.0"\n',
  );
  git(first, ["add", "synthetic.txt", "mise.toml"]);
  git(first, [
    "-c",
    "user.name=Synthetic Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "fixture",
  ]);
  git(first, ["worktree", "add", "-q", "-b", "second", second]);
  const inspector = await createProcessInspector();
  t.after(() => inspector.close());
  const owners = new Map();
  const registry = createRegistry({
    registryPath: await resolveRegistryPath(first),
    inspectProcess: async (pid) => {
      const identity = await inspector.inspect(pid);
      return identity === null
        ? null
        : { ...identity, stackId: owners.get(pid) };
    },
  });
  async function startProvider(worktree) {
    const record = await registry.reserve(worktree);
    const socketPath = adminSocketPath(record);
    assert.equal(
      typeof socketPath,
      "string",
      "registry identity must determine admin endpoint",
    );
    sockets.push(socketPath);
    const state = path.join(worktree, ".recovery-stack/provider");
    await fs.mkdir(state, { recursive: true, mode: 0o700 });
    const child = spawn(
      process.execPath,
      [
        providerCli,
        "--database",
        path.join(state, "provider.sqlite"),
        "--port",
        String(record.ports.provider),
        "--provider-generation",
        record.providerGeneration,
        "--admin-socket",
        socketPath,
        "--stack-id",
        record.stackId,
        "--worktree",
        record.worktree,
      ],
      {
        cwd: worktree,
        env: {
          PATH: process.env.PATH,
          LOCAL_WORKOS_API_KEY: key,
          NODE_NO_WARNINGS: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    children.push(child);
    child.stderr.resume();
    const ready = await new Promise((resolve, reject) => {
      let output = "";
      const timer = setTimeout(
        () => reject(new Error("disposable provider readiness deadline")),
        10000,
      );
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`disposable provider exited ${code}`));
      });
      child.stdout.on("data", (chunk) => {
        output += chunk.toString();
        if (output.includes("\n")) {
          clearTimeout(timer);
          try {
            resolve(JSON.parse(output.split("\n")[0]));
          } catch {
            reject(new Error("invalid provider readiness"));
          }
        }
      });
    });
    assert.equal(ready.providerGeneration, record.providerGeneration);
    owners.set(child.pid, record.stackId);
    const identity = {
      ...(await inspector.inspect(child.pid)),
      stackId: record.stackId,
    };
    await registry.recordProcess(
      worktree,
      record.stackId,
      "provider",
      identity,
    );
    const nested = path.join(worktree, "nested/child");
    await fs.mkdir(nested, { recursive: true });
    return { record, child, nested, ready };
  }
  async function startMailpit(stack) {
    const { record } = stack;
    const state = path.join(record.worktree, ".recovery-stack/mailpit");
    await fs.mkdir(state, { recursive: true, mode: 0o700 });
    const child = spawn(
      "mailpit",
      [
        "--listen",
        `127.0.0.1:${record.ports.mailpitHttp}`,
        "--smtp",
        `127.0.0.1:${record.ports.mailpitSmtp}`,
        "--database",
        path.join(state, "mail.sqlite"),
      ],
      {
        cwd: record.worktree,
        env: { PATH: process.env.PATH },
        stdio: ["ignore", "ignore", "ignore"],
      },
    );
    children.push(child);
    const url = `http://127.0.0.1:${record.ports.mailpitHttp}`;
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      assert.equal(child.exitCode, null, "owned Mailpit exited during startup");
      try {
        const response = await fetch(`${url}/api/v1/info`, {
          signal: AbortSignal.timeout(100),
          redirect: "error",
        });
        if (response.ok) {
          const info = await response.json();
          assert.ok(
            info.Version.includes("1.31.0"),
            "fixture requires pinned Mailpit",
          );
          ready = true;
          break;
        }
      } catch {
        /* Bounded readiness of this fixture-owned child only. */
      }
      await delay(30);
    }
    assert.equal(ready, true, "Mailpit readiness deadline");
    owners.set(child.pid, record.stackId);
    const identity = {
      ...(await inspector.inspect(child.pid)),
      stackId: record.stackId,
    };
    await registry.recordProcess(
      record.worktree,
      record.stackId,
      ["mailpitHttp", "mailpitSmtp"],
      identity,
    );
    return { child, url };
  }
  return { first, second, startProvider, startMailpit, registry };
}

function cli(cwd, args, input = "") {
  const result = spawnSync("mise", ["exec", "--", wrapper, "--json", ...args], {
    cwd,
    input,
    encoding: "utf8",
    timeout: 12000,
    env: {
      PATH: `${path.dirname(process.execPath)}:${process.env.PATH}`,
      NODE_NO_WARNINGS: "1",
      MISE_GLOBAL_CONFIG_FILE: "/dev/null",
      MISE_TRUSTED_CONFIG_PATHS: git(cwd, ["rev-parse", "--show-toplevel"]),
    },
  });
  assert.equal(
    result.error,
    undefined,
    "CLI exceeded bounded subprocess execution",
  );
  const stream = result.status === 0 ? result.stdout : result.stderr;
  assert.equal(
    result.status === 0 ? result.stderr : result.stdout,
    "",
    "CLI streams mixed",
  );
  let envelope;
  try {
    envelope = JSON.parse(stream);
  } catch {
    const diagnostic = stream
      .replaceAll(key, "[redacted]")
      .replaceAll(password, "[redacted]")
      .slice(0, 500);
    assert.fail(
      `Entry did not emit JSON (exit ${result.status}): ${diagnostic}`,
    );
  }
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.ok, result.status === 0);
  return { ...result, envelope };
}

function mutation(stack, args) {
  return [
    ...args,
    "--expect-stack",
    stack.record.stackId,
    "--expect-generation",
    stack.record.providerGeneration,
  ];
}

test(
  "real CLI selects two isolated worktrees and administers only the verified provider",
  { timeout: 90000 },
  async (t) => {
    assert.equal(
      await fs
        .access(path.join(root, "packages/local-workos/src/mock.ts"))
        .then(
          () => true,
          () => false,
        ),
      true,
      "real CLI entry point must exist",
    );
    const f = await fixture(t);
    const a = await f.startProvider(f.first);
    const b = await f.startProvider(f.second);
    const status = cli(a.nested, ["status"]);
    assert.equal(status.status, 0);
    assert.equal(status.envelope.target.stackId, a.record.stackId);
    assert.equal(status.envelope.target.worktree, f.first);
    const explicit = cli(a.nested, ["--worktree", b.nested, "status"]);
    assert.equal(explicit.status, 0);
    assert.equal(explicit.envelope.target.stackId, b.record.stackId);
    const create = cli(
      a.nested,
      mutation(a, [
        "users",
        "create",
        "--email",
        "first@example.invalid",
        "--password-stdin",
        "--first-name",
        "Synthetic",
        "--verified",
        "true",
      ]),
      password,
    );
    assert.equal(create.status, 0);
    const listed = cli(a.nested, ["users", "list"]);
    assert.equal(listed.status, 0);
    assert.equal(listed.envelope.data.users.length, 1);
    const user = listed.envelope.data.users[0];
    assert.equal(user.email, "first@example.invalid");
    const sibling = cli(b.nested, ["users", "list"]);
    assert.equal(sibling.status, 0);
    assert.deepEqual(sibling.envelope.data.users, []);
    const updated = cli(
      a.nested,
      mutation(a, [
        "users",
        "update",
        user.id,
        "--first-name",
        "",
        "--last-name",
        "Updated",
      ]),
    );
    assert.equal(updated.status, 0, updated.stderr);
    assert.equal(updated.envelope.data.firstName, "");
    assert.equal(updated.envelope.data.lastName, "Updated");
    assert.equal(
      cli(
        a.nested,
        mutation(a, ["users", "verify", user.id, "--verified", "false"]),
      ).envelope.data.verified,
      false,
    );
    assert.equal(
      cli(
        a.nested,
        mutation(a, ["users", "verify", user.id, "--verified", "true"]),
      ).envelope.data.verified,
      true,
    );
    const sdk = new WorkOS(key, {
      apiHostname: "127.0.0.1",
      port: a.record.ports.provider,
      https: false,
      maxRetries: 0,
    });
    const authenticate = () =>
      sdk.userManagement.authenticateWithPassword({
        clientId: a.ready.clientId,
        email: user.email,
        password,
      });
    const auth = await authenticate();
    const sessions = cli(a.nested, ["sessions", "list", "--user", user.id]);
    assert.equal(sessions.status, 0, sessions.stderr);
    assert.equal(sessions.envelope.data.sessions.length, 1);
    const session = sessions.envelope.data.sessions[0];
    const revoke = cli(
      a.nested,
      mutation(a, ["sessions", "revoke", session.id]),
    );
    assert.equal(revoke.status, 0, revoke.stderr);
    assert.match(revoke.envelope.data.caveat, /JWT|expiry/i);
    await assert.rejects(
      sdk.userManagement.authenticateWithRefreshToken({
        clientId: a.ready.clientId,
        refreshToken: auth.refreshToken,
      }),
    );
    await authenticate();
    const all = cli(
      a.nested,
      mutation(a, ["sessions", "revoke-all", "--user", user.id]),
    );
    assert.equal(all.status, 0, all.stderr);
    assert.equal(all.envelope.data.revoked, 1);
    assert.deepEqual(
      cli(a.nested, ["sessions", "list"]).envelope.data.sessions,
      [],
    );
    const refused = cli(
      a.nested,
      mutation(b, ["users", "delete", user.id, "--confirm-email", user.email]),
    );
    assert.equal(refused.status, 3);
    assert.equal(refused.envelope.error.outcome, "not-applied");
    assert.equal(cli(a.nested, ["users", "get", user.id]).status, 0);
    const staleEmail = cli(
      a.nested,
      mutation(a, [
        "users",
        "delete",
        user.id,
        "--confirm-email",
        "stale@example.invalid",
      ]),
    );
    assert.equal(staleEmail.status, 3);
    assert.equal(cli(a.nested, ["users", "get", user.id]).status, 0);
    assert.equal(
      cli(
        a.nested,
        mutation(a, [
          "users",
          "delete",
          user.id,
          "--confirm-email",
          user.email,
        ]),
      ).status,
      0,
    );
    assert.deepEqual(cli(a.nested, ["users", "list"]).envelope.data.users, []);
    await stop(a.child);
    assert.equal(
      cli(b.nested, ["status"]).status,
      0,
      "stopping selected provider must preserve sibling",
    );
  },
);

async function sendMail(url, subject, to, text) {
  const response = await fetch(`${url}/api/v1/send`, {
    method: "POST",
    signal: AbortSignal.timeout(2000),
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      From: { Email: "sender@example.invalid" },
      To: [{ Email: to }],
      Subject: subject,
      Text: text,
    }),
  });
  assert.equal(response.ok, true, "synthetic Mailpit delivery failed");
}

test(
  "real CLI inbox list/read is registry-and-listener-bound across two pinned Mailpit processes",
  { timeout: 90000 },
  async (t) => {
    const f = await fixture(t);
    const a = await f.startProvider(f.first);
    const b = await f.startProvider(f.second);
    const inboxA = await f.startMailpit(a);
    const inboxB = await f.startMailpit(b);
    await sendMail(
      inboxA.url,
      "First synthetic subject",
      "first@example.invalid",
      "SYNTHETIC_BODY_ONLY",
    );
    await sendMail(
      inboxB.url,
      "Sibling synthetic subject",
      "sibling@example.invalid",
      "SIBLING_BODY_ONLY",
    );
    const listed = cli(a.nested, [
      "inbox",
      "list",
      "--to",
      "FIRST@example.invalid",
    ]);
    assert.equal(listed.status, 0, listed.stderr);
    assert.equal(listed.envelope.data.scanned, 1);
    assert.equal(listed.envelope.data.messages.length, 1);
    const message = listed.envelope.data.messages[0];
    assert.equal(message.read, false);
    assert.equal(listed.stdout.includes("SYNTHETIC_BODY_ONLY"), false);
    assert.equal(listed.stdout.includes("Snippet"), false);
    const wrongInbox = cli(b.nested, ["inbox", "read", message.id]);
    assert.notEqual(wrongInbox.status, 0);
    assert.equal(wrongInbox.envelope.error.outcome, "unknown");
    const read = cli(a.nested, ["inbox", "read", message.id]);
    assert.equal(read.status, 0, read.stderr);
    assert.equal(read.envelope.data.text, "SYNTHETIC_BODY_ONLY");
    assert.equal(read.envelope.data.readStateEffect, "marks-read");
    assert.equal(
      read.envelope.data.textProvenance,
      "mailpit-parsed-or-derived",
    );
    assert.equal(read.envelope.data.sensitive, true);
    assert.equal(
      cli(a.nested, ["inbox", "list"]).envelope.data.messages[0].read,
      true,
    );
    const sibling = cli(a.nested, ["--worktree", f.second, "inbox", "list"]);
    assert.equal(sibling.status, 0, sibling.stderr);
    assert.equal(
      sibling.envelope.data.messages[0].subject,
      "Sibling synthetic subject",
    );
    assert.equal(sibling.envelope.data.messages[0].read, false);
    await stop(inboxA.child);
    assert.notEqual(cli(a.nested, ["inbox", "list"]).status, 0);
    assert.equal(
      cli(b.nested, ["inbox", "list"]).status,
      0,
      "inbox sibling must survive selected cleanup",
    );
  },
);
