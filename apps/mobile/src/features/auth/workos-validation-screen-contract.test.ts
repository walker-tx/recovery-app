import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./workos-validation-screen.tsx", import.meta.url), "utf8");

test("WorkOS validation screen renders only the narrow account identity", () => {
  assert.match(source, /Signed in with WorkOS/);
  assert.match(source, /account\.email/);
  assert.match(source, /account\.userId/);
  assert.match(source, /selectable/);
  assert.doesNotMatch(source, /accessToken|refreshToken|jwt|decode/i);
});

test("WorkOS validation screen waits for provider sign-out before navigating", () => {
  assert.match(source, /const \{ signOut, isSigningOut \} = useWorkOSSession\(\)/);
  assert.match(source, /try \{\s*await signOut\(\);\s*router\.replace\("\/\(auth\)\/sign-in"\)/);
  assert.match(source, /catch/);
});

test("WorkOS validation screen exposes a busy pending label and polite retry error", () => {
  assert.match(source, /isSigningOut \? "Signing out" : "Sign out"/);
  assert.match(source, /disabled=\{isSigningOut\}/);
  assert.match(source, /busy: isSigningOut/);
  assert.match(source, /accessibilityRole="alert"/);
  assert.match(source, /accessibilityLiveRegion="polite"/);
  assert.match(source, /Try again/);
});
