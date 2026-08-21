import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("./profile-screen.tsx", import.meta.url),
  "utf8",
);

test("the display-name return key advances to the first-name field", () => {
  const displayNameField = source.match(
    /<TextField[\s\S]*?label="Display name"[\s\S]*?\/>/,
  )?.[0];

  assert.ok(displayNameField, "expected the display-name TextField");
  assert.match(
    displayNameField,
    /onSubmitEditing=\{\(\) => firstNameRef\.current\?\.focus\(\)\}/,
  );
  assert.match(displayNameField, /returnKeyType="next"/);
  assert.match(displayNameField, /submitBehavior="submit"/);
});

test("editing either profile field clears a stale save error", () => {
  const displayNameHandler = source.match(
    /onChangeText=\{\(value\) => \{[\s\S]*?setDisplayName\(value\);[\s\S]*?\}\}/,
  )?.[0];
  const firstNameHandler = source.match(
    /onChangeText=\{\(value\) => \{[\s\S]*?setFirstName\(value\);[\s\S]*?\}\}/,
  )?.[0];

  assert.ok(displayNameHandler, "expected the display-name change handler");
  assert.ok(firstNameHandler, "expected the first-name change handler");
  assert.match(displayNameHandler, /setFormError\(null\)/);
  assert.match(firstNameHandler, /setFormError\(null\)/);
});
