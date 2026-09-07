import { layer } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { DatabaseSync } from "node:sqlite";
import { Cause, Effect, Exit, FileSystem, Option, Path } from "effect";
import assert from "node:assert/strict";
import { vi } from "vitest";
import {
  acquireProvider,
  ProviderStartupError,
} from "../../src/server/provider.ts";

const apiKey = `sk_test_local_${"ab".repeat(32)}`;

layer(NodeServices.layer, { excludeTestServices: true })(
  "provider acquisition ownership",
  (it) => {
    for (const suffix of ["", "-journal", "-wal", "-shm"]) {
      it.effect(
        `rejects hardlinked database${suffix} before acquiring resources`,
        () =>
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const dir = yield* fs.makeTempDirectoryScoped();
            yield* fs.chmod(dir, 0o700);
            const database = path.join(dir, "state.sqlite");
            const target = path.join(dir, "preserved");
            const bytes = "synthetic linked target must not change";
            yield* fs.writeFileString(target, bytes, { mode: 0o600 });
            yield* fs.link(target, database + suffix);
            assert.equal(Option.getOrThrow((yield* fs.stat(target)).nlink), 2);

            const sql = yield* Effect.acquireRelease(
              Effect.sync(() =>
                vi
                  .spyOn(DatabaseSync.prototype, "exec")
                  .mockImplementation(() => {
                    throw new Error("SQL acquisition must not begin");
                  }),
              ),
              (spy) => Effect.sync(() => spy.mockRestore()),
            );
            const close = yield* Effect.acquireRelease(
              Effect.sync(() => vi.spyOn(DatabaseSync.prototype, "close")),
              (spy) => Effect.sync(() => spy.mockRestore()),
            );
            const result = yield* Effect.exit(
              Effect.scoped(acquireProvider({ database, apiKey })),
            );

            assert.equal(yield* fs.readFileString(target), bytes);
            assert.equal(yield* fs.readFileString(database + suffix), bytes);
            if (suffix !== "") {
              assert.equal(yield* fs.exists(database), false);
            }
            assert.equal(sql.mock.calls.length, 0);
            assert.equal(close.mock.calls.length, 0);
            assert.ok(Exit.isFailure(result));
            const error = Option.getOrThrow(
              Cause.findErrorOption(result.cause),
            );
            assert.ok(error instanceof ProviderStartupError);
          }).pipe(Effect.scoped),
      );
    }

    it.effect("acquires a valid single-link database", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const dir = yield* fs.makeTempDirectoryScoped();
        yield* fs.chmod(dir, 0o700);
        const database = path.join(dir, "state.sqlite");
        yield* fs.writeFileString(database, "", { mode: 0o600 });
        assert.equal(Option.getOrThrow((yield* fs.stat(database)).nlink), 1);
        const provider = yield* acquireProvider({ database, apiKey });
        assert.ok(provider.port > 0);
        assert.equal(Option.getOrThrow((yield* fs.stat(database)).nlink), 1);
      }).pipe(Effect.scoped),
    );
  },
);
