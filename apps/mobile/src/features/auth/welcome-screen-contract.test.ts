import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("./welcome-screen.tsx", import.meta.url);

test("welcome follows the artifact hierarchy with email authentication actions", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.doesNotMatch(source, /import \{ Card \}/);
  assert.doesNotMatch(source, /<Card\./);
  assert.match(source, />RECOVERY TRACKER</);
  assert.match(source, />\s*Count the days,\{"\\n"\}not alone\s*</);
  assert.match(
    source,
    /Nothing is public\. You choose a name, and you choose what the group sees\./,
  );
  assert.match(source, /contentContainerStyle=\{\{ justifyContent: "space-between" \}\}/);
  assert.match(source, /<Button[\s\S]*?onPress=\{onSignUp\}[\s\S]*?>\s*Create account\s*<\/Button>/);
  assert.match(source, /<Button[\s\S]*?onPress=\{onSignIn\}[\s\S]*?>\s*Sign in\s*<\/Button>/);
});
