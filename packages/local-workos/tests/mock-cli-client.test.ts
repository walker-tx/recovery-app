// oxlint-disable-next-line effecttsgo/node-builtin-import -- Deliberately independent native HTTP fixture for the Effect client boundary.
import { createServer } from "node:http";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Disposable Unix socket fixture ownership.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
// oxlint-disable-next-line effecttsgo/node-builtin-import -- Native filesystem fixture path.
import { join } from "node:path";
import { Effect, Exit, Cause } from "effect";
import { expect, it } from "@effect/vitest";
import { adminRequest } from "../src/mock-client.ts";

const fixture = Effect.fn(function* (
  payload: (target: {
    stackId: string;
    providerGeneration: string;
    worktree: string;
  }) => string | Buffer,
  operation = "users.list",
) {
  const directory = yield* Effect.acquireRelease(
    Effect.promise(() => mkdtemp(join(tmpdir(), "mock-cli-"))),
    (path) => Effect.promise(() => rm(path, { recursive: true, force: true })),
  );
  const target = {
    adminSocket: join(directory, "a.sock"),
    stackId: "11111111-1111-4111-8111-111111111111",
    providerGeneration: "22222222-2222-4222-8222-222222222222",
    worktree: "/synthetic",
  };
  let requests = 0;
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      createServer((_req, res) => {
        requests++;
        res.end(payload(target));
      }),
    ),
    (owned) =>
      Effect.callback<void>((resume) => {
        owned.close(() => resume(Effect.void));
      }),
  );
  yield* Effect.callback<void>((resume) => {
    server.listen(target.adminSocket, () => resume(Effect.void));
  });
  const result = yield* Effect.exit(
    adminRequest(target, operation, { limit: 50 }, () => {}),
  );
  return { result, requests };
});
it.effect("projects bounded users list without secret extras", () =>
  Effect.gen(function* () {
    const { result, requests } = yield* fixture((identity) =>
      JSON.stringify({
        ok: true,
        identity,
        data: { users: [], nextCursor: null, secret: "canary" },
      }),
    );
    expect(result).toEqual(Exit.succeed({ users: [], nextCursor: null }));
    expect(requests).toBe(1);
  }),
);
it.effect.each(["identity", "schema", "oversize", "invalid-json"])(
  "refuses %s after mutation dispatch without retry",
  (kind) =>
    Effect.gen(function* () {
      const { result, requests } = yield* fixture(
        (identity) =>
          kind === "oversize"
            ? "x".repeat(1048577)
            : kind === "invalid-json"
              ? "not json"
              : JSON.stringify({
                  ok: true,
                  identity:
                    kind === "identity"
                      ? {
                          ...identity,
                          stackId: "33333333-3333-4333-8333-333333333333",
                        }
                      : identity,
                  data: { unexpected: true },
                }),
        "users.create",
      );
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        expect(Cause.squash(result.cause)).toMatchObject({
          outcome: "unknown",
        });
      }
      expect(requests).toBe(1);
    }),
);

it.effect.each(["users.list", "users.create"])(
  "rejects malformed UTF8 for %s even in otherwise valid JSON",
  (operation) =>
    Effect.gen(function* () {
      const { result, requests } = yield* fixture(
        (identity) =>
          Buffer.concat([
            Buffer.from(
              JSON.stringify({
                ok: true,
                identity,
                data:
                  operation === "users.list"
                    ? { users: [], nextCursor: null }
                    : {
                        id: "user_fixture",
                        email: "person@example.test",
                        firstName: null,
                        lastName: null,
                        verified: false,
                        createdAt: "2026-01-01",
                        updatedAt: "2026-01-01",
                      },
              }).slice(0, -1) + ',"ignored":"',
            ),
            Buffer.from([0xff]),
            Buffer.from('"}'),
          ]),
        operation,
      );
      expect(Exit.isFailure(result)).toBe(true);
      if (Exit.isFailure(result)) {
        expect(Cause.squash(result.cause)).toMatchObject({
          code: "INVALID_RESPONSE",
          outcome: operation === "users.list" ? "not-applied" : "unknown",
        });
      }
      expect(requests).toBe(1);
    }),
);
