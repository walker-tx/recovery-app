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

test("editing either profile field clears a stale save error", () => {
  const displayNameField = getTextField("Display name");
  const firstNameField = getTextField("First name (optional)");

  assert.ok(displayNameField, "expected the display-name TextField");
  assert.ok(firstNameField, "expected the first-name TextField");
  assert.match(displayNameField, /setDisplayName\(value\);[\s\S]*?setFormError\(null\)/);
  assert.match(firstNameField, /setFirstName\(value\);[\s\S]*?setFormError\(null\)/);
});
