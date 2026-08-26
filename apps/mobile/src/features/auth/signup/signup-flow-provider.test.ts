import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("./signup-flow-provider.tsx", import.meta.url);

test("signup flow owns only an opaque in-memory intent id", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /SignupFlowState = \{ intentId: string \| null \}/);
  assert.match(source, /case "started":[\s\S]*return \{ intentId: event\.intentId \}/);
  assert.doesNotMatch(source, /SecureStore|AsyncStorage|accessToken|refreshToken/);
});

test("completion, back-to-welcome, and provider remount clear the flow", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /initialSignupFlowState: SignupFlowState = \{ intentId: null \}/);
  assert.match(source, /case "completed":\s*case "backToWelcome":\s*return initialSignupFlowState/);
  assert.match(source, /useReducer\(signupFlowReducer, initialSignupFlowState\)/);
});
