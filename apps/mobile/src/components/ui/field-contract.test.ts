import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("./field.tsx", import.meta.url);

test("text fields support filled treatment and an accessible trailing control", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /appearance\?: "outlined" \| "filled"/);
  assert.match(source, /endAdornment\?: ReactNode/);
  assert.match(
    source,
    /appearance\s+===\s+"filled"\s+\?\s+"border-transparent"\s+:\s+"border-line"/,
  );
  assert.match(source, /className=\{`min-h-touch flex-row/);
  assert.match(source, /className=\{`min-h-touch flex-1/);
  assert.doesNotMatch(source, /pr-xxxl/);
  assert.match(source, /\{endAdornment \? \(/);
});
