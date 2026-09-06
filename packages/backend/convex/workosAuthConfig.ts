import type { AuthConfig } from "convex/server";

type WorkOSAuthConfigEnvironment = {
  mode?: string;
  workosClientId?: string;
  stackId?: string;
  providerGeneration?: string;
  issuer?: string;
  audience?: string;
  jwks?: string;
  apiUrl?: string;
  convexUrl?: string;
  convexSiteUrl?: string;
  deployKey?: string;
  deployment?: string;
  apiKey?: string;
  localApiKey?: string;
};

export function workOSEnvironment(): WorkOSAuthConfigEnvironment {
  return {
    mode: process.env.WORKOS_MODE,
    workosClientId: process.env.WORKOS_CLIENT_ID,
    stackId: process.env.LOCAL_AUTH_STACK_ID,
    providerGeneration: process.env.LOCAL_AUTH_PROVIDER_GENERATION,
    issuer: process.env.WORKOS_ISSUER,
    audience: process.env.WORKOS_AUDIENCE,
    jwks: process.env.WORKOS_JWKS_URL,
    apiUrl: process.env.WORKOS_API_URL,
    convexUrl: process.env.CONVEX_URL,
    convexSiteUrl: process.env.CONVEX_SITE_URL,
    deployKey: process.env.CONVEX_DEPLOY_KEY,
    deployment: process.env.CONVEX_DEPLOYMENT,
    apiKey: process.env.WORKOS_API_KEY,
    localApiKey: process.env.LOCAL_WORKOS_API_KEY,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function loopback(value: string | undefined, name: string, originOnly = false): URL {
  if (!value || value.trim() !== value) throw new Error(`Invalid local ${name}`);
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) ||
    url.username || url.password || url.search || url.hash ||
    (originOnly && url.pathname !== '/')
  ) throw new Error(`Invalid local ${name}`);
  return url;
}

export function resolveWorkOSExpectations(env: WorkOSAuthConfigEnvironment) {
  const clientId = env.workosClientId;
  if (!clientId || !/^client_[A-Za-z0-9]+$/.test(clientId)) {
    throw new Error('A valid WORKOS_CLIENT_ID is required');
  }
  if (env.mode === 'staging') {
    if ([env.stackId, env.providerGeneration, env.issuer, env.audience, env.jwks, env.apiUrl].some(value => value !== undefined)) {
      throw new Error('Staging rejects local WorkOS overrides');
    }
    return {
      clientId,
      issuer: `https://api.workos.com/user_management/${clientId}`,
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
      audience: undefined,
      sdkOptions: { apiHostname: 'api.workos.com', https: true, port: 443 },
    };
  }
  if (env.mode !== 'local') throw new Error('WORKOS_MODE must be staging or local');
  if (!env.stackId || !UUID.test(env.stackId) || !env.providerGeneration || !UUID.test(env.providerGeneration)) {
    throw new Error('Local auth requires paired stack and provider-generation UUIDs');
  }
  const issuer = `https://local-workos.invalid/instances/${env.providerGeneration}`;
  const expectedClient = `client_local${env.providerGeneration.replaceAll('-', '')}`;
  if (clientId !== expectedClient || env.issuer !== issuer || env.audience !== expectedClient) {
    throw new Error('Local issuer, client and audience must match provider generation');
  }
  if (env.deployment && (env.deployment.trim() !== env.deployment || !/^(local|anonymous):[A-Za-z0-9_-]+$/.test(env.deployment))) {
    throw new Error('Local auth rejects nonlocal CONVEX_DEPLOYMENT');
  }
  if (env.deployKey) throw new Error('Local auth rejects inherited CONVEX_DEPLOY_KEY');
  loopback(env.convexUrl, 'CONVEX_URL', true);
  loopback(env.convexSiteUrl, 'CONVEX_SITE_URL', true);
  loopback(env.jwks, 'WORKOS_JWKS_URL');
  const api = loopback(env.apiUrl, 'WORKOS_API_URL', true);
  return {
    clientId, issuer, audience: expectedClient, jwks: env.jwks!,
    sdkOptions: { apiHostname: api.hostname, https: api.protocol === 'https:', port: Number(api.port || (api.protocol === 'https:' ? 443 : 80)) },
  };
}

export function buildWorkOSAuthConfig(env: WorkOSAuthConfigEnvironment): AuthConfig {
  const trust = resolveWorkOSExpectations(env);
  return {
    providers: [{
      type: 'customJwt', issuer: trust.issuer, jwks: trust.jwks, algorithm: 'RS256',
      ...(trust.audience === undefined ? {} : { applicationID: trust.audience }),
    }],
  };
}

export function resolveWorkOSApiKey(env: WorkOSAuthConfigEnvironment): string {
  if (env.mode === 'local') {
    const key = env.localApiKey;
    if (!key || key.trim() !== key || !/^sk_test_local_[0-9a-f]{64}$/.test(key)) {
      throw new Error('Local auth requires a valid LOCAL_WORKOS_API_KEY');
    }
    if (env.apiKey !== undefined && env.apiKey !== key) {
      throw new Error('Local auth rejects conflicting WORKOS_API_KEY');
    }
    return key;
  }
  if (env.mode !== 'staging') throw new Error('WORKOS_MODE must be staging or local');
  if (!env.apiKey) throw new Error('Missing required server environment variable: WORKOS_API_KEY');
  return env.apiKey;
}
