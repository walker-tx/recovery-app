import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, Server } from "node:net";
import { it, vi } from "@effect/vitest";
import { Data, Deferred, Effect, Fiber, Result, Schema } from "effect";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
class StartupFailure extends Data.TaggedError("StartupFailure")<{
  message: string;
}> {}

// Observe only the disposable child's synthetic environment, including error exits.
const assertBootstrapConsumed = `data:text/javascript,${encodeURIComponent(`
  process.on("exit", () => {
    if (Object.hasOwn(process.env, "LOCAL_WORKOS_API_KEY")) process.exitCode = 97;
  });
`)}`;
const scopedLaunch = (args: string[], credential?: string) =>
  Effect.acquireRelease(
    Effect.sync(() => launch(args, credential)),
    (p) =>
      Effect.gen(function* () {
        p.child.kill("SIGKILL");
        yield* Effect.promise(() => p.exited);
      }),
  );
const key = "sk_test_local_" + "a".repeat(64);
function launch(args: string[], credential = key) {
  const child = spawn(
    process.execPath,
    [
      "--experimental-strip-types",
      "--import",
      assertBootstrapConsumed,
      fileURLToPath(new URL("../../src/server/main.ts", import.meta.url)),
      ...args,
    ],
    {
      env: { LOCAL_WORKOS_API_KEY: credential },
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
  // oxlint-disable-next-line effecttsgo/global-timers -- Native child-process watchdog must run independently of the test Effect runtime.
  const deadline = setTimeout(() => child.kill("SIGKILL"), 10000);
  // oxlint-disable-next-line effecttsgo/new-promise -- Install close observation eagerly before any test fiber can yield.
  const exited = new Promise<number | null>((resolve) =>
    child.on("close", (code) => {
      clearTimeout(deadline);
      resolve(code);
    }),
  );
  // oxlint-disable-next-line effecttsgo/new-promise -- Readiness and close listeners must be attached together eagerly after spawn.
  const ready = new Promise<Record<string, unknown>>((resolve, reject) => {
    child.stdout.on("data", () => {
      if (stdout.includes("\n")) {
        try {
          const parsed = Schema.decodeUnknownSync(
            Schema.fromJsonString(Schema.Unknown),
          )(stdout.split("\n")[0]);
          assert.ok(
            parsed !== null &&
              typeof parsed === "object" &&
              !Array.isArray(parsed),
          );
          resolve(
            Schema.decodeUnknownSync(
              Schema.Record(Schema.String, Schema.Unknown),
            )(parsed),
          );
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
const listen = (port: number) =>
  Effect.callback<ReturnType<typeof createServer>, Error>((resume) => {
    const server = createServer();
    server.once("error", (error) => resume(Effect.fail(error)));
    server.listen(port, "127.0.0.1", () => resume(Effect.succeed(server)));
  });
const closeServer = (server: ReturnType<typeof createServer>) =>
  Effect.callback<void, Error>((resume) => {
    server.close((error) => resume(error ? Effect.fail(error) : Effect.void));
  });
const reservePort = (port = 0) =>
  Effect.gen(function* () {
    const server = yield* listen(port);
    const address = server.address();
    assert.ok(address !== null && typeof address === "object");
    const reserved = address.port;
    yield* closeServer(server);
    return reserved;
  }).pipe(
    // Finish the native bind-and-close probe even if its caller is interrupted.
    Effect.uninterruptible,
  );
const portAvailable = (port: number) =>
  reservePort(port).pipe(
    Effect.as(true),
    Effect.catch((error) =>
      "code" in error && error.code === "EADDRINUSE"
        ? Effect.succeed(false)
        : Effect.fail(error),
    ),
  );
function retryReadiness<T>(
  start: (port: number) => Effect.Effect<T, Error>,
  reserve: () => Effect.Effect<number, Error> = reservePort,
  available: (port: number) => Effect.Effect<boolean, Error> = portAvailable,
): Effect.Effect<T, Error> {
  return Effect.gen(function* () {
    for (let attempt = 1; ; attempt++) {
      const port = yield* reserve();
      const result = yield* start(port).pipe(Effect.result);
      if (Result.isSuccess(result)) {
        return result.success;
      }
      // Only initial readiness is retryable, and only with fresh collision evidence.
      if (attempt === 3) {
        return yield* Effect.fail(result.failure);
      }
      const isAvailable = yield* available(port).pipe(
        Effect.catch(() => Effect.fail(result.failure)),
      );
      if (isAvailable) {
        return yield* Effect.fail(result.failure);
      }
    }
  });
}
const scopedReadyLaunch = (argsForPort: (port: number) => string[]) =>
  Effect.acquireRelease(
    retryReadiness((port) =>
      Effect.gen(function* () {
        const p = launch(argsForPort(port));
        const ready = yield* Effect.tryPromise(() => p.ready).pipe(
          Effect.onError(() =>
            Effect.gen(function* () {
              p.child.kill("SIGKILL");
              yield* Effect.promise(() => p.exited);
            }),
          ),
        );
        return { ...p, ready, port };
      }),
    ),
    (p) =>
      Effect.gen(function* () {
        p.child.kill("SIGKILL");
        yield* Effect.promise(() => p.exited);
      }),
  );

it.live(
  "CLI emits authoritative readiness, persists identity, and handles signals",
  () =>
    Effect.gen(function* () {
      const dir = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "local-workos-cli-"))),
        (resource) =>
          Effect.promise(() => rm(resource, { recursive: true, force: true })),
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
        const clientId = ready.clientId;
        assert.ok(typeof clientId === "string");
        const jwksResponse = yield* HttpClient.get(
          `http://127.0.0.1:${port}/sso/jwks/${clientId}`,
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
    }).pipe(
      // oxlint-disable-next-line effecttsgo/strict-effect-provide -- This live test entry point owns the HTTP client layer.
      Effect.provide(FetchHttpClient.layer),
    ),
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
        [
          [
            "--database",
            "/unused",
            "--port",
            "12345",
            "--provider-generation",
            randomUUID(),
          ],
          "private-invalid-bootstrap-key",
        ],
      ] as const) {
        const p = yield* scopedLaunch([...args], credential);
        const exitCode = yield* Effect.promise(() => p.exited);
        assert.equal(exitCode, 1);
        assert.ok(!p.output().includes(key));
        if (credential !== "") {
          assert.ok(!p.output().includes(credential));
        }
        assert.ok(!p.output().includes("providerGeneration"));
      }
    }),
);

// Generic startup diagnostics cannot classify collisions: probe the failed port.
it.live("readiness retries a probed collision on a fresh reservation", () =>
  Effect.gen(function* () {
    const attempts: number[] = [];
    let nextPort = 31000;
    const failure = new StartupFailure({ message: "generic startup failure" });
    const result = yield* retryReadiness(
      (port) =>
        Effect.suspend(() => {
          attempts.push(port);
          return attempts.length === 1
            ? Effect.fail(failure)
            : Effect.succeed(port);
        }),
      () => Effect.sync(() => nextPort++),
      (port) => Effect.succeed(port !== 31000),
    );
    assert.deepEqual(attempts, [31000, 31001]);
    assert.equal(result, 31001);
  }),
);
it.live(
  "readiness preserves non-collision failures and caps persistent collisions",
  () =>
    Effect.gen(function* () {
      for (const available of [true, false]) {
        let attempts = 0;
        const failure = new StartupFailure({
          message: "generic startup failure",
        });
        const result = yield* retryReadiness(
          () =>
            Effect.suspend(() => {
              attempts++;
              return Effect.fail(failure);
            }),
          () => Effect.succeed(31000 + attempts),
          () => Effect.succeed(available),
        ).pipe(Effect.result);
        assert.ok(Result.isFailure(result));
        if (Result.isFailure(result)) {
          assert.equal(result.failure, failure);
        }
        assert.equal(attempts, available ? 1 : 3);
      }
    }),
);
it.live("readiness probes a forced occupied port before retrying", () =>
  Effect.gen(function* () {
    const collision = yield* Effect.acquireRelease(listen(0), (server) =>
      closeServer(server).pipe(Effect.orDie),
    );
    const address = collision.address();
    assert.ok(address !== null && typeof address === "object");
    const occupied = address.port;
    let reservations = 0;
    const attempts: number[] = [];
    const port = yield* retryReadiness(
      (candidate) =>
        Effect.suspend(() => {
          attempts.push(candidate);
          return candidate === occupied
            ? Effect.fail(
                new StartupFailure({ message: "generic startup failure" }),
              )
            : Effect.succeed(candidate);
        }),
      () =>
        Effect.suspend(() =>
          reservations++ === 0 ? Effect.succeed(occupied) : reservePort(),
        ),
    );
    assert.deepEqual(attempts, [occupied, port]);
    assert.notEqual(port, occupied);
  }),
);
it.live("interrupted port reservation closes a late native listener", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const listening = yield* Deferred.make<void>();
    let release = () => {};
    // oxlint-disable-next-line typescript/unbound-method -- The gate forwards the captured native server receiver.
    const originalListen = Server.prototype.listen;
    const spy = yield* Effect.acquireRelease(
      Effect.sync(() =>
        vi.spyOn(Server.prototype, "listen").mockImplementation(function (
          this: Server,
          ...args: Parameters<Server["listen"]>
        ) {
          this.once("listening", () =>
            Deferred.doneUnsafe(listening, Effect.void),
          );
          let released = false;
          release = () => {
            if (!released) {
              released = true;
              originalListen.apply(this, args);
            }
          };
          Deferred.doneUnsafe(entered, Effect.void);
          return this;
        }),
      ),
      (interceptor) =>
        Effect.gen(function* () {
          interceptor.mockRestore();
          const server = interceptor.mock.contexts[0];
          if (server instanceof Server && server.listening) {
            yield* closeServer(server).pipe(Effect.orDie);
          }
        }),
    );
    const owner = yield* reservePort().pipe(Effect.forkScoped);
    yield* Effect.addFinalizer(() => Effect.sync(release));
    yield* Deferred.await(entered).pipe(Effect.timeout("2 seconds"));
    yield* Effect.sync(() => owner.interruptUnsafe());
    release();
    yield* Deferred.await(listening).pipe(Effect.timeout("2 seconds"));
    yield* Fiber.await(owner).pipe(Effect.timeout("2 seconds"));
    const server = spy.mock.contexts[0];
    assert.ok(server instanceof Server);
    assert.equal(
      server.listening,
      false,
      "interrupted reservation leaked its listener",
    );
  }),
);

it.live(
  "readiness retry preserves startup failure when collision probe rejects",
  () =>
    Effect.gen(function* () {
      const original = new StartupFailure({
        message: "original startup failure",
      });
      const result = yield* retryReadiness(
        () => Effect.fail(original),
        () => Effect.succeed(43210),
        () => Effect.fail(new StartupFailure({ message: "probe failure" })),
      ).pipe(Effect.result);
      assert.ok(Result.isFailure(result));
      if (Result.isFailure(result)) {
        assert.equal(result.failure, original);
      }
    }),
);
