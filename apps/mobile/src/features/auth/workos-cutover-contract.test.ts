import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appRoot = new URL("../../app/", import.meta.url);

async function route(path: string) {
  return await readFile(new URL(path, appRoot), "utf8");
}

test("root activates the WorkOS provider behind legacy storage cleanup", async () => {
  const source = await route("_layout.tsx");
  assert.match(source, /migrateLegacyConvexAuthStorage/);
  assert.match(source, /<WorkOSRootProvider client=\{convex\} \/>/);
  assert.doesNotMatch(source, /ConvexAuthProvider|@convex-dev\/auth/);
});

test("legacy storage cleanup fails closed with an accessible retry", async () => {
  const source = await route("_layout.tsx");
  assert.match(source, /setMigrationState\("error"\)/);
  assert.match(source, /accessibilityRole="alert"/);
  assert.match(source, /<Button[\s\S]*?onPress=\{retryMigration\}/);
});

test("live auth routes activate WorkOS sign-in and the authenticated home", async () => {
  const signIn = await route("(auth)/sign-in.tsx");
  const home = await route("(app)/home.tsx");
  const welcome = await route("(auth)/index.tsx");
  const authLayout = await route("(auth)/_layout.tsx");

  assert.match(signIn, /WorkOSSignInScreen/);
  assert.doesNotMatch(signIn, /onSignUp/);
  assert.match(signIn, /onForgotPassword/);
  assert.match(home, /AuthenticatedHomeScreen/);
  assert.match(welcome, /onSignUp/);
  assert.doesNotMatch(authLayout, /guard=\{false\}/);
});
