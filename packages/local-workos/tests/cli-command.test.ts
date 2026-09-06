import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

it.live("Effect CLI renders help without bootstrap credentials", () =>
  Effect.gen(function* () {
    const dir = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), "local-workos-cli-path-"))),
      (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
    );
    const packagePath = join(dir, "provider spaces # % ü");
    yield* Effect.promise(() =>
      symlink(
        fileURLToPath(new URL("../", import.meta.url)),
        packagePath,
        process.platform === "win32" ? "junction" : "dir",
      ),
    );
    const cliUrl = new URL("src/cli.ts", pathToFileURL(packagePath + "/"));
    const result = yield* Effect.tryPromise(() =>
      promisify(execFile)(
        process.execPath,
        ["--experimental-strip-types", fileURLToPath(cliUrl), "--help"],
        { env: {}, timeout: 5000 },
      ),
    );
    expect(result.stdout).toContain("--database");
    expect(result.stdout).toContain("--port");
    expect(result.stdout).toContain("--provider-generation");
    expect(result.stdout).not.toContain("--api-key");
    expect(result.stderr).not.toContain("startup failed");
  }),
);

it.live("CLI schema failures do not reflect argument values", () =>
  Effect.gen(function* () {
    for (const args of [
      [
        "--database",
        "relative-private-path",
        "--port",
        "12345",
        "--provider-generation",
        "550e8400-e29b-41d4-a716-446655440000",
      ],
      [
        "--database",
        "/unused",
        "--port",
        "65536",
        "--provider-generation",
        "550e8400-e29b-41d4-a716-446655440000",
      ],
      [
        "--database",
        "/unused",
        "--port",
        "12345",
        "--provider-generation",
        "private-invalid-generation",
      ],
    ]) {
      const result = yield* Effect.promise(
        () =>
          new Promise<{
            code: number | string | null | undefined;
            output: string;
          }>((resolve) => {
            execFile(
              process.execPath,
              [
                "--experimental-strip-types",
                fileURLToPath(new URL("../src/cli.ts", import.meta.url)),
                ...args,
              ],
              {
                env: {
                  LOCAL_WORKOS_API_KEY: "sk_test_local_" + "a".repeat(64),
                },
                timeout: 5000,
              },
              (error, stdout, stderr) => {
                resolve({ code: error?.code, output: stdout + stderr });
              },
            );
          }),
      );
      expect(result.code).toBe(1);
      expect(result.output).toContain(
        "Local provider startup failed; check explicit configuration and owned state.\n",
      );
      for (const value of args.filter((_, index) => index % 2 === 1)) {
        expect(result.output).not.toContain(value);
      }
      expect(result.output).not.toContain("sk_test_local_");
    }
  }),
);
