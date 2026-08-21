import assert from "node:assert/strict";
import test from "node:test";

import { getFieldAccessibilityHint } from "./field-accessibility.ts";

test("associates field errors with the input accessibility hint", () => {
  assert.equal(
    getFieldAccessibilityHint({ error: "Enter a display name." }),
    "Enter a display name.",
  );
  assert.equal(
    getFieldAccessibilityHint({
      accessibilityHint: "Shown when you return.",
      error: "Use 80 characters or fewer.",
    }),
    "Shown when you return. Use 80 characters or fewer.",
  );
});

test("uses field descriptions only while the field is valid", () => {
  assert.equal(
    getFieldAccessibilityHint({ description: "Your first name is optional." }),
    "Your first name is optional.",
  );
  assert.equal(
    getFieldAccessibilityHint({
      description: "Your first name is optional.",
      error: "Use 50 characters or fewer.",
    }),
    "Use 50 characters or fewer.",
  );
  assert.equal(getFieldAccessibilityHint({}), undefined);
});
