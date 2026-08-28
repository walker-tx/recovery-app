import assert from "node:assert/strict";
import test from "node:test";

import {
  getRecoveryValidation,
  getResetValidation,
  initialRecoveryState,
  initialResetState,
  reduceRecoveryState,
  reduceResetState,
  recoveryResendSecondsRemaining,
} from "./recovery-state.ts";

test("recovery validates and normalizes a public email without revealing account state", () => {
  assert.deepEqual(getRecoveryValidation("missing-at-sign"), { email: "Enter a valid email address." });
  assert.deepEqual(getRecoveryValidation(" person@example.com "), {});
});

test("accepted recovery initiation starts a sixty-second resend cooldown", () => {
  const acceptedAt = 5_000;
  const accepted = reduceRecoveryState(initialRecoveryState, { type: "submissionSucceeded", acceptedAt });
  assert.equal(recoveryResendSecondsRemaining(accepted.cooldownUntil, acceptedAt), 60);
  assert.equal(recoveryResendSecondsRemaining(accepted.cooldownUntil, acceptedAt + 60_000), 0);
});

test("manual reset requires a token, ten-character password, and confirmation", () => {
  assert.deepEqual(getResetValidation("   ", "short", "different"), {
    token: "Enter the reset token from the console.",
    password: "Use at least 10 characters.",
    confirmation: "Passwords do not match.",
  });
  assert.deepEqual(getResetValidation("opaque-token", "long-password", "long-password"), {});
});

test("recovery and reset pending states unlock after success or safe failure", () => {
  const recoveryPending = reduceRecoveryState(initialRecoveryState, { type: "submissionStarted" });
  assert.equal(recoveryPending.isPending, true);
  assert.equal(reduceRecoveryState(recoveryPending, { type: "submissionSucceeded", acceptedAt: 1_000 }).isPending, false);

  const resetPending = reduceResetState(initialResetState, { type: "submissionStarted" });
  const resetFailed = reduceResetState(resetPending, { type: "submissionFailed", message: "Safe" });
  assert.deepEqual({ isPending: resetFailed.isPending, formError: resetFailed.formError }, { isPending: false, formError: "Safe" });
  assert.equal(reduceResetState(resetFailed, { type: "tokenChanged", value: "new" }).formError, null);
});
