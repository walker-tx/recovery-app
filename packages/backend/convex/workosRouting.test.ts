import { expect, it, vi } from 'vitest';
// Keep the installed SDK real; replace only transport so no network is contacted.
it('routes real SDK requests to each validated local destination without retaining the prior destination', async () => {
  const urls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    urls.push(url);
    return Response.json({ id: 'user_fixture', email: 'fixture@example.test', email_verified: true });
  });
  const generation = '12345678-1234-4234-8234-123456789abc';
  const clientId = `client_local${generation.replaceAll('-', '')}`;
  const config = {
    WORKOS_MODE: 'local', LOCAL_AUTH_STACK_ID: '87654321-1234-4234-8234-123456789abc',
    LOCAL_AUTH_PROVIDER_GENERATION: generation, WORKOS_CLIENT_ID: clientId,
    WORKOS_ISSUER: `https://local-workos.invalid/instances/${generation}`, WORKOS_AUDIENCE: clientId,
    WORKOS_JWKS_URL: 'http://127.0.0.1:6100/jwks', WORKOS_API_URL: 'http://127.0.0.1:6100',
    CONVEX_CLOUD_URL: 'http://127.0.0.1:6101', CONVEX_SITE_URL: 'http://127.0.0.1:6102',
    CONVEX_DEPLOY_KEY: '', CONVEX_DEPLOYMENT: '',
    LOCAL_WORKOS_API_KEY: 'sk_test_local_' + 'a'.repeat(64), WORKOS_API_KEY: 'sk_test_local_' + 'a'.repeat(64),
  };
  try {
    for (const [name, value] of Object.entries(config)) vi.stubEnv(name, value);
    const { workosGateway } = await import('./workos.ts');
    expect(await workosGateway.getUserById('user_fixture')).toEqual({
      id: 'user_fixture', email: 'fixture@example.test', emailVerified: true,
    });
    vi.stubEnv('WORKOS_API_URL', 'http://127.0.0.1:6200');
    await workosGateway.getUserById('user_fixture');
    expect(urls).toEqual([
      'http://127.0.0.1:6100/user_management/users/user_fixture',
      'http://127.0.0.1:6200/user_management/users/user_fixture',
    ]);
    vi.stubEnv('WORKOS_API_URL', 'https://api.workos.com');
    await expect(workosGateway.getUserById('user_fixture')).rejects.toThrow();
    expect(urls).toHaveLength(2);
  } finally {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }
});
