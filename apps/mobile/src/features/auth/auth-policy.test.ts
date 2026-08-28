import assert from "node:assert/strict";
import test from "node:test";

import {
  getFirstInvalidSignInField,
  getSignInValidation,
  normalizeEmail,
  toSafeSignInError,
} from "./auth-policy.ts";

test("normalizes returning-user email addresses", () => {
  assert.equal(normalizeEmail("  Person@Example.COM \n"), "person@example.com");
});

test("validates sign-in email and accepts existing eight-character passwords", () => {
  assert.deepEqual(getSignInValidation("not-an-email", "password"), {
    email: "Enter a valid email address.",
  });
  assert.deepEqual(getSignInValidation("person@example.com", "password"), {});
  assert.deepEqual(getSignInValidation("person@example.com", ""), {
    password: "Enter your password.",
  });
});

test("prioritizes the first invalid sign-in field for focus", () => {
  assert.equal(
    getFirstInvalidSignInField({
      email: "Enter a valid email address.",
      password: "Enter your password.",
    }),
    "email",
  );
  assert.equal(
    getFirstInvalidSignInField({ password: "Enter your password." }),
    "password",
  );
  assert.equal(getFirstInvalidSignInField({}), null);
});

test("maps every provider failure to a sanitized message", () => {
  const raw = "Invalid credentials for secret-provider@example.com";
  const safe = toSafeSignInError(new Error(raw));

  assert.equal(
    safe,
    "We couldn't sign you in. Check your email and password, then try again.",
  );
  assert.equal(safe.includes(raw), false);
});
