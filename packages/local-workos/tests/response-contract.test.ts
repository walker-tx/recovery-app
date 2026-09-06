import { it, expect } from "@effect/vitest";
import { Effect } from "effect";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startProvider } from "../src/provider.ts";

it.live(
  "invalid stored user responses fail without exposing schema input",
  () =>
    Effect.gen(function* () {
      const directory = yield* Effect.acquireRelease(
        Effect.promise(() => mkdtemp(join(tmpdir(), "workos-response-"))),
        (directory) =>
          Effect.promise(() => rm(directory, { recursive: true, force: true })),
      );
      const database = join(directory, "state.sqlite");
      const apiKey = "sk_test_response_contract";
      const provider = yield* Effect.acquireRelease(
        Effect.promise(() => startProvider({ database, apiKey })),
        (provider) => Effect.promise(() => provider.close()),
      );
      const user = yield* Effect.promise(() =>
        provider.createIdentityFixture({
          email: "response@example.test",
          provider: "GoogleOAuth",
        }),
      );
      yield* Effect.sync(() => {
        const inspection = new DatabaseSync(database);
        try {
          inspection.prepare("UPDATE users SET body=? WHERE id=?").run(
            JSON.stringify({
              ...user,
              email: { privateValue: "synthetic-private-marker" },
            }),
            user.id,
          );
        } finally {
          inspection.close();
        }
      });
      const paths = [
        "/user_management/users/" + user.id,
        "/user_management/users",
      ];
      for (const path of paths) {
        const response = yield* Effect.promise(() =>
          fetch(`http://127.0.0.1:${provider.port}${path}`, {
            headers: { authorization: `Bearer ${apiKey}` },
          }),
        );
        expect(response.status).toBe(500);
        const body = yield* Effect.promise(() => response.json());
        expect(body).toEqual({ code: "internal_error" });
      }

      // Valid known fields remain readable; unexpected stored fields never escape.
      yield* Effect.sync(() => {
        const inspection = new DatabaseSync(database);
        try {
          inspection.prepare("UPDATE users SET body=? WHERE id=?").run(
            JSON.stringify({
              ...user,
              privateValue: "synthetic-private-marker",
            }),
            user.id,
          );
        } finally {
          inspection.close();
        }
      });
      for (const path of paths) {
        const response = yield* Effect.promise(() =>
          fetch(`http://127.0.0.1:${provider.port}${path}`, {
            headers: { authorization: `Bearer ${apiKey}` },
          }),
        );
        expect(response.status).toBe(200);
        const body = yield* Effect.promise(() => response.json());
        const returnedUser = path.endsWith(user.id) ? body : body.data[0];
        expect(returnedUser).toEqual(user);
        expect(JSON.stringify(body)).not.toContain("synthetic-private-marker");
      }
    }),
);
