import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { ConvexHttpClient } from "convex/browser";
import { getFunctionName } from "convex/server";
import { createWorkOSSessionActions } from "./workos-session-actions.ts";

const sourceUrl = new URL("./workos-session-provider.tsx", import.meta.url);

test("injected client action bindings call each generated public action with exact arguments", async () => {
  const calls: Array<{ name: string; args: unknown }> = [];
  const client = {
    async action(reference: unknown, args: unknown) {
      const name = getFunctionName(reference as never);
      calls.push({ name, args });
      if (name === "workosAuth:refreshSession") return { status: "invalid" };
      if (name === "workosAuth:signOutSession") return { revoked: true };
      return { accessToken: "access", refreshToken: "refresh" };
    },
  };
  const actions = createWorkOSSessionActions(client as unknown as ConvexHttpClient);

  await actions.signIn({ email: "person@example.com", password: "password" });
  await actions.completeSignup({ intentId: "intent", code: "123456" });
  await actions.refreshSession({ refreshToken: "refresh" });
  await actions.signOutSession({ refreshToken: "refresh" });

  assert.deepEqual(calls, [
    { name: "workosAuth:signIn", args: { email: "person@example.com", password: "password" } },
    { name: "workosAuth:completeSignup", args: { intentId: "intent", code: "123456" } },
    { name: "workosAuth:refreshSession", args: { refreshToken: "refresh" } },
    { name: "workosAuth:signOutSession", args: { refreshToken: "refresh" } },
  ]);
});

test("provider retains only small static guards for prohibited hooks and memoization", async () => {
  const source = await readFile(sourceUrl, "utf8");
  assert.doesNotMatch(source, /useAction|useConvex\(/);
  assert.match(source, /useCallback/);
  assert.match(source, /useMemo/);
  assert.match(source, /fetchAccessToken/);
});
