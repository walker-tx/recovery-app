import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("./workos-session-provider.tsx", import.meta.url);

test("provider invokes generated public actions through its supplied client", async () => {
  const source = await readFile(sourceUrl, "utf8");
  for (const action of ["signIn", "completeSignup", "refreshSession", "signOutSession"]) {
    assert.match(source, new RegExp(`client\\.action\\(api\\.workosAuth\\.${action}`));
  }
  assert.doesNotMatch(source, /useAction|useConvex\(/);
});

test("provider publishes the Convex auth hook contract with memoized identities", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.match(source, /fetchAccessToken/);
  assert.match(source, /forceRefreshToken/);
  assert.match(source, /useCallback/);
  assert.match(source, /useMemo/);
  assert.match(source, /isLoading/);
  assert.match(source, /isAuthenticated/);
});
