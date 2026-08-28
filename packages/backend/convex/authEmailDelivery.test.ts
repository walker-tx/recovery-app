import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertLocalConsoleDeliveryRuntime,
  deliverPrivateGuidance,
  deliverResetToken,
  deliverVerificationCode,
} from "./authEmailDelivery";

function useLocalRuntime() {
  vi.stubEnv("CONVEX_CLOUD_URL", "http://127.0.0.1:3210");
  vi.stubEnv("CONVEX_SITE_URL", "http://localhost:3211");
}

describe("console auth email delivery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each([
    [undefined, undefined],
    ["http://127.0.0.1:3210", undefined],
    [undefined, "http://localhost:3211"],
    ["https://example.convex.cloud", "https://example.convex.site"],
    ["http://127.0.0.1:3210", "https://example.convex.site"],
    ["not a url", "http://localhost:3211"],
  ])("fails closed outside an actual local Convex runtime: %s / %s", (cloudUrl, siteUrl) => {
    expect(() => assertLocalConsoleDeliveryRuntime({ cloudUrl, siteUrl })).toThrow(
      "Console auth delivery requires local Convex runtime URLs",
    );
  });

  it.each([
    ["http://localhost:3210", "http://127.0.0.1:3211"],
    ["http://127.0.0.1:3210", "http://[::1]:3211"],
  ])("allows loopback Convex runtime URLs: %s / %s", (cloudUrl, siteUrl) => {
    expect(() => assertLocalConsoleDeliveryRuntime({ cloudUrl, siteUrl })).not.toThrow();
  });

  it("logs only the typed verification delivery fields", () => {
    useLocalRuntime();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    deliverVerificationCode({
      email: "person@example.net",
      code: "123456",
      expiresAt: Date.parse("2026-08-26T12:15:00.000Z"),
    });

    expect(info).toHaveBeenCalledWith("Auth credential delivery", {
      purpose: "emailVerification",
      maskedEmail: "p***@example.net",
      credential: { kind: "verificationCode", value: "123456" },
      guidance: "Enter this verification code to continue signup.",
      expiresAt: "2026-08-26T12:15:00.000Z",
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain("person@example.net");
  });

  it("logs only the typed reset delivery fields", () => {
    useLocalRuntime();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    deliverResetToken({
      email: "reset@example.net",
      resetToken: "reset-secret",
      expiresAt: Date.parse("2026-08-26T12:15:00.000Z"),
    });

    expect(info).toHaveBeenCalledWith("Auth credential delivery", {
      purpose: "passwordReset",
      maskedEmail: "r***@example.net",
      credential: { kind: "resetToken", value: "reset-secret" },
      guidance: "Enter this reset token to choose a new password.",
      expiresAt: "2026-08-26T12:15:00.000Z",
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain("reset@example.net");
  });

  it("logs fixed private guidance without a credential", () => {
    useLocalRuntime();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);

    deliverPrivateGuidance({
      email: "existing@example.net",
      category: "appleSignIn",
      expiresAt: Date.parse("2026-08-26T12:15:00.000Z"),
    });

    expect(info).toHaveBeenCalledWith("Auth private guidance delivery", {
      purpose: "privateGuidance",
      maskedEmail: "e***@example.net",
      guidance: {
        category: "appleSignIn",
        value: "Sign in with Apple to continue.",
      },
      expiresAt: "2026-08-26T12:15:00.000Z",
    });
    const logged = JSON.stringify(info.mock.calls);
    expect(logged).not.toContain("existing@example.net");
    expect(logged).not.toContain("password");
    expect(logged).not.toContain("token");
  });
});
