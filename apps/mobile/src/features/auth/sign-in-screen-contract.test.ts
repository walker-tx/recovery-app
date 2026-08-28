import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("./workos-sign-in-screen.tsx", import.meta.url);

test("sign-in follows the returning-user design hierarchy", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.doesNotMatch(source, /import \{ Card \}/);
  assert.doesNotMatch(source, /<Card\./);
  assert.doesNotMatch(
    source,
    /Use the details already connected to your account\./,
  );
  assert.ok(source.indexOf("‹ Back") < source.indexOf("WELCOME BACK"));
  assert.match(source, /accessibilityLabel="Back"/);
  assert.match(
    source,
    /contentContainerStyle=\{\{ justifyContent: "flex-start" \}\}/,
  );
  assert.match(
    source,
    /<Button[\s\S]*?className="w-full"[\s\S]*?onPress=\{handleSubmit\}/,
  );
});

test("password visibility is explicit and accessible", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(
    source,
    /const \[isPasswordVisible, setIsPasswordVisible\] = useState\(false\)/,
  );
  assert.match(source, /secureTextEntry=\{!isPasswordVisible\}/);
  assert.match(
    source,
    /accessibilityLabel=\{isPasswordVisible \? "Hide password" : "Show password"\}/,
  );
  assert.match(source, /accessibilityRole="button"/);
  assert.match(source, /accessibilityState=\{\{ disabled: isPending \}\}/);
  assert.match(
    source,
    /onPress=\{\(\) => setIsPasswordVisible\(\(current\) => !current\)\}/,
  );
  assert.match(source, /\{isPasswordVisible \? "HIDE" : "SHOW"\}/);
});
