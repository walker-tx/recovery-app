import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const requestSourceUrl = new URL("./forgot-password-screen.tsx", import.meta.url);
const resetSourceUrl = new URL("./reset-password-screen.tsx", import.meta.url);
const requestRouteSourceUrl = new URL("../../../app/(auth)/forgot-password.tsx", import.meta.url);
const resetRouteSourceUrl = new URL("../../../app/(auth)/reset-password.tsx", import.meta.url);

test("recovery request matches the password-reset hierarchy", async () => {
  const source = await readFile(requestSourceUrl, "utf8");

  assert.ok(source.indexOf("‹ Sign in") < source.indexOf("PASSWORD"));
  assert.match(source, /accessibilityLabel="Sign in"/);
  assert.match(source, /Reset it/);
  assert.match(
    source,
    /Tell us the address on the account and we'll send a reset token\. Your groups and your counts aren't touched\./,
  );
  assert.match(source, /appearance="filled"[\s\S]*?label="Email"/);
  assert.match(source, /Send reset token/);
  assert.doesNotMatch(source, /send a link|Send the link/i);
  assert.doesNotMatch(source, /import \{ Card \}|<Card\./);
  assert.doesNotMatch(source, /Apple|Google|help/i);
});

test("accepted recovery shows enumeration-safe submitted-email confirmation", async () => {
  const source = await readFile(requestSourceUrl, "utf8");

  assert.match(source, /Check your email/);
  assert.match(source, /submittedEmail/);
  assert.match(source, /If there is an account for/);
  assert.match(source, /a reset token is on its way and is good for one hour\./);
  assert.match(source, /startRecovery/);
  assert.match(source, /Resend reset token/);
  assert.match(source, /cooldownSeconds/);
  assert.match(source, /onEnterResetToken/);
  assert.match(source, /Enter reset token/);
  assert.match(source, /Didn't arrive\? Check spam, then/);
  assert.ok(source.indexOf("Didn't arrive? Check spam, then") < source.indexOf("Resend reset token"));
  const sentState = source.slice(source.indexOf("{state.submittedEmail ? ("), source.indexOf(") : ("));
  assert.doesNotMatch(sentState, />PASSWORD</);
  assert.doesNotMatch(source, /onRecoveryStarted/);
  assert.doesNotMatch(source, /reset link|another link/i);
});

test("reset preserves token and confirmation checks in an open artifact-aligned form", async () => {
  const source = await readFile(resetSourceUrl, "utf8");

  assert.match(source, /<Typography variant="overline">PASSWORD<\/Typography>/);
  assert.match(source, /Set a new password/);
  assert.match(source, /appearance="filled"[\s\S]*?label="New password"/);
  assert.match(source, /description="Ten characters or more"/);
  assert.match(source, /label="Reset token"/);
  assert.match(source, /label="Confirm new password"/);
  assert.match(source, /Save password/);
  assert.doesNotMatch(source, /Save and sign in/);
  assert.doesNotMatch(source, /Sign out my other devices/);
  assert.doesNotMatch(source, /import \{ Card \}|<Card\./);
});

test("sent-state transition is announced once without making cooldown ticks live", async () => {
  const source = await readFile(requestSourceUrl, "utf8");

  assert.match(source, /AccessibilityInfo\.announceForAccessibility\("Check your email"\)/);
  assert.match(source, /\[state\.submittedEmail\]/);
  assert.doesNotMatch(source, /AccessibilityInfo\.announceForAccessibility\([^)]*cooldownSeconds/);
  assert.doesNotMatch(source, /cooldownSeconds > 0 \? <Typography accessibilityLiveRegion/);
});

test("recovery route controls pop when possible, fall back safely, and preserve the real reset path", async () => {
  const [requestRoute, resetRoute] = await Promise.all([
    readFile(requestRouteSourceUrl, "utf8"),
    readFile(resetRouteSourceUrl, "utf8"),
  ]);

  assert.match(requestRoute, /if \(router\.canGoBack\(\)\) router\.back\(\);[\s\S]*?else router\.replace\("\.\/sign-in"\)/);
  assert.match(requestRoute, /onBack=\{handleBack\}/);
  assert.match(requestRoute, /onEnterResetToken=\{\(\) => router\.push\("\.\/reset-password"\)\}/);
  assert.match(resetRoute, /router\.canGoBack\(\)/);
  assert.match(resetRoute, /router\.replace\("\.\/sign-in"\)/);
});

test("new password visibility control is explicit and accessible", async () => {
  const source = await readFile(resetSourceUrl, "utf8");

  assert.match(source, /accessibilityLabel=\{isPasswordVisible \? "Hide password" : "Show password"\}/);
  assert.match(source, /\{isPasswordVisible \? "HIDE" : "SHOW"\}/);
  assert.match(source, /secureTextEntry=\{!isPasswordVisible\}/);
});
