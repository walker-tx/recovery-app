// Pure construction only: the launcher owns synthetic credential generation/storage.
// Never pass process.env implicitly, perform configuration writes, or log inputs.
const uuid = (value) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    value,
  );
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const services = [
  "convexCloud",
  "convexSite",
  "metro",
  "provider",
  "mailpitHttp",
  "mailpitSmtp",
];
const reject = () => {
  throw Error("Local stack configuration rejected");
};
function buildStackConfiguration({
  registry,
  bootstrap,
  credentials,
  existing = {},
  inherited = {},
} = {}) {
  if (
    !object(registry) ||
    !uuid(registry.stackId) ||
    !uuid(registry.providerGeneration) ||
    registry.stackId === registry.providerGeneration ||
    !object(registry.ports)
  )
    reject();
  const ports = services.map((name) => registry.ports[name]);
  if (
    !ports.every(
      (port) => Number.isSafeInteger(port) && port > 0 && port <= 65535,
    ) ||
    new Set(ports).size !== ports.length
  )
    reject();
  const { stackId, providerGeneration } = registry;
  const clientId = `client_local${providerGeneration.replaceAll("-", "")}`;
  const issuer = `https://local-workos.invalid/instances/${providerGeneration}`;
  if (
    !object(bootstrap) ||
    bootstrap.providerGeneration !== providerGeneration ||
    bootstrap.clientId !== clientId ||
    bootstrap.issuer !== issuer ||
    bootstrap.port !== registry.ports.provider
  )
    reject();
  // Credentials are explicitly supplied by the trusted launcher, NOT bootstrap.
  // The reserved format rejects accidental reuse of real-provider test keys;
  // cryptographic generation/persistence remains the launcher's responsibility.
  if (
    !object(credentials) ||
    credentials.stackId !== stackId ||
    credentials.providerGeneration !== providerGeneration ||
    typeof credentials.apiKey !== "string" ||
    !/^sk_test_local_[0-9a-f]{64}$/.test(credentials.apiKey)
  )
    reject();
  const origin = (name) => `http://127.0.0.1:${registry.ports[name]}`;
  const backend = {
    WORKOS_MODE: "local",
    LOCAL_AUTH_STACK_ID: stackId,
    LOCAL_AUTH_PROVIDER_GENERATION: providerGeneration,
    WORKOS_CLIENT_ID: clientId,
    WORKOS_ISSUER: issuer,
    WORKOS_AUDIENCE: clientId,
    WORKOS_API_URL: origin("provider"),
    WORKOS_JWKS_URL: `${origin("provider")}/sso/jwks/${clientId}`,
    WORKOS_API_KEY: credentials.apiKey,
    LOCAL_WORKOS_API_KEY: credentials.apiKey,
    CONVEX_URL: origin("convexCloud"),
    CONVEX_SITE_URL: origin("convexSite"),
    AUTH_EMAIL_DELIVERY_URL: `${origin("mailpitHttp")}/api/v1/send`,
  };
  const provider = { LOCAL_WORKOS_API_KEY: credentials.apiKey };
  const mobile = {
    EXPO_PUBLIC_AUTH_ENVIRONMENT_ID: `${stackId}:${providerGeneration}`,
    EXPO_PUBLIC_CONVEX_URL: origin("convexCloud"),
  };
  const owned = {
    RECOVERY_STACK_ID: stackId,
    RECOVERY_PROVIDER_GENERATION: providerGeneration,
    ...backend,
    ...provider,
    ...mobile,
  };
  for (const source of [existing, inherited]) {
    if (!object(source)) reject();
    // No deployment selector/admin credential may leak in from an ambient shell.
    for (const key of [
      "CONVEX_DEPLOY_KEY",
      "CONVEX_DEPLOYMENT",
      "CONVEX_SELF_HOSTED_ADMIN_KEY",
      "WORKOS_ADMIN_API_KEY",
    ]) {
      if (key in source) reject();
    }
    const hasOwnership =
      source.RECOVERY_STACK_ID === stackId &&
      source.RECOVERY_PROVIDER_GENERATION === providerGeneration;
    for (const key of Object.keys(owned)) {
      if (key in source && source[key] !== owned[key]) reject();
    }
    if (
      ("WORKOS_API_KEY" in source || "LOCAL_WORKOS_API_KEY" in source) &&
      !hasOwnership
    )
      reject();
  }
  // Merge only the explicit existing config, never the inherited environment.
  return {
    backend,
    provider,
    mobile,
    owned,
    environment: { ...existing, ...owned },
  };
}
module.exports = { buildStackConfiguration };
