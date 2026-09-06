import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { getWorkOSAuthConfig, getWorkOSSessionScope } from './workos-auth-config.ts';

const id = '11111111-1111-4111-8111-111111111111:22222222-2222-4222-8222-222222222222';
test('requires explicit stable identity and backend as one public config pair', () => {
  for (const missing of [undefined, '', '   ', 'staging', 'http://localhost:3210']) {
    assert.equal(getWorkOSAuthConfig(missing, 'http://localhost:3210'), null);
  }
  for (const missing of [undefined, '', '   ', 'invalid', 'ftp://localhost']) {
    assert.equal(getWorkOSAuthConfig(id, missing), null);
  }
  assert.deepEqual(getWorkOSAuthConfig(id, 'http://localhost:3210'), {
    environmentId: id, backendUrl: 'http://localhost:3210',
  });
});
test('scope includes supplied identity and destination without guessing identity', () => {
  const config = getWorkOSAuthConfig(id, 'http://localhost:3210')!;
  assert.equal(getWorkOSSessionScope({...config}), getWorkOSSessionScope(config));
  assert.notEqual(getWorkOSSessionScope({...config, environmentId: id.replace('2222', '3333')}), getWorkOSSessionScope(config));
  assert.notEqual(getWorkOSSessionScope({...config, backendUrl: 'http://localhost:3211'}), getWorkOSSessionScope(config));
});
test('real provider persists only identity and replaces the session subtree on pair change', () => {
  const root = readFileSync(new URL('../workos-root-provider.tsx', import.meta.url), 'utf8');
  const provider = readFileSync(new URL('./workos-session-provider.tsx', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('../../../app/_layout.tsx', import.meta.url), 'utf8');
  assert.ok(root.includes('key={getWorkOSSessionScope(config)}'));
  assert.ok(root.includes('config={config}'));
  assert.ok(provider.includes('createWorkOSSessionStorage(SecureStore, config.environmentId)'));
  assert.ok(provider.includes('[config.environmentId]'));
  assert.ok(provider.includes('[client, storage, scope]'));
  assert.ok(layout.includes('process.env.EXPO_PUBLIC_AUTH_ENVIRONMENT_ID'));
  assert.ok(layout.includes('if (config === null)'));
});
