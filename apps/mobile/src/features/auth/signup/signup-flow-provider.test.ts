import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createInitialSignupFlowState, signupFlowReducer } from "./signup-flow-state.ts";

test("signup intent lifecycle is in-memory and clears on completion or back-to-welcome", () => {
  const initial = createInitialSignupFlowState();
  const started = signupFlowReducer(initial, { type: "started", intentId: "opaque-intent" });
  assert.deepEqual(started, { intentId: "opaque-intent" });
  assert.deepEqual(signupFlowReducer(started, { type: "completed" }), { intentId: null });
  assert.deepEqual(signupFlowReducer(started, { type: "backToWelcome" }), { intentId: null });
});

test("a provider remount creates a fresh empty signup flow", () => {
  const mounted = signupFlowReducer(createInitialSignupFlowState(), { type: "started", intentId: "opaque-intent" });
  const remounted = createInitialSignupFlowState();
  assert.deepEqual(mounted, { intentId: "opaque-intent" });
  assert.deepEqual(remounted, { intentId: null });
  assert.notEqual(remounted, createInitialSignupFlowState());
});

test("signup provider has no persistence or credential ownership", async () => {
  const source = await readFile(new URL("./signup-flow-provider.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /SecureStore|AsyncStorage|accessToken|refreshToken/);
});
