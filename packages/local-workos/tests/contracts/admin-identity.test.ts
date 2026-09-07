import { assert, it, layer } from "@effect/vitest";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, Exit, FileSystem, Layer, Path, Schema } from "effect";
import {
  AdminIdentity,
  AdminRequest,
  AdminInputs,
} from "../../src/contracts/admin.ts";
import { acquireProvider } from "../../src/server/provider.ts";

const uuid = "11111111-1111-4111-8111-111111111111";
it.effect(
  "admin identity and request schemas reject missing malformed and oversized UUIDs",
  () =>
    Effect.gen(function* () {
      for (const schema of [AdminIdentity, AdminRequest]) {
        for (const field of ["stackId", "providerGeneration"]) {
          for (const value of [
            undefined,
            "",
            "bad",
            "11111111-1111-1111-8111-111111111111",
            "x".repeat(4097),
          ]) {
            const result = yield* Schema.decodeUnknownEffect(schema)({
              stackId: uuid,
              providerGeneration: uuid,
              worktree: "/tmp",
              operation: "status",
              input: {},
              [field]: value,
            }).pipe(Effect.exit);
            assert.ok(Exit.isFailure(result));
          }
        }
      }
      for (const worktree of [
        undefined,
        "",
        "relative",
        "/tmp/../tmp",
        "/" + "é".repeat(2048),
        "/tmp\0",
      ]) {
        const result = yield* Schema.decodeUnknownEffect(AdminIdentity)({
          stackId: uuid,
          providerGeneration: uuid,
          worktree,
        }).pipe(Effect.exit);
        assert.ok(Exit.isFailure(result));
      }
    }),
);

layer(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer), {
  excludeTestServices: true,
})((test) => {
  test.effect(
    "invalid admin identities fail before database or socket acquisition",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const directory = yield* fs.makeTempDirectoryScoped({
            prefix: "admin-id-",
          });
          const dir = yield* fs.realPath(directory);
          const alias = path.join(dir, "alias");
          yield* fs.symlink(dir, alias);
          for (const field of [
            "stackId",
            "worktree",
            "providerGeneration",
            "socketPath",
          ]) {
            const values =
              field === "socketPath"
                ? [path.join(dir, "a\0.sock")]
                : field === "worktree"
                  ? [
                      undefined,
                      "",
                      "relative",
                      dir + "/../" + dir.split("/").at(-1),
                      alias,
                      path.join(dir, "missing"),
                      "/" + "é".repeat(2048),
                    ]
                  : [
                      undefined,
                      "",
                      "bad",
                      "11111111-1111-1111-8111-111111111111",
                      "x".repeat(4097),
                    ];
            for (const value of values) {
              // Omitted generation remains supported by provider auto-generation.
              if (field === "providerGeneration" && value === undefined) {
                continue;
              }
              const admin = {
                socketPath: path.join(dir, "a.sock"),
                stackId: uuid,
                worktree: dir,
              };
              const options = {
                database: path.join(dir, "state.sqlite"),
                apiKey: `sk_test_local_${"a".repeat(64)}`,
                providerGeneration: uuid,
                admin,
              };
              const target = field === "providerGeneration" ? options : admin;
              if (value === undefined) {
                Reflect.deleteProperty(target, field);
              } else {
                Reflect.set(target, field, value);
              }
              const result = yield* Effect.scoped(
                acquireProvider(options),
              ).pipe(Effect.exit);
              assert.ok(Exit.isFailure(result));
              assert.deepEqual(yield* fs.readDirectory(dir), ["alias"]);
            }
          }
        }),
      ),
    { timeout: 10000 },
  );
});

it.effect("admin create uses provider password code-point limits", () =>
  Effect.gen(function* () {
    for (const [password, valid] of [
      ["a".repeat(11), false],
      ["a".repeat(12), true],
      ["a".repeat(128), true],
      ["a".repeat(129), false],
      ["😀".repeat(11), false],
      ["😀".repeat(12), true],
      ["😀".repeat(128), true],
      ["😀".repeat(129), false],
    ] as const) {
      const result = yield* Schema.decodeUnknownEffect(
        AdminInputs["users.create"],
      )({
        email: "test@example.com",
        password,
      }).pipe(Effect.exit);
      assert.equal(Exit.isSuccess(result), valid);
    }
  }),
);
