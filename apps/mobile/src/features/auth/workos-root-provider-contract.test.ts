import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./workos-root-provider.tsx", import.meta.url), "utf8");

test("structural: lifetime keys Convex confirmation and its protected route subtree", () => {
  assert.match(source, /<WorkOSLifetime client=\{client\} \/>/);
  assert.match(source, /<WorkOSSyncLifetime key=\{lifetime\}/);
  assert.match(source, /const \{ isAuthenticated \} = useConvexAuth\(\)/);
  assert.match(source, /<WorkOSProfileBoundary><WorkOSProfileObserver/);
});

test("protected retries dispatch restore and authenticated refresh through their matching callbacks", () => {
  assert.match(source, /operation === "restore" \? session\.retryRestore : session\.refresh/);
  assert.match(source, /destination === "retry"/);
  assert.match(source, /<WorkOSRetryState onRetry=\{retry\} \/>/);
});

test("paused retry is announced without active progress semantics", () => {
  const retryState = source.match(
    /function WorkOSRetryState[\s\S]*?(?=\nfunction WorkOSMissingConfiguration)/,
  )?.[0];
  assert.ok(retryState, "expected a dedicated retry state");
  assert.match(retryState, /accessibilityRole="alert"/);
  assert.match(retryState, /accessibilityLiveRegion="polite"/);
  assert.doesNotMatch(retryState, /ActivityIndicator|progressbar/);
  assert.match(retryState, /onRetry\(\)\.catch/);
});

test("active restoration retains accessible progress feedback", () => {
  const loadingState = source.match(
    /function WorkOSRestorationLoading[\s\S]*?(?=\nfunction WorkOSRetryState)/,
  )?.[0];
  assert.ok(loadingState, "expected a dedicated restoration loading state");
  assert.match(loadingState, /ActivityIndicator/);
  assert.match(loadingState, /accessibilityRole="progressbar"/);
});
