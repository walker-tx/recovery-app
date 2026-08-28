import type { AuthConfig } from "convex/server";

type WorkOSAuthConfigEnvironment = {
  mode?: string;
  workosClientId?: string;
};

const WORKOS_CLIENT_ID_PATTERN = /^client_[A-Za-z0-9]+$/;

export function buildWorkOSAuthConfig({
  mode,
  workosClientId,
}: WorkOSAuthConfigEnvironment): AuthConfig {
  if (mode !== "staging") {
    throw new Error("WORKOS_MODE must be staging");
  }

  if (
    workosClientId === undefined ||
    !WORKOS_CLIENT_ID_PATTERN.test(workosClientId)
  ) {
    throw new Error("A valid WORKOS_CLIENT_ID is required in staging mode");
  }

  return {
    providers: [
      {
        type: "customJwt",
        issuer: `https://api.workos.com/user_management/${workosClientId}`,
        jwks: `https://api.workos.com/sso/jwks/${workosClientId}`,
        algorithm: "RS256",
      },
    ],
  };
}
