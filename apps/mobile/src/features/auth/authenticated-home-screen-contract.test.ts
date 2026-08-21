import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("./authenticated-home-screen.tsx", import.meta.url);

test("sign-out uses the synchronous submission guard", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /createSubmissionGuard/);
  assert.match(source, /guard\.run\(undefined, async \(\) =>/);
});
