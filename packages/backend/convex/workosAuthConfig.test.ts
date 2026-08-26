import { describe, expect, it } from "vitest";

import { buildWorkOSAuthConfig } from "./workosAuthConfig";

describe("buildWorkOSAuthConfig", () => {
  it("preserves Convex Auth when no migration mode is selected", () => {
    expect(
      buildWorkOSAuthConfig({ convexSiteUrl: "https://local.example" }),
    ).toEqual({
      providers: [
        { domain: "https://local.example", applicationID: "convex" },
      ],
    });
  });

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

  it.each(["fake", "emulator", "production", "unknown"])(
    "fails closed for unsupported mode %s",
    (mode) => {
      expect(() =>
        buildWorkOSAuthConfig({
          mode,
          convexSiteUrl: "https://local.example",
          workosClientId: "client_01ABC123",
        }),
      ).toThrow("Unsupported WORKOS_MODE");
    },
  );

  it.each([undefined, "", "client", "client_abc/../other"])(
    "rejects missing or non-client-scoped staging client ID %s",
    (workosClientId) => {
      expect(() =>
        buildWorkOSAuthConfig({ mode: "staging", workosClientId }),
      ).toThrow("WORKOS_CLIENT_ID");
    },
  );

  it.each([undefined, ""])(
    "rejects a missing Convex Auth site URL in default mode",
    (convexSiteUrl) => {
      expect(() => buildWorkOSAuthConfig({ convexSiteUrl })).toThrow(
        "CONVEX_SITE_URL",
      );
    },
  );
});
