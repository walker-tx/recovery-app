import assert from "node:assert/strict";
import test from "node:test";

import { getPasswordProfile } from "./auth-policy.ts";

test("normalizes returning-user identity without applying creation length rules", () => {
  assert.deepEqual(
    getPasswordProfile({
      email: "  Person@Example.COM ",
      flow: "signIn",
      password: "password",
    }),
    { email: "person@example.com" },
  );
});

test("rejects unsupported password flows", () => {
  assert.throws(
    () =>
      getPasswordProfile({
        email: "person@example.com",
        flow: "signUp",
        password: "long-enough",
      }),
    /Invalid credentials/,
  );
});
