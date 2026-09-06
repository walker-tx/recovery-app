import assert from "node:assert/strict";
import test from "node:test";

import { toSafeAuthError } from "./auth-error-policy.ts";

test("auth failures map to fixed purpose-specific messages without leaking provider details", () => {
  const raw = new Error("WorkOS token secret-token for known@example.com");
  for (const purpose of [
    "signup",
    "verification",
    "recovery",
    "reset",
  ] as const) {
    const message = toSafeAuthError(purpose, raw);
    assert.doesNotMatch(message, /WorkOS|secret-token|known@example\.com/);
  }
  assert.equal(
    toSafeAuthError("verification", raw),
    "That code is invalid or expired. Start signup again if you need a new code.",
  );
  assert.equal(
    toSafeAuthError("recovery", raw),
    "We couldn't start password recovery. Try again.",
  );
});
