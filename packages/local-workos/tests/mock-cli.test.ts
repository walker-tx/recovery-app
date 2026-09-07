// oxlint-disable-next-line effecttsgo/node-builtin-import -- Exercise the real subprocess boundary rather than mocking the CLI runtime.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

const entry = fileURLToPath(new URL("../src/mock.ts", import.meta.url));
const run = (args: string[]) =>
  Effect.callback<{ code: number; stdout: string; stderr: string }>(
    (resume) => {
      const child = execFile(
        process.execPath,
        [entry, ...args],
        { timeout: 5000 },
        (error, stdout, stderr) =>
          resume(
            Effect.succeed({
              code:
                typeof error?.code === "number" ? error.code : error ? 99 : 0,
              stdout,
              stderr,
            }),
          ),
      );
      child.stdin?.end();
      return Effect.sync(() => {
        if (child.exitCode === null) {
          child.kill();
        }
      });
    },
  );

describe("mock CLI output boundary", () => {
  it.effect("rejects an exhausted parser budget before help output", () =>
    Effect.gen(function* () {
      const result = yield* run(["--json", "--timeout-ms", "1", "--help"]);
      expect(result.code).toBe(4);
      expect(result.stdout).toBe("");
      expect(
        yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(Schema.Unknown),
        )(result.stderr),
      ).toMatchObject({
        ok: false,
        target: null,
        error: { code: "DEADLINE", outcome: "not-applied" },
      });
    }),
  );
  it.effect("help documents command arguments and inbox read safety", () =>
    Effect.gen(function* () {
      const result = yield* run(["inbox", "read", "--help", "--json"]);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      expect(
        yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(Schema.Unknown),
        )(result.stdout),
      ).toMatchObject({ ok: true, target: null, data: { kind: "help" } });
      for (const text of [
        "users get <user-id>",
        "users create --email <email> --password-stdin",
        "users update <user-id>",
        "users verify <user-id> --verified true|false",
        "users delete <user-id> --confirm-email <email>",
        "sessions list",
        "sessions revoke <session-id>",
        "sessions revoke-all --user <user-id>",
        "inbox list",
        "inbox read <message-id>",
        "--search",
        "--first-name",
        "--last-name",
        "--limit",
        "--cursor",
        "--to",
        "--expect-stack <stack>",
        "--expect-generation <generation>",
        "marks-read",
        "failed read may already have changed the unread flag",
        "Mailpit-parsed-or-derived",
        "4 KiB",
        "TTY",
        "preserves exact UTF-8",
        "mise exec -- ./scripts/mock.sh",
      ]) {
        expect(result.stdout).toContain(text);
      }
    }),
  );
  it.effect.each([
    ["--json", "--help"],
    ["users", "list", "--json", "--help"],
    ["--version", "--json"],
    ["users", "create", "--json", "--help"],
    ["users", "get", "--json", "--help"],
    ["sessions", "--json", "--help"],
    [
      "users",
      "verify",
      "--json",
      "--help",
      "--worktree",
      "/nonexistent-help-target",
    ],
    [
      "users",
      "verify",
      "--json",
      "--version",
      "--worktree",
      "/nonexistent-help-target",
    ],
  ])("structured nonservice success %j", (args) =>
    Effect.gen(function* () {
      const result = yield* run(args);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      expect(
        yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(Schema.Unknown),
        )(result.stdout),
      ).toMatchObject({
        schemaVersion: 1,
        ok: true,
        target: null,
      });
    }),
  );
  it.effect.each([
    ["--json", "--password", "secret-canary"],
    ["users", "create", "--json", "--password=secret-canary"],
    ["--json", "--wizard"],
    ["users", "create", "--json", "--help", "--password", "secret-canary"],
    ["users", "get", "--json", "--version", "--bogus=secret-canary"],
    ["status", "--json", "--help", "extra-canary"],
    ["users", "list", "--json", "--help", "--limit", "0"],
    ["users", "get", "--json"],
    ["users", "verify", "user_fixture", "--json"],
    ["users", "verify", "--json", "--help", "--verified", "invalid"],
    [
      "users",
      "delete",
      "user_fixture",
      "--json",
      "--expect-stack",
      "stack",
      "--expect-generation",
      "generation",
    ],
    ["users", "create", "--json", "--password-stdin"],
    ["users", "list", "--json", "--limit", "0"],
    ["--json", "--timeout-ms", "30001", "status"],
  ])("refuses unsafe/invalid arguments %j", (args) =>
    Effect.gen(function* () {
      const result = yield* run(args);
      expect(result.code).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toContain("secret-canary");
      expect(
        yield* Schema.decodeUnknownEffect(
          Schema.fromJsonString(Schema.Unknown),
        )(result.stderr),
      ).toMatchObject({
        schemaVersion: 1,
        ok: false,
        error: { outcome: "not-applied" },
      });
    }),
  );
});
