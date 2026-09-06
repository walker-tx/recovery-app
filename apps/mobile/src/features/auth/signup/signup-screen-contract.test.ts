import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const signupSourceUrl = new URL("./signup-screen.tsx", import.meta.url);
const verificationSourceUrl = new URL(
  "./verify-email-screen.tsx",
  import.meta.url,
);

test("signup matches the new-account credentials hierarchy", async () => {
  const source = await readFile(signupSourceUrl, "utf8");

  assert.ok(source.indexOf("‹ Back") < source.indexOf("NEW ACCOUNT"));
  assert.match(source, /accessibilityLabel="Back"/);
  assert.match(source, /Your email and a password/);
  assert.match(
    source,
    /We\s+use\s+the\s+address\s+to\s+get\s+you\s+back\s+in\s+if\s+you're\s+locked\s+out\.\s+Nothing\s+else\./,
  );
  assert.match(source, /appearance="filled"[\s\S]*?label="Email"/);
  assert.match(source, /appearance="filled"[\s\S]*?label="Password"/);
  assert.match(
    source,
    /Ten\s+characters\s+or\s+more\.\s+This\s+is\s+the\s+one\s+thing\s+you'll\s+need\s+to\s+remember\./,
  );
  assert.doesNotMatch(
    source,
    /Confirm password|confirmationInput|confirmationChanged/,
  );
  assert.doesNotMatch(source, /import \{ Card \}|<Card\./);
});

test("signup prevents immediate re-initiation without adding verification resend UI", async () => {
  const signupSource = await readFile(signupSourceUrl, "utf8");
  const verificationSource = await readFile(verificationSourceUrl, "utf8");

  assert.match(
    signupSource,
    /const cooldownSeconds = getSignupCooldownSecondsRemaining\(state, now\)/,
  );
  assert.match(signupSource, /submittedEmail, acceptedAt/);
  assert.match(
    signupSource,
    /dispatch\(\{ type: "emailChanged", value \}\);[\s\S]*?setNow\(Date\.now\(\)\)/,
  );
  assert.match(signupSource, /if \(cooldownSeconds > 0\)\s*\{\s*return;\s*\}/);
  assert.match(signupSource, /disabled=\{cooldownSeconds > 0\}/);
  assert.doesNotMatch(verificationSource, /Didn't arrive\?|resend/i);
});

test("signup password visibility is explicit and accessible", async () => {
  const source = await readFile(signupSourceUrl, "utf8");

  assert.match(
    source,
    /accessibilityLabel=\{\s*isPasswordVisible\s+\?\s+"Hide password"\s+:\s+"Show password"\s*\}/,
  );
  assert.match(source, /accessibilityRole="button"/);
  assert.match(source, /\{isPasswordVisible \? "HIDE" : "SHOW"\}/);
  assert.match(source, /secureTextEntry=\{!isPasswordVisible\}/);
});

test("verification matches the submitted-email code hierarchy", async () => {
  const source = await readFile(verificationSourceUrl, "utf8");

  assert.ok(
    source.indexOf("‹") < source.indexOf("submittedEmail.toUpperCase()"),
  );
  assert.match(source, /accessibilityLabel="Back"/);
  assert.match(source, /Six digits, from your inbox/);
  assert.match(source, /Just once, to prove the address is yours\./);
  assert.match(source, /maxLength=\{6\}/);
  assert.match(
    source,
    /if \(\/\^\\d\{6\}\$\/\.test\(value\)\)\s*\{\s*void handleSubmit\(value\);\s*\}/,
  );
  assert.match(source, /async function handleSubmit\(code: string\)/);
  assert.match(source, /await guard\.run\(\{ intentId, code \}/);
  assert.doesNotMatch(source, /Verify email|<Button/);
  assert.match(
    source,
    /state\.isPending \? \([\s\S]*?accessibilityLiveRegion="polite"[\s\S]*?Verifying…/,
  );
  assert.match(
    source,
    /Typo in the address\? Go back to use a different email\./,
  );
  assert.doesNotMatch(source, /nothing has been saved/i);
  assert.doesNotMatch(source, /Didn't arrive\?|resend/i);
  assert.doesNotMatch(source, /import \{ Card \}|<Card\./);
});
