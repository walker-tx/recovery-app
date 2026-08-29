import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("./profile-screen.tsx", import.meta.url),
  "utf8",
);

function getTextField(label: string) {
  return Array.from(source.matchAll(/<TextField\b[\s\S]*?\/>/g), ([field]) =>
    field,
  ).find((field) => field.includes(`label="${label}"`));
}

function getOnChangeText(field: string) {
  return field.match(
    /onChangeText=\{\(value\) => \{([\s\S]*?)\n\s*\}\}/,
  )?.[1];
}

test("the display-name return key advances to the first-name field", () => {
  const displayNameField = getTextField("Display name");

  assert.ok(displayNameField, "expected the display-name TextField");
  assert.match(
    displayNameField,
    /onSubmitEditing=\{\(\) => firstNameRef\.current\?\.focus\(\)\}/,
  );
  assert.match(displayNameField, /returnKeyType="next"/);
  assert.match(displayNameField, /submitBehavior="submit"/);
});

test("profile follows the artifact's open final-step composition", () => {
  assert.doesNotMatch(source, /import \{ Card \}/);
  assert.doesNotMatch(source, /<Card\./);
  assert.match(source, />LAST STEP</);
  assert.match(source, />\s*What should we call you\?\s*</);
  assert.match(source, /contentContainerStyle=\{\{ justifyContent: "flex-start" \}\}/);
  assert.equal(source.match(/appearance="filled"/g)?.length, 2);
  assert.match(source, /Only shown if you turn it on later\. Nobody is told it's missing\./);
  assert.match(source, /accessibilityLabel=\{isPending \? "Saving profile" : "Done"\}/);
  assert.match(source, /\{isPending \? "Saving" : "Done"\}/);
});

test("editing either profile field clears a stale save error", () => {
  const displayNameField = getTextField("Display name");
  const firstNameField = getTextField("First name");

  assert.ok(displayNameField, "expected the display-name TextField");
  assert.ok(firstNameField, "expected the first-name TextField");

  const displayNameHandler = getOnChangeText(displayNameField);
  const firstNameHandler = getOnChangeText(firstNameField);

  assert.ok(displayNameHandler, "expected the display-name change handler");
  assert.ok(firstNameHandler, "expected the first-name change handler");
  assert.match(
    displayNameHandler,
    /setDisplayName\(value\);[\s\S]*?setFormError\(null\)/,
  );
  assert.match(
    firstNameHandler,
    /setFirstName\(value\);[\s\S]*?setFormError\(null\)/,
  );
});
