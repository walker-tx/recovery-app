import { describe, expect, it } from "vitest";

import { categorizeWorkOSError } from "./workosErrorPolicy.ts";

describe("categorizeWorkOSError", () => {
  it.each([
    { name: "AuthenticationException", code: "invalid_grant" },
    { name: "NotFoundException", status: 404 },
  ])("maps unknown-account and wrong-password sign-in failures identically", (error) => {
    expect(categorizeWorkOSError("authenticatePassword", error)).toBe(
      "invalidCredentials",
    );
  });

  it("recognizes verification-required authentication without leaking provider text", () => {
    const rawMessage = "provider detail that must not escape";
    const category = categorizeWorkOSError("authenticatePassword", {
      name: "AuthenticationException",
      code: "email_verification_required",
      message: rawMessage,
    });
    expect(category).toBe("verificationRequired");
    expect(category).not.toContain(rawMessage);
  });

  it.each([
    ["getEmailVerification", "invalidVerification"],
    ["completeEmailVerification", "invalidVerification"],
    ["createPasswordReset", "invalidReset"],
    ["completePasswordReset", "invalidReset"],
    ["refreshSession", "invalidSession"],
    ["revokeSession", "invalidSession"],
  ] as const)("maps rejected %s operations to %s", (operation, expected) => {
    expect(
      categorizeWorkOSError(operation, { name: "UnprocessableEntityException", status: 422 }),
    ).toBe(expected);
  });

  it("maps rate limits independently of the operation", () => {
    expect(
      categorizeWorkOSError("createPasswordUser", {
        name: "RateLimitExceededException",
        status: 429,
        retryAfter: 30,
      }),
    ).toBe("rateLimited");
  });

  it.each([
    ["authenticatePassword", new TypeError("network failed with private hostname")],
    [
      "authenticatePassword",
      { name: "GenericServerException", status: 503, message: "provider internals" },
    ],
    ["refreshSession", new TypeError("socket disconnected")],
    ["revokeSession", { name: "GenericServerException", status: 502 }],
    ["completeEmailVerification", { name: "RequestTimeoutException", status: 408 }],
    ["completePasswordReset", { code: "ECONNRESET" }],
    ["authenticatePassword", { unexpected: "raw provider value" }],
    ["refreshSession", { unexpected: "raw provider value" }],
    ["getUserById", { unexpected: "raw provider value" }],
  ] as const)(
    "maps retryable or unknown %s failures to providerUnavailable",
    (operation, error) => {
      const category = categorizeWorkOSError(operation, error);
      expect(category).toBe("providerUnavailable");
      expect([
        "invalidCredentials",
        "verificationRequired",
        "invalidVerification",
        "invalidReset",
        "invalidSession",
        "rateLimited",
        "providerUnavailable",
      ]).toContain(category);
    },
  );
});
