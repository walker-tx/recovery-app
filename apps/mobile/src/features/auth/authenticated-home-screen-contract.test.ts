import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("./authenticated-home-screen.tsx", import.meta.url);

test("the Sign out button runs the guarded Convex Auth action", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /createSubmissionGuard/);
  assert.match(
    source,
    /async function handleSignOut\(\) \{\s*await guard\.run\(undefined, async \(\) => \{[\s\S]*?await signOut\(\);[\s\S]*?\}\);\s*\}/,
  );
  assert.match(
    source,
    /<Button[\s\S]*?\bonPress=\{handleSignOut\}[\s\S]*?>/,
  );
});
