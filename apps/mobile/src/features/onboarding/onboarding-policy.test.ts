import assert from "node:assert/strict";
import test from "node:test";

import {
  getAuthenticatedDestination,
  getFirstInvalidProfileField,
  getProfileValidation,
  normalizeProfileInput,
} from "./onboarding-policy.ts";

test("routes authenticated users only after profile loading completes", () => {
  assert.equal(getAuthenticatedDestination(undefined), null);
  assert.equal(getAuthenticatedDestination(null), "onboarding");
  assert.equal(
    getAuthenticatedDestination({ onboardingComplete: false }),
    "onboarding",
  );
  assert.equal(
    getAuthenticatedDestination({ onboardingComplete: true }),
    "app",
  );
});

test("validates and normalizes profile input", () => {
  assert.deepEqual(getProfileValidation("   ", ""), {
    displayName: "Enter a display name.",
  });
  assert.deepEqual(getProfileValidation("x".repeat(81), "x".repeat(51)), {
    displayName: "Use 80 characters or fewer.",
    firstName: "Use 50 characters or fewer.",
  });
  assert.deepEqual(normalizeProfileInput("  Steady Walker  ", "  Sam  "), {
    displayName: "Steady Walker",
    firstName: "Sam",
  });
  assert.deepEqual(normalizeProfileInput("Steady Walker", "   "), {
    displayName: "Steady Walker",
    firstName: undefined,
  });
});

test("chooses the first invalid profile field for focus", () => {
  assert.equal(
    getFirstInvalidProfileField({
      displayName: "Enter a display name.",
      firstName: "Use 50 characters or fewer.",
    }),
    "displayName",
  );
  assert.equal(
    getFirstInvalidProfileField({ firstName: "Use 50 characters or fewer." }),
    "firstName",
  );
  assert.equal(getFirstInvalidProfileField({}), null);
});
