import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const signupSourceUrl = new URL("./signup-screen.tsx", import.meta.url);
const verificationSourceUrl = new URL("./verify-email-screen.tsx", import.meta.url);

test("signup matches the new-account credentials hierarchy", async () => {
  const source = await readFile(signupSourceUrl, "utf8");

  assert.ok(source.indexOf("‹ Back") < source.indexOf("NEW ACCOUNT"));
  assert.match(source, /accessibilityLabel="Back"/);
  assert.match(source, /Your email and a password/);
  assert.match(
    source,
    /We use the address to get you back in if you're locked out\. Nothing else\./,
  );
  assert.match(source, /appearance="filled"[\s\S]*?label="Email"/);
  assert.match(source, /appearance="filled"[\s\S]*?label="Password"/);
  assert.match(
    source,
    /Ten characters or more\. This is the one thing you'll need to remember\./,
  );
  assert.doesNotMatch(source, /Confirm password|confirmationInput|confirmationChanged/);
  assert.doesNotMatch(source, /import \{ Card \}|<Card\./);
});

test("signup prevents immediate re-initiation without adding verification resend UI", async () => {
  const signupSource = await readFile(signupSourceUrl, "utf8");
  const verificationSource = await readFile(verificationSourceUrl, "utf8");

  assert.match(signupSource, /const cooldownSeconds = resendSecondsRemaining\(state\.cooldownUntil, now\)/);
  assert.match(signupSource, /if \(cooldownSeconds > 0\) return/);
  assert.match(signupSource, /disabled=\{cooldownSeconds > 0\}/);
  assert.doesNotMatch(verificationSource, /Didn't arrive\?|resend/i);
});

test("signup password visibility is explicit and accessible", async () => {
  const source = await readFile(signupSourceUrl, "utf8");

  assert.match(source, /accessibilityLabel=\{isPasswordVisible \? "Hide password" : "Show password"\}/);
  assert.match(source, /accessibilityRole="button"/);
  assert.match(source, /\{isPasswordVisible \? "HIDE" : "SHOW"\}/);
  assert.match(source, /secureTextEntry=\{!isPasswordVisible\}/);
});

test("verification matches the submitted-email code hierarchy", async () => {
  const source = await readFile(verificationSourceUrl, "utf8");

  assert.ok(source.indexOf("‹") < source.indexOf("submittedEmail.toUpperCase()"));
  assert.match(source, /accessibilityLabel="Back"/);
  assert.match(source, /Six digits, from your inbox/);
  assert.match(source, /Just once, to prove the address is yours\./);
  assert.match(source, /maxLength=\{6\}/);
  assert.match(source, /Typo in the address\? Change it — nothing has been saved yet\./);
  assert.doesNotMatch(source, /Didn't arrive\?|resend/i);
  assert.doesNotMatch(source, /import \{ Card \}|<Card\./);
});
