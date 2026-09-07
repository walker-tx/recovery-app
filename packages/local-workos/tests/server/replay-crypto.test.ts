import { it } from "@effect/vitest";
import { Effect, Exit, Redacted, Schema } from "effect";
import assert from "node:assert/strict";
import {
  deriveReplayKey,
  sealReplay,
  openReplay,
} from "../../src/server/replay-crypto.ts";
it.effect(
  "replay ciphertext is randomized, identity-derived and authenticated to its exact row",
  () =>
    Effect.gen(function* () {
      const exponent = Buffer.from("synthetic-private-exponent").toString(
        "base64url",
      );
      const key = deriveReplayKey(exponent, "owned-generation");
      const recoveredKey = deriveReplayKey(exponent, "owned-generation");
      assert.equal(Redacted.isRedacted(key), true);
      const aad = yield* Schema.encodeEffect(
        Schema.fromJsonString(Schema.Json),
      )(["old-hash", "session-owned", 123]);
      const sealed = yield* sealReplay(key, "synthetic-token-pair", aad);
      assert.notEqual(
        sealed,
        yield* sealReplay(key, "synthetic-token-pair", aad),
      );
      assert.equal(
        yield* openReplay(recoveredKey, sealed, aad),
        "synthetic-token-pair",
      );
      for (const changed of [
        ["other-hash", "session-owned", 123],
        ["old-hash", "other-session", 123],
        ["old-hash", "session-owned", 124],
      ]) {
        assert.ok(
          Exit.isFailure(
            yield* Effect.exit(
              openReplay(
                key,
                sealed,
                yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(
                  changed,
                ),
              ),
            ),
          ),
        );
      }
      assert.ok(
        Exit.isFailure(
          yield* Effect.exit(
            openReplay(
              deriveReplayKey(exponent, "foreign-generation"),
              sealed,
              aad,
            ),
          ),
        ),
      );
    }),
);

it.effect(
  "replay envelopes round-trip empty plaintext and reject truncation",
  () =>
    Effect.gen(function* () {
      const key = deriveReplayKey("c3ludGhldGlj", "generation");
      const sealed = yield* sealReplay(key, "", "row");
      assert.equal(Buffer.from(sealed, "base64url").length, 28);
      assert.equal(yield* openReplay(key, sealed, "row"), "");
      assert.ok(
        Exit.isFailure(
          yield* Effect.exit(openReplay(key, sealed, "other-row")),
        ),
      );
      const truncated = Buffer.from(sealed, "base64url")
        .subarray(0, 27)
        .toString("base64url");
      assert.ok(
        Exit.isFailure(yield* Effect.exit(openReplay(key, truncated, "row"))),
      );
    }),
);
