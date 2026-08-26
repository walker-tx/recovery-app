import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeNames = ["sign-up", "verify-email", "forgot-password", "reset-password"] as const;
const screenNames = [
  "signup/signup-screen",
  "signup/verify-email-screen",
  "recovery/forgot-password-screen",
  "recovery/reset-password-screen",
] as const;

test("inactive auth routes remain composition-only and accept no token parameters", async () => {
  for (const routeName of routeNames) {
    const source = await readFile(new URL(`../../app/(auth)/${routeName}.tsx`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /useLocalSearchParams|searchParams|setParams/);
    assert.doesNotMatch(source, /token|intentId/);
    assert.doesNotMatch(source, /useAction|useWorkOSSession|useSignupFlow/);
    assert.match(source, /return <[A-Z][A-Za-z]+Screen/);
  }
});

test("reset tokens and signup intents never enter route or persistence APIs", async () => {
  const sources = await Promise.all(
    [...routeNames.map((name) => `../../app/(auth)/${name}.tsx`), ...screenNames.map((name) => `./${name}.tsx`)].map(
      (path) => readFile(new URL(path, import.meta.url), "utf8"),
    ),
  );
  const source = sources.join("\n");
  assert.doesNotMatch(source, /SecureStore|AsyncStorage|useLocalSearchParams|setParams/);
});

test("every new auth submit handler uses the shared submission guard", async () => {
  for (const screenName of screenNames) {
    const source = await readFile(new URL(`./${screenName}.tsx`, import.meta.url), "utf8");
    assert.match(source, /createSubmissionGuard/);
    assert.match(source, /await guard\.run\(/);
    assert.match(source, /<Button[\s\S]*?onPress=\{handleSubmit\}/);
  }
});
