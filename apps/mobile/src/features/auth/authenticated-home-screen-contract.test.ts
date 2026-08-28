import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./authenticated-home-screen.tsx", import.meta.url), "utf8");

test("authenticated home restores quiet product content without identity details", () => {
  assert.match(source, /YOUR SPACE/);
  assert.match(source, /Welcome back/);
  assert.match(source, /Start where you are/);
  assert.doesNotMatch(source, /account|email|userId|accessToken|refreshToken|jwt|decode/i);
});

test("authenticated home awaits revocation-first provider sign-out before navigating", () => {
  assert.match(source, /useWorkOSSession/);
  const signOutIndex = source.indexOf("await signOut();");
  const navigationIndex = source.indexOf("router.replace");
  assert.notEqual(signOutIndex, -1);
  assert.notEqual(navigationIndex, -1);
  assert.ok(signOutIndex < navigationIndex);
  assert.match(source, /accessibilityLabel/);
  assert.match(source, /accessibilityRole="alert"/);
  assert.doesNotMatch(source, /useAuthActions/);
});
