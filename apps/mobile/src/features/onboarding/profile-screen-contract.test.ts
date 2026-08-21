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
