import assert from "node:assert/strict";
import test from "node:test";

import { initialWorkOSSignInState, reduceWorkOSSignInState } from "./workos-sign-in-state.ts";

test("WorkOS sign-in preserves credentials on failure and clears stale errors on edit", () => {
  const entered = {
    email: "Person@Example.COM",
    password: "password",
    formError: null,
  };
  const failed = reduceWorkOSSignInState(entered, {
    type: "authenticationFailed",
    message: "We couldn't sign you in. Check your email and password, then try again.",
  });

  assert.deepEqual(failed, {
    ...entered,
    formError: "We couldn't sign you in. Check your email and password, then try again.",
  });
  assert.deepEqual(
    reduceWorkOSSignInState(failed, { type: "emailChanged", value: "new@example.com" }),
    { ...failed, email: "new@example.com", formError: null },
  );
  assert.deepEqual(
    reduceWorkOSSignInState(failed, { type: "passwordChanged", value: "new-password" }),
    { ...failed, password: "new-password", formError: null },
  );
});

test("WorkOS sign-in starts empty and clears errors when submission begins", () => {
  assert.deepEqual(initialWorkOSSignInState, { email: "", password: "", formError: null });
  assert.deepEqual(
    reduceWorkOSSignInState(
      { ...initialWorkOSSignInState, formError: "Old error" },
      { type: "submissionStarted" },
    ),
    initialWorkOSSignInState,
  );
});
