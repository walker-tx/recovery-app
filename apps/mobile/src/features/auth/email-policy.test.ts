import assert from "node:assert/strict";
import test from "node:test";

import { getEmailError, normalizeEmail } from "./email-policy.ts";

test("email normalization trims edges and lowercases without provider-specific rewriting", () => {
  assert.equal(normalizeEmail(" Person.Name+Care@Example.COM \n"), "person.name+care@example.com");
  assert.equal(getEmailError("person@example.com"), undefined);
  assert.equal(getEmailError("person example.com"), "Enter a valid email address.");
});
