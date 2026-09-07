import { it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import assert from "node:assert/strict";
import { decodeProviderConfig } from "../../src/server/config.ts";
const options = {
  database: "/tmp/synthetic-lifetimes.sqlite",
  apiKey: `sk_test_local_${"48".repeat(32)}`,
};
it.effect(
  "lifetime defaults remain fixed and supplied values are validated",
  () =>
    Effect.gen(function* () {
      const defaults = yield* decodeProviderConfig(options);
      assert.deepEqual(defaults.lifetimes, {
        accessTokenSeconds: 300,
        sessionSeconds: 604800,
        verificationSeconds: 600,
        passwordResetSeconds: 1800,
      });
      for (const field of [
        "accessTokenSeconds",
        "sessionSeconds",
        "verificationSeconds",
        "passwordResetSeconds",
      ] as const) {
        for (const value of [0, -1, NaN, Infinity, 1.5, 2592001]) {
          const result = yield* Effect.exit(
            decodeProviderConfig({ ...options, lifetimes: { [field]: value } }),
          );
          assert.ok(Exit.isFailure(result));
        }
      }
      assert.ok(
        Exit.isFailure(
          yield* Effect.exit(
            decodeProviderConfig({
              ...options,
              lifetimes: { accessTokenSeconds: 3, sessionSeconds: 2 },
            }),
          ),
        ),
      );
      const short = yield* decodeProviderConfig({
        ...options,
        lifetimes: {
          accessTokenSeconds: 1,
          sessionSeconds: 1,
          verificationSeconds: 1,
        },
      });
      assert.equal(short.lifetimes.verificationSeconds, 1);
    }),
);
