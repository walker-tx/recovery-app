import assert from "node:assert/strict";
import test from "node:test";

import {
  RESEND_COOLDOWN_MS,
  getSignupValidation,
  getVerificationCodeError,
  initialSignupState,
  initialVerificationState,
  reduceSignupState,
  reduceVerificationState,
  resendSecondsRemaining,
} from "./signup-state.ts";

test("signup requires a valid email and ten-character password", () => {
  assert.deepEqual(getSignupValidation("not-an-email", "short"), {
    email: "Enter a valid email address.",
    password: "Use at least 10 characters.",
  });
  assert.deepEqual(getSignupValidation(" person@example.com ", "long-password"), {});
  assert.deepEqual(Object.keys(initialSignupState).sort(), [
    "cooldownUntil",
    "email",
    "formError",
    "isPending",
    "password",
  ]);
});

test("verification accepts exactly six digits", () => {
  assert.equal(getVerificationCodeError("12345"), "Enter the six-digit code.");
  assert.equal(getVerificationCodeError("12345a"), "Enter the six-digit code.");
  assert.equal(getVerificationCodeError("123456"), undefined);
});

test("signup and verification states expose pending transitions and clear stale errors", () => {
  const pendingSignup = reduceSignupState(initialSignupState, { type: "submissionStarted" });
  assert.equal(pendingSignup.isPending, true);
  const failedSignup = reduceSignupState(pendingSignup, { type: "submissionFailed", message: "Safe" });
  assert.deepEqual({ isPending: failedSignup.isPending, formError: failedSignup.formError }, { isPending: false, formError: "Safe" });
  assert.equal(reduceSignupState(failedSignup, { type: "emailChanged", value: "a@b.com" }).formError, null);

  const pendingVerification = reduceVerificationState(initialVerificationState, { type: "submissionStarted" });
  assert.equal(pendingVerification.isPending, true);
  assert.equal(reduceVerificationState(pendingVerification, { type: "submissionSucceeded" }).isPending, false);
});

test("accepted signup initiation protects its valid intent with a sixty-second cooldown", () => {
  const acceptedAt = 1_000;
  const pending = reduceSignupState(initialSignupState, { type: "submissionStarted" });
  const accepted = reduceSignupState(pending, { type: "submissionAccepted", acceptedAt });
  assert.equal(accepted.isPending, false);
  assert.equal(accepted.cooldownUntil, acceptedAt + RESEND_COOLDOWN_MS);
  assert.equal(resendSecondsRemaining(accepted.cooldownUntil, acceptedAt), 60);
  assert.equal(resendSecondsRemaining(accepted.cooldownUntil, acceptedAt + 59_001), 1);
  assert.equal(resendSecondsRemaining(accepted.cooldownUntil, acceptedAt + 60_000), 0);
});
