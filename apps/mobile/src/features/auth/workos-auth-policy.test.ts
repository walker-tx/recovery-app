import assert from "node:assert/strict";
import test from "node:test";

import {
  getFirstInvalidWorkOSSignInField,
  getWorkOSRouteDestination,
  getWorkOSSignInValidation,
  toSafeWorkOSSignInError,
} from "./workos-auth-policy.ts";

test("validates WorkOS sign-in fields and chooses the first invalid field", () => {
  const errors = getWorkOSSignInValidation("not-an-email", "");
  assert.deepEqual(errors, {
    email: "Enter a valid email address.",
    password: "Enter your password.",
  });
  assert.equal(getFirstInvalidWorkOSSignInField(errors), "email");
  assert.equal(
    getFirstInvalidWorkOSSignInField(
      getWorkOSSignInValidation("person@example.com", ""),
    ),
    "password",
  );
  assert.deepEqual(
    getWorkOSSignInValidation(" Person@Example.COM ", "password"),
    {},
  );
});

test("maps every WorkOS credential failure to one neutral message", () => {
  const providerDetail = "No user for secret-provider@example.com";
  const safe = toSafeWorkOSSignInError(new Error(providerDetail));
  assert.equal(
    safe,
    "We couldn't sign you in. Check your email and password, then try again.",
  );
  assert.equal(safe.includes(providerDetail), false);
});

test("unauthenticated startup resolves only to auth after restoration", () => {
  assert.equal(
    getWorkOSRouteDestination(
      { isLoading: true, isAuthenticated: false },
      undefined,
    ),
    "loading",
  );
  assert.equal(
    getWorkOSRouteDestination(
      { isLoading: false, isAuthenticated: false },
      undefined,
    ),
    "auth",
  );
});

test("authenticated routing waits for profile resolution without flashing a route", () => {
  assert.equal(
    getWorkOSRouteDestination(
      { isLoading: false, isAuthenticated: true },
      undefined,
    ),
    "loading",
  );
  assert.equal(
    getWorkOSRouteDestination(
      { isLoading: false, isAuthenticated: true },
      null,
    ),
    "onboarding",
  );
  assert.equal(
    getWorkOSRouteDestination(
      { isLoading: false, isAuthenticated: true },
      { onboardingComplete: true },
    ),
    "app",
  );
});

test("terminal invalidation routes to auth while retryable restoration stays unresolved", () => {
  assert.equal(
    getWorkOSRouteDestination(
      { isLoading: false, isAuthenticated: false },
      undefined,
    ),
    "auth",
  );
  assert.equal(
    getWorkOSRouteDestination(
      {
        isLoading: true,
        isAuthenticated: false,
        retry: { operation: "restore" },
      },
      undefined,
    ),
    "retry",
  );
});

test("authenticated refresh failure hides protected destinations until retry succeeds", () => {
  assert.equal(
    getWorkOSRouteDestination(
      {
        isLoading: false,
        isAuthenticated: true,
        retry: { operation: "refresh" },
      },
      { onboardingComplete: false },
    ),
    "retry",
  );
  assert.equal(
    getWorkOSRouteDestination(
      {
        isLoading: false,
        isAuthenticated: true,
        retry: { operation: "refresh" },
      },
      { onboardingComplete: true },
    ),
    "retry",
  );
});
