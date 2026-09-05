import assert from 'node:assert/strict';
import test from 'node:test';
import { workOSSessionReducer } from './workos-session-state.ts';
import { getWorkOSRouteDestination } from '../workos-auth-policy.ts';
const initial = { lifetime: 0, isLoading: true, isAuthenticated: false, isRefreshing: false, isSigningOut: false, retry: null };
test('lifetime changes on establishment, replacement, and invalidation, not token refresh/retry', () => {
  const established = workOSSessionReducer(initial, { type: 'sessionEstablished' });
  assert.equal(established.lifetime, 1);
  const failed = workOSSessionReducer(established, { type: 'refreshFailed' });
  const refreshed = workOSSessionReducer(failed, { type: 'refreshCompleted' });
  assert.equal(refreshed.lifetime, 1);
  assert.equal(workOSSessionReducer(refreshed, { type: 'sessionEstablished' }).lifetime, 2);
  assert.equal(workOSSessionReducer(refreshed, { type: 'sessionInvalidated' }).lifetime, 2);
});
test('only confirmed readiness in this lifetime retains the app during refresh and profile retry', () => {
  const session = { ...initial, lifetime: 2, isLoading: false, isAuthenticated: true, retry: { operation: 'refresh' as const } };
  assert.equal(getWorkOSRouteDestination(session, undefined, 2), 'app');
  assert.equal(getWorkOSRouteDestination(session, undefined, 1), 'retry');
  assert.equal(getWorkOSRouteDestination({ ...session, isAuthenticated: false, retry: null }, undefined, 2), 'auth');
  assert.equal(getWorkOSRouteDestination(initial, { onboardingComplete: true }, 0), 'loading');
});
