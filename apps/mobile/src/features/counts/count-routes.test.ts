import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { TabRouter } from 'expo-router/build/react-navigation/routers/index.js';

const readRoute = (path: string) => readFile(new URL(`../../app/(app)/${path}`, import.meta.url), 'utf8');
test('authenticated tabs land on Counts and all four destinations are navigable', async () => {
  const source = await readRoute('(tabs)/_layout.tsx');
  const names = [...source.matchAll(/Tabs.Screen name="(\w+)"/g)].map((match) => match[1]);
  assert.deepEqual(names, ['home', 'today', 'read', 'you']);
  const initialRouteName = source.match(/initialRouteName="(\w+)"/)![1];
  const router = TabRouter({ initialRouteName });
  const options = { routeNames: names, routeParamList: {}, routeGetIdList: {} };
  let state = router.getInitialState(options);
  assert.equal(state.routes[state.index].name, 'home');
  for (const name of names) {
    const next = router.getStateForAction(state, { type: 'JUMP_TO', payload: { name } }, options);
    assert.ok(next);
    state = router.getRehydratedState(next, options);
    assert.equal(state.routes[state.index].name, name);
  }
  assert.match(await readRoute('(tabs)/home.tsx'), /CountsScreen/);
  assert.match(await readRoute('(tabs)/you.tsx'), /AuthenticatedHomeScreen/);
  assert.match(await readRoute('counts/new.tsx'), /NewCountScreen/);
  assert.match(await readRoute('_layout.tsx'), /presentation: 'fullScreenModal'/);
});
test('structural coverage: Counts app group is nested inside app-only protection', async () => {
  // Source wiring regression only; this does not exercise runtime navigation or deep links.
  const source = await readFile(new URL('../auth/workos-root-provider.tsx', import.meta.url), 'utf8');
  const appOnlyBlock = /<Stack\.Protected guard=\{destination === "app"\}>\s*<Stack\.Screen name="\(app\)" \/>\s*<\/Stack\.Protected>/;
  const assertAppProtected = (value: string) => assert.match(value, appOnlyBlock);

  // Red checks use in-memory mutations only; production auth source stays untouched.
  assert.throws(() => assertAppProtected(source.replace(appOnlyBlock, '<Stack.Screen name="(app)" />')), assert.AssertionError);
  assert.throws(() => assertAppProtected(source.replace('guard={destination === "app"}', 'guard={destination === "auth"}')), assert.AssertionError);
  assertAppProtected(source);
});
