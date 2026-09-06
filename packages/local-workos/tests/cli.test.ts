import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { it } from "@effect/vitest";
import { Effect } from "effect";
const scopedLaunch = (args: string[], credential?: string) =>
  Effect.acquireRelease(
    Effect.sync(() => launch(args, credential)),
    (p) =>
      Effect.promise(async () => {
        p.child.kill("SIGKILL");
        await p.exited;
      }),
  );
const key = "sk_test_local_" + "a".repeat(64);
function launch(args: string[], credential = key) {
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      fileURLToPath(new URL("../src/cli.ts", import.meta.url)),
      ...args,
    ],
    {
      env: { PATH: process.env.PATH, LOCAL_WORKOS_API_KEY: credential },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const deadline = setTimeout(() => child.kill("SIGKILL"), 10000);
  const exited = new Promise<number | null>((resolve) =>
    child.on("close", (code) => {
      clearTimeout(deadline);
      resolve(code);
    }),
  );
  const ready = new Promise<Record<string, any>>((resolve, reject) => {
    child.stdout.on("data", () => {
      if (stdout.includes("\n")) {
        try {
          resolve(JSON.parse(stdout.split("\n")[0]!));
        } catch (e) {
          reject(e);
        }
      }
    });
    child.on("close", () => reject(new Error("Exited before readiness")));
  });
  void ready.catch(() => {});
  return { child, exited, ready, output: () => stdout + stderr };
}
// A successful bind both reserves an ephemeral port and probes a failed port.
async function reservePort(port = 0): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const reserved = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return reserved;
}
async function portAvailable(port: number): Promise<boolean> {
  try {
    await reservePort(port);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") return false;
    throw error;
  }
}
async function retryReadiness<T>(
  start: (port: number) => Promise<T>,
  reserve = reservePort,
  available = portAvailable,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const port = await reserve();
    try {
      return await start(port);
    } catch (error) {
      // Only initial readiness is retryable, and only with fresh collision evidence.
      if (attempt === 3 || (await available(port))) throw error;
    }
  }
}
const scopedReadyLaunch = (argsForPort: (port: number) => string[]) =>
  Effect.acquireRelease(
    Effect.promise(() =>
      retryReadiness(async (port) => {
        const p = launch(argsForPort(port));
        try {
          const ready = await p.ready;
          return { ...p, ready, port };
        } catch (error) {
          p.child.kill("SIGKILL");
          await p.exited;
          throw error;
        }
      }),
    ),
    (p) =>
      Effect.promise(async () => {
        p.child.kill("SIGKILL");
        await p.exited;
      }),
  );

