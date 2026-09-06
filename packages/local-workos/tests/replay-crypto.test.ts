import { it } from "@effect/vitest";
import { Effect, Exit, Redacted } from "effect";
import assert from "node:assert/strict";
import { deriveReplayKey, sealReplay, openReplay } from "../src/replay-crypto.ts";
it.effect("replay ciphertext is randomized, identity-derived and authenticated to its exact row", () => Effect.gen(function* () {
  const exponent = Buffer.from("synthetic-private-exponent").toString("base64url");
  const key = deriveReplayKey(exponent, "owned-generation");
  const recoveredKey = deriveReplayKey(exponent, "owned-generation");
  assert.equal(Redacted.isRedacted(key), true);
  const aad = JSON.stringify(["old-hash", "session-owned", 123]);
  const sealed = yield* sealReplay(key, "synthetic-token-pair", aad);
  assert.notEqual(sealed, yield* sealReplay(key, "synthetic-token-pair", aad));
  assert.equal(yield* openReplay(recoveredKey, sealed, aad), "synthetic-token-pair");
  for (const changed of [["other-hash", "session-owned", 123], ["old-hash", "other-session", 123], ["old-hash", "session-owned", 124]])
    assert.ok(Exit.isFailure(yield* Effect.exit(openReplay(key, sealed, JSON.stringify(changed)))));
  assert.ok(Exit.isFailure(yield* Effect.exit(openReplay(deriveReplayKey(exponent, "foreign-generation"), sealed, aad))));
}));
