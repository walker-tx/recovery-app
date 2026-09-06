import { describe, expect, it } from "vitest";

import {
  renderPrivateGuidance,
  renderResetToken,
  renderVerificationCode,
} from "./authEmailTemplates";

describe("auth email templates", () => {
  const expiresAt = Date.parse("2026-08-26T12:15:00.000Z");

  it("renders a verification code only in its typed credential slot", () => {
    const rendered = renderVerificationCode({
      email: "person@example.net",
      code: "123456",
      expiresAt,
    });

    expect(rendered).toEqual({
      purpose: "emailVerification",
      maskedEmail: "p***@example.net",
      credential: { kind: "verificationCode", value: "123456" },
      guidance: "Enter this verification code to continue signup.",
      expiresAt: "2026-08-26T12:15:00.000Z",
    });
    const { credential, ...outsideCredentialSlot } = rendered;
    expect(credential.value).toBe("123456");
    expect(JSON.stringify(outsideCredentialSlot)).not.toContain(
      "person@example.net",
    );
    expect(JSON.stringify(outsideCredentialSlot)).not.toContain("123456");
  });

  it("renders a reset token only in its typed credential slot", () => {
    const rendered = renderResetToken({
      email: "reset@example.net",
      resetToken: "reset-secret",
      expiresAt,
    });

    expect(rendered).toEqual({
      purpose: "passwordReset",
      maskedEmail: "r***@example.net",
      credential: { kind: "resetToken", value: "reset-secret" },
      guidance: "Enter this reset token to choose a new password.",
      expiresAt: "2026-08-26T12:15:00.000Z",
    });
    const { credential, ...outsideCredentialSlot } = rendered;
    expect(credential.value).toBe("reset-secret");
    expect(JSON.stringify(outsideCredentialSlot)).not.toContain(
      "reset@example.net",
    );
    expect(JSON.stringify(outsideCredentialSlot)).not.toContain("reset-secret");
  });

  it.each([
    [
      "passwordSignInOrRecovery",
      "Sign in with your password or recover the account.",
    ],
    ["googleSignIn", "Sign in with Google to continue."],
    ["appleSignIn", "Sign in with Apple to continue."],
  ] as const)("renders fixed private guidance for %s", (category, guidance) => {
    const rendered = renderPrivateGuidance({
      email: "existing@example.net",
      category,
      expiresAt,
    });

    expect(rendered).toEqual({
      purpose: "privateGuidance",
      maskedEmail: "e***@example.net",
      guidance: { category, value: guidance },
      expiresAt: "2026-08-26T12:15:00.000Z",
    });
    expect(JSON.stringify(rendered)).not.toContain("existing@example.net");
  });

  it("ignores arbitrary provider messages rather than interpolating them", () => {
    const providerMessage =
      "raw provider response with password and session-token";
    const rendered = renderPrivateGuidance({
      email: "person@example.net",
      category: "googleSignIn",
      expiresAt,
      providerMessage,
    } as Parameters<typeof renderPrivateGuidance>[0] & {
      providerMessage: string;
    });

    expect(JSON.stringify(rendered)).not.toContain(providerMessage);
    expect(rendered.guidance.value).toBe("Sign in with Google to continue.");
  });
});
