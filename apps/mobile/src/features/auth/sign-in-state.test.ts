import assert from "node:assert/strict";
import test from "node:test";

import { reduceSignInState } from "./sign-in-state.ts";

test("an authentication failure preserves the screen-owned credentials", () => {
  const entered = {
    email: "Person@Example.COM",
    password: "password",
    formError: null,
  };

  assert.deepEqual(
    reduceSignInState(entered, {
      type: "authenticationFailed",
      message: "Unable to sign in. Check your details and try again.",
    }),
    {
      ...entered,
      formError: "Unable to sign in. Check your details and try again.",
    },
  );
});

test("editing either credential clears a stale authentication error", () => {
  const failed = {
    email: "person@example.com",
    password: "password",
    formError: "Unable to sign in. Check your details and try again.",
  };

  assert.deepEqual(
    reduceSignInState(failed, {
      type: "emailChanged",
      value: "new@example.com",
    }),
    { ...failed, email: "new@example.com", formError: null },
  );
  assert.deepEqual(
    reduceSignInState(failed, {
      type: "passwordChanged",
      value: "new-password",
    }),
    { ...failed, password: "new-password", formError: null },
  );
});
