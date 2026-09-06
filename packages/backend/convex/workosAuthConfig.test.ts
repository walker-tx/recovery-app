import { describe, expect, it } from "vitest";

import { buildWorkOSAuthConfig } from "./workosAuthConfig";

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
          issuer: "https://api.workos.com/user_management/client_01ABC123",
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
