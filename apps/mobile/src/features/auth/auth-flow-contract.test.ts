import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeNames = [
  "sign-up",
  "verify-email",
  "forgot-password",
  "reset-password",
] as const;
const screenNames = [
  "signup/signup-screen",
  "signup/verify-email-screen",
  "recovery/forgot-password-screen",
  "recovery/reset-password-screen",
] as const;

test("WorkOS signup and recovery routes are active in the auth navigator", async () => {
  const source = await readFile(
    new URL("../../app/(auth)/_layout.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /<Stack\.Screen name="sign-up" \/>[\s\S]*?<Stack\.Screen name="verify-email" \/>[\s\S]*?<Stack\.Screen name="forgot-password" \/>[\s\S]*?<Stack\.Screen name="reset-password" \/>/,
  );
  assert.doesNotMatch(source, /guard=\{false\}/);
});

test("active auth routes remain composition-only and accept no token parameters", async () => {
  for (const routeName of routeNames) {
    const source = await readFile(
      new URL(`../../app/(auth)/${routeName}.tsx`, import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /useLocalSearchParams|searchParams|setParams/);
    assert.doesNotMatch(source, /token|intentId/);
    assert.doesNotMatch(source, /useAction|useWorkOSSession|useSignupFlow/);
    assert.match(source, /return\s+(?:\(\s*)?<[A-Z][A-Za-z]+Screen/);
  }
});

test("reset tokens and signup intents never enter route or persistence APIs", async () => {
  const sources = await Promise.all(
    [
      ...routeNames.map((name) => `../../app/(auth)/${name}.tsx`),
      ...screenNames.map((name) => `./${name}.tsx`),
    ].map((path) => readFile(new URL(path, import.meta.url), "utf8")),
  );
  const source = sources.join("\n");
  assert.doesNotMatch(
    source,
    /SecureStore|AsyncStorage|useLocalSearchParams|setParams/,
  );
});

test("cooldown seconds stay visual without per-second accessibility announcements", async () => {
  const signupSource = await readFile(
    new URL("./signup/signup-screen.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    signupSource,
    /accessibilityLabel=\{\s*state\.isPending\s+\?\s+"Starting signup"\s+:\s+cooldownSeconds\s+>\s+0\s+\?\s+"Continue unavailable"\s+:\s+"Continue"\s*\}/,
  );
  const signupCooldownButton = signupSource.match(
    /<Button\s+([\s\S]*?)>\s*\{state\.isPending\s+\? "Starting signup"\s+: cooldownSeconds > 0\s+\? `Try again in \${cooldownSeconds}s`\s+: "Continue"\}/,
  );
  assert.ok(signupCooldownButton);
  assert.doesNotMatch(
    signupCooldownButton[1],
    /accessibilityLiveRegion|accessibilityLabel=\{[^}]*\$\{cooldownSeconds\}/,
  );

  const forgotPasswordSource = await readFile(
    new URL("./recovery/forgot-password-screen.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    forgotPasswordSource,
    /cooldownSeconds > 0\s+\?\s*\(\s*<Typography\s+selectable\s+variant="caption"\s*>\s*You can request another reset token in \{cooldownSeconds\} seconds\.\s*<\/Typography>/,
  );
  assert.match(
    forgotPasswordSource,
    /accessibilityLabel=\{\s*state\.isPending\s+\?\s+"Resending reset token"\s+:\s+cooldownSeconds\s+>\s+0\s+\?\s+"Resend unavailable"\s+:\s+"Resend reset token"\s*\}/,
  );
});

test("every new auth submit handler uses the shared submission guard", async () => {
  for (const screenName of screenNames) {
    const source = await readFile(
      new URL(`./${screenName}.tsx`, import.meta.url),
      "utf8",
    );
    assert.match(source, /createSubmissionGuard/);
    assert.match(source, /await guard\.run\(/);
    if (screenName === "signup/verify-email-screen") {
      assert.match(
        source,
        /if \(\/\^\\d\{6\}\$\/\.test\(value\)\)\s*\{\s*void handleSubmit\(value\);\s*\}/,
      );
    } else {
      assert.match(source, /<Button[\s\S]*?onPress=\{handleSubmit\}/);
    }
  }
});
