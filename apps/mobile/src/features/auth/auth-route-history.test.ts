import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { StackRouter } from "expo-router/build/react-navigation/routers/index.js";

const protectedRoutesUrl = new URL(
  "./workos-root-provider.tsx",
  import.meta.url,
);

test("sign-out removes protected app routes from stack history", async () => {
  const protectedRoutes = await readFile(protectedRoutesUrl, "utf8");

  assert.match(
    protectedRoutes,
    /<Stack\.Protected guard=\{destination === "auth"\}>[\s\S]*?<Stack\.Screen name="\(auth\)" \/>[\s\S]*?<\/Stack\.Protected>/,
  );
  assert.match(
    protectedRoutes,
    /<Stack\.Protected guard=\{destination === "app"\}>[\s\S]*?<Stack\.Screen name="\(app\)" \/>[\s\S]*?<\/Stack\.Protected>/,
  );

  const router = StackRouter({});
  const authenticatedState = router.getInitialState({
    routeGetIdList: {},
    routeNames: ["(app)"],
    routeParamList: {},
  });
  const signedOutState = router.getStateForRouteNamesChange(
    authenticatedState,
    {
      routeGetIdList: {},
      routeKeyChanges: [],
      routeNames: ["(auth)"],
      routeParamList: {},
    },
  );

  assert.deepEqual(
    signedOutState.routes.map((route) => route.name),
    ["(auth)"],
  );
  assert.equal(
    signedOutState.routes.some((route) => route.name === "(app)"),
    false,
  );
});
