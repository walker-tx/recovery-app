import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("./workos-sign-in-screen.tsx", import.meta.url),
  "utf8",
);
const routeSource = await readFile(
  new URL("../../app/(auth)/sign-in.tsx", import.meta.url),
  "utf8",
);

test("WorkOS sign-in uses the session hook and shared submission guard", () => {
  assert.match(source, /const \{ signIn \} = useWorkOSSession\(\)/);
  assert.match(source, /createSubmissionGuard/);
  assert.match(source, /await guard\.run\(/);
  assert.match(source, /email: normalizeEmail\(submittedValues\.email\)/);
});

test("WorkOS sign-in exposes only the accessible recovery navigation link", () => {
  assert.match(
    source,
    /<Button\s+accessibilityRole="link"[^>]*onPress=\{onForgotPassword\}[^>]*>\s*Forgot your password\?\s*<\/Button>/,
  );
  assert.doesNotMatch(source, /onSignUp|Create account/);
  assert.doesNotMatch(routeSource, /onSignUp|sign-up/);
});

test("WorkOS sign-in focuses invalid fields and announces neutral failures", () => {
  assert.match(source, /emailInput\.current\?\.focus\(\)/);
  assert.match(source, /passwordInput\.current\?\.focus\(\)/);
  assert.match(source, /accessibilityRole="alert"/);
  assert.match(source, /accessibilityLiveRegion="polite"/);
  assert.match(source, /toSafeWorkOSSignInError\(error\)/);
});
