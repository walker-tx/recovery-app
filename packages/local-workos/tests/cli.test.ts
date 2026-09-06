import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
      new URL("../src/cli.ts", import.meta.url).pathname,
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
it.live(
  "CLI emits authoritative readiness, persists identity, and handles signals",
  () =>
    Effect.gen(function* () {
      const dir = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "local-workos-cli-"))),
        (dir) =>
          Effect.promise(() => rm(dir, { recursive: true, force: true })),
      );
      const reservation = createServer();
      yield* Effect.promise(
        () =>
          new Promise<void>((resolve) =>
            reservation.listen(0, "127.0.0.1", resolve),
          ),
      );
      const port = (
        reservation.address() as {
          port: number;
        }
      ).port;
      yield* Effect.promise(
        () =>
          new Promise<void>((resolve) => reservation.close(() => resolve())),
      );
      const generation = randomUUID();
      const args = [
        "--database",
        join(dir, "provider.sqlite"),
        "--port",
        String(port),
        "--provider-generation",
        generation,
      ];
      for (const signal of ["SIGTERM", "SIGINT"] as const) {
        const p = yield* scopedLaunch(args);
        const ready = yield* Effect.promise(() => p.ready);
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
