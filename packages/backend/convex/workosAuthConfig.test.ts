import { describe, expect, it, vi } from "vitest";

import { buildWorkOSAuthConfig, resolveWorkOSApiKey, workOSEnvironment } from "./workosAuthConfig";

describe("buildWorkOSAuthConfig", () => {
  it.each([undefined, "", "fake", "emulator", "production", "unknown"])(
    "fails closed unless WORKOS_MODE is exactly staging: %s",
    (mode) => {
      expect(() =>
        buildWorkOSAuthConfig({
          mode,
          workosClientId: "client_01ABC123",
        }),
      ).toThrow("WORKOS_MODE must be staging");
    },
  );

  it("builds only the exact client-scoped WorkOS staging trust", () => {
    const config = buildWorkOSAuthConfig({
      mode: "staging",
      workosClientId: "client_01ABC123",
    });

    expect(config).toEqual({
      providers: [
        {
          type: "customJwt",
          issuer:
            "https://api.workos.com/user_management/client_01ABC123",
          jwks: "https://api.workos.com/sso/jwks/client_01ABC123",
          algorithm: "RS256",
        },
      ],
    });
    expect(config.providers[0]).not.toHaveProperty("applicationID");
  });

  it.each([undefined, "", "client", "client_abc/../other"])(
    "rejects missing or non-client-scoped staging client ID %s",
    (workosClientId) => {
      expect(() =>
        buildWorkOSAuthConfig({ mode: "staging", workosClientId }),
      ).toThrow("WORKOS_CLIENT_ID");
    },
  );
});

it('reads the documented Convex runtime cloud URL rather than the CLI variable', () => {
  vi.stubEnv('CONVEX_CLOUD_URL', 'http://127.0.0.1:6300');
  vi.stubEnv('CONVEX_URL', 'https://untrusted-cli.example');
  try {
    expect(workOSEnvironment().convexUrl === 'http://127.0.0.1:6300').toBe(true);
  } finally { vi.unstubAllEnvs(); }
});
const generation = '12345678-1234-4234-8234-123456789abc';
const local = {
  mode: 'local',
  stackId: '87654321-1234-4234-8234-123456789abc',
  providerGeneration: generation,
  workosClientId: `client_local${generation.replaceAll('-', '')}`,
  issuer: `https://local-workos.invalid/instances/${generation}`,
  audience: `client_local${generation.replaceAll('-', '')}`,
  jwks: 'http://127.0.0.1:6100/jwks',
  apiUrl: 'http://127.0.0.1:6100',
  convexUrl: 'http://127.0.0.1:6101',
  convexSiteUrl: 'http://127.0.0.1:6102',
};

describe('paired local trust', () => {
  it('requires explicit audience and canonical generation issuer', () => {
    expect(buildWorkOSAuthConfig(local).providers).toEqual([{
      type: 'customJwt', issuer: local.issuer, jwks: local.jwks,
      applicationID: local.audience, algorithm: 'RS256',
    }]);
  });
  it.each(['stackId', 'providerGeneration', 'issuer', 'audience', 'jwks', 'apiUrl', 'convexUrl', 'convexSiteUrl'] as const)('rejects missing %s', (key) => {
    expect(() => buildWorkOSAuthConfig({ ...local, [key]: undefined })).toThrow();
  });
  it.each([
    { issuer: `${local.issuer}/` }, { audience: 'other' },
    { workosClientId: 'client_other' }, { stackId: 'not-a-uuid' },
    { apiUrl: 'https://api.workos.com' }, { jwks: 'http://example.com/jwks' },
    { convexUrl: 'https://example.convex.cloud' },
    { apiUrl: 'http://127.0.0.1:6100/path' },
    { apiUrl: 'http://secret@127.0.0.1:6100' }, { deployKey: 'inherited' },
  ])('rejects unpaired/remote configuration %j', (override) => {
    expect(() => buildWorkOSAuthConfig({ ...local, ...override })).toThrow();
  });
  it.each(['stackId', 'providerGeneration', 'issuer', 'audience', 'jwks', 'apiUrl'] as const)('staging rejects %s override', (key) => {
    expect(() => buildWorkOSAuthConfig({ mode: 'staging', workosClientId: 'client_01ABC123', [key]: local[key] })).toThrow();
  });
});

const localKey = `sk_test_local_${'a'.repeat(64)}`;
describe('local credential and deployment isolation', () => {
  it('uses explicit local credentials, permitting a matching generic key', () => {
    expect(resolveWorkOSApiKey({ mode: 'local', localApiKey: localKey }) === localKey).toBe(true);
    expect(resolveWorkOSApiKey({ mode: 'local', localApiKey: localKey, apiKey: localKey }) === localKey).toBe(true);
    expect(resolveWorkOSApiKey({ mode: 'staging', apiKey: 'synthetic-staging' }) === 'synthetic-staging').toBe(true);
  });
  it('rejects missing, generic-only, malformed, and conflicting credentials', () => {
    for (const localApiKey of [undefined, '', 'sk_test_synthetic', `sk_test_local_${'a'.repeat(63)}`, `sk_test_local_${'A'.repeat(64)}`, `sk_test_local_${'a'.repeat(65)}`]) {
      let rejected = false;
      try { resolveWorkOSApiKey({ mode: 'local', localApiKey, apiKey: localKey }); } catch { rejected = true; }
      expect(rejected).toBe(true);
    }
    let rejected = false;
    try { resolveWorkOSApiKey({ mode: 'local', localApiKey: localKey, apiKey: 'synthetic-real-test-key' }); } catch { rejected = true; }
    expect(rejected).toBe(true);
  });
  it('rejects remote and malformed selectors', () => {
    for (const deployment of ['dev:synthetic', 'prod:synthetic', 'local:', 'anonymous:', 'local:bad/name', ' local:synthetic']) {
      let rejected = false;
      try { buildWorkOSAuthConfig({ ...local, deployment }); } catch { rejected = true; }
      expect(rejected).toBe(true);
    }
  });
  it('allows absent or valid local selectors', () => {
    for (const deployment of [undefined, '', 'local:synthetic_123-abc', 'anonymous:synthetic-123']) {
      expect(buildWorkOSAuthConfig({ ...local, deployment }).providers.length === 1).toBe(true);
    }
  });
  it('reads explicit deployment and credential environment names', () => {
    vi.stubEnv('CONVEX_DEPLOYMENT', 'prod:synthetic');
    vi.stubEnv('LOCAL_WORKOS_API_KEY', localKey);
    vi.stubEnv('WORKOS_API_KEY', 'synthetic-generic');
    try {
      const env = workOSEnvironment();
      expect(env.deployment === 'prod:synthetic').toBe(true);
      expect(env.localApiKey === localKey).toBe(true);
      expect(env.apiKey === 'synthetic-generic').toBe(true);
    } finally { vi.unstubAllEnvs(); }
  });
});