it.live(
  "CLI emits authoritative readiness, persists identity, and handles signals",
  () =>
    Effect.gen(function* () {
      const dir = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "local-workos-cli-"))),
        (dir) =>
          Effect.promise(() => rm(dir, { recursive: true, force: true })),
      );
      const generation = randomUUID();
      const argsForPort = (port: number) => [
        "--database",
        join(dir, "provider.sqlite"),
        "--port",
        String(port),
        "--provider-generation",
        generation,
      ];
      let args: string[] = [];
      for (const signal of ["SIGTERM", "SIGINT"] as const) {
        const p = yield* scopedReadyLaunch(argsForPort);
        const { ready, port } = p;
        args = argsForPort(port);
        assert.deepEqual(Object.keys(ready).sort(), [
          "clientId",
          "issuer",
          "port",
          "providerGeneration",
        ]);
        assert.equal(ready.providerGeneration, generation);
        assert.equal(ready.port, port);
        assert.equal(
          ready.issuer,
          `https://local-workos.invalid/instances/${generation}`,
        );
        const jwksResponse = yield* Effect.promise(() =>
          fetch(`http://127.0.0.1:${port}/sso/jwks/${ready.clientId}`),
        );
        assert.equal(jwksResponse.status, 200);
        p.child.kill(signal);
        const exitCode = yield* Effect.promise(() => p.exited);
        assert.equal(exitCode, 0);
        assert.ok(!p.output().includes(key));
      }
      // A real-shaped WorkOS test key must never be accepted by the local CLI.
      for (const credential of [
        "sk_test_real_provider_fixture",
        ...[10, 13, 8232, 8233].map((code) => key + String.fromCharCode(code)),
      ]) {
        const wrongCredential = yield* scopedLaunch(args, credential);
        const rejected = yield* Effect.promise(() =>
          Promise.race([
            wrongCredential.exited,
            wrongCredential.ready.then(() => {
              wrongCredential.child.kill("SIGTERM");
              return wrongCredential.exited;
            }),
          ]),
        );
        assert.equal(rejected, 1);
      }
      const mismatch = yield* scopedLaunch([
        ...args.slice(0, -1),
        randomUUID(),
      ]);
      const mismatchExitCode = yield* Effect.promise(() => mismatch.exited);
      assert.equal(mismatchExitCode, 1);
      assert.ok(!mismatch.output().includes(key));
    }),
  { timeout: 25000 },
);
it.live(
  "CLI rejects absent secrets and invalid arguments without echoing inputs",
  () =>
    Effect.gen(function* () {
      for (const [args, credential] of [
        [[], key],
        [["--api-key", key], key],
        [
          [
            "--database",
            "/unused",
            "--port",
            "0",
            "--provider-generation",
            randomUUID(),
          ],
          key,
        ],
        [
          [
            "--database",
            "/unused",
            "--port",
            "12345",
            "--provider-generation",
            randomUUID(),
          ],
          "",
        ],
      ] as const) {
        const p = yield* scopedLaunch([...args], credential);
        const exitCode = yield* Effect.promise(() => p.exited);
        assert.equal(exitCode, 1);
        assert.ok(!p.output().includes(key));
        assert.ok(!p.output().includes("providerGeneration"));
      }
    }),
);

// Generic startup diagnostics cannot classify collisions: probe the failed port.
it.live("readiness retries a probed collision on a fresh reservation", () =>
  Effect.promise(async () => {
    const attempts: number[] = [];
    let nextPort = 31000;
    const failure = new Error("generic startup failure");
    const result = await retryReadiness(
      async (port) => {
        attempts.push(port);
        if (attempts.length === 1) throw failure;
        return port;
      },
      async () => nextPort++,
      async (port) => port !== 31000,
    );
    assert.deepEqual(attempts, [31000, 31001]);
    assert.equal(result, 31001);
  }),
);
it.live(
  "readiness preserves non-collision failures and caps persistent collisions",
  () =>
    Effect.promise(async () => {
      for (const available of [true, false]) {
        let attempts = 0;
        const failure = new Error("generic startup failure");
        await assert.rejects(
          retryReadiness(
            async () => {
              attempts++;
              throw failure;
            },
            async () => 31000 + attempts,
            async () => available,
          ),
          (error) => error === failure,
        );
        assert.equal(attempts, available ? 1 : 3);
      }
    }),
);

it.live("readiness probes a forced occupied port before retrying", () =>
  Effect.gen(function* () {
    const collision = yield* Effect.acquireRelease(
      Effect.promise(
        () =>
          new Promise<ReturnType<typeof createServer>>((resolve, reject) => {
            const server = createServer();
            server.once("error", reject);
            server.listen(0, "127.0.0.1", () => resolve(server));
          }),
      ),
      (server) =>
        Effect.promise(
          () =>
            new Promise<void>((resolve, reject) =>
              server.close((error) => (error ? reject(error) : resolve())),
            ),
        ),
    );
    const occupied = (collision.address() as { port: number }).port;
    let reservations = 0;
    const attempts: number[] = [];
    const port = yield* Effect.promise(() =>
      retryReadiness(
        async (candidate) => {
          attempts.push(candidate);
          if (candidate === occupied)
            throw new Error("generic startup failure");
          return candidate;
        },
        async () => (reservations++ === 0 ? occupied : reservePort()),
      ),
    );
    assert.deepEqual(attempts, [occupied, port]);
    assert.notEqual(port, occupied);
  }),
);
