import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { TabRouter } from 'expo-router/build/react-navigation/routers/index.js';
import { getWorkOSRouteDestination } from '../auth/workos-auth-policy.ts';

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
test('neither Counts nor creation bypasses restoration or onboarding', () => {
  assert.equal(getWorkOSRouteDestination({ isLoading: true, isAuthenticated: true }, { onboardingComplete: true }), 'loading');
  assert.equal(getWorkOSRouteDestination({ isLoading: false, isAuthenticated: false }, null), 'auth');
  assert.equal(getWorkOSRouteDestination({ isLoading: false, isAuthenticated: true }, undefined), 'loading');
  assert.equal(getWorkOSRouteDestination({ isLoading: false, isAuthenticated: true }, null), 'onboarding');
  assert.equal(getWorkOSRouteDestination({ isLoading: false, isAuthenticated: true }, { onboardingComplete: true }), 'app');
});
