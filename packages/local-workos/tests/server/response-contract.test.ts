import { it, expect } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startProvider } from "../../src/server/provider.ts";

it.layer(FetchHttpClient.layer, { excludeTestServices: true })((test) => {
  test.effect(
    "invalid stored user responses fail without exposing schema input",
    () =>
      Effect.gen(function* () {
        const directory = yield* Effect.acquireRelease(
          Effect.promise(() => mkdtemp(join(tmpdir(), "workos-response-"))),
          (resource) =>
            Effect.promise(() =>
              rm(resource, { recursive: true, force: true }),
            ),
        );
        const database = join(directory, "state.sqlite");
        const apiKey = `sk_test_local_${"01".repeat(32)}`;
        const provider = yield* Effect.acquireRelease(
          Effect.promise(() => startProvider({ database, apiKey })),
          (resource) => Effect.promise(() => resource.close()),
        );
        const user = yield* Effect.promise(() =>
          provider.createIdentityFixture({
            email: "response@example.test",
            provider: "GoogleOAuth",
          }),
        );
        const invalidBody = yield* Schema.encodeEffect(
          Schema.fromJsonString(Schema.Unknown),
        )({ ...user, email: { privateValue: "synthetic-private-marker" } });
        yield* Effect.sync(() => {
          const inspection = new DatabaseSync(database);
          try {
            inspection
              .prepare("UPDATE users SET body=? WHERE id=?")
              .run(invalidBody, user.id);
          } finally {
            inspection.close();
          }
        });
        const paths = [
          "/user_management/users/" + user.id,
          "/user_management/users",
        ];
        for (const path of paths) {
          const response = yield* HttpClient.get(
            `http://127.0.0.1:${provider.port}${path}`,
            {
              headers: { authorization: `Bearer ${apiKey}` },
            },
          );
          expect(response.status).toBe(500);
          const text = yield* response.text;
          const body = yield* Schema.decodeUnknownEffect(
            Schema.fromJsonString(Schema.Unknown),
          )(text);
          expect(body).toEqual({ code: "internal_error" });
        }

        // Valid known fields remain readable; unexpected stored fields never escape.
        const extraBody = yield* Schema.encodeEffect(
          Schema.fromJsonString(Schema.Unknown),
        )({ ...user, privateValue: "synthetic-private-marker" });
        yield* Effect.sync(() => {
          const inspection = new DatabaseSync(database);
          try {
            inspection
              .prepare("UPDATE users SET body=? WHERE id=?")
              .run(extraBody, user.id);
          } finally {
            inspection.close();
          }
        });
        for (const path of paths) {
          const response = yield* HttpClient.get(
            `http://127.0.0.1:${provider.port}${path}`,
            {
              headers: { authorization: `Bearer ${apiKey}` },
            },
          );
          expect(response.status).toBe(200);
          const text = yield* response.text;
          const body = yield* Schema.decodeUnknownEffect(
            Schema.fromJsonString(Schema.Unknown),
          )(text);
          const returnedUser = path.endsWith(user.id)
            ? body
            : (yield* Schema.decodeUnknownEffect(
                Schema.Struct({ data: Schema.Array(Schema.Unknown) }),
              )(body)).data[0];
          expect(returnedUser).toEqual(user);
          expect(text).not.toContain("synthetic-private-marker");
        }
      }),
  );
});
