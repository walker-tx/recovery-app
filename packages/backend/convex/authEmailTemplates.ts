export type PrivateGuidanceCategory =
  | "passwordSignInOrRecovery"
  | "googleSignIn"
  | "appleSignIn";

type DeliveryTarget = {
  email: string;
  expiresAt: number;
};

export type VerificationCodeTemplateInput = DeliveryTarget & {
  code: string;
};

export type ResetTokenTemplateInput = DeliveryTarget & {
  resetToken: string;
};

export type PrivateGuidanceTemplateInput = DeliveryTarget & {
  category: PrivateGuidanceCategory;
};

export type RenderedCredentialMessage = {
  purpose: "emailVerification" | "passwordReset";
  maskedEmail: string;
  credential:
    | { kind: "verificationCode"; value: string }
    | { kind: "resetToken"; value: string };
  guidance: string;
  expiresAt: string;
};

export type RenderedPrivateGuidance = {
  purpose: "privateGuidance";
  maskedEmail: string;
  guidance: { category: PrivateGuidanceCategory; value: string };
  expiresAt: string;
};

const privateGuidanceByCategory: Record<PrivateGuidanceCategory, string> = {
  passwordSignInOrRecovery: "Sign in with your password or recover the account.",
  googleSignIn: "Sign in with Google to continue.",
  appleSignIn: "Sign in with Apple to continue.",
};

export const maskEmail = (email: string): string => {
  const separator = email.lastIndexOf("@");
  if (separator <= 0 || separator === email.length - 1) return "***";

  return `${email.slice(0, 1)}***@${email.slice(separator + 1)}`;
};

const formatExpiry = (expiresAt: number) => new Date(expiresAt).toISOString();

export const renderVerificationCode = ({
  email,
  code,
  expiresAt,
}: VerificationCodeTemplateInput): RenderedCredentialMessage => ({
  purpose: "emailVerification",
  maskedEmail: maskEmail(email),
  credential: { kind: "verificationCode", value: code },
  guidance: "Enter this verification code to continue signup.",
  expiresAt: formatExpiry(expiresAt),
});

export const renderResetToken = ({
  email,
  resetToken,
  expiresAt,
}: ResetTokenTemplateInput): RenderedCredentialMessage => ({
  purpose: "passwordReset",
  maskedEmail: maskEmail(email),
  credential: { kind: "resetToken", value: resetToken },
  guidance: "Enter this reset token to choose a new password.",
  expiresAt: formatExpiry(expiresAt),
});

export const renderPrivateGuidance = ({
  email,
  category,
  expiresAt,
}: PrivateGuidanceTemplateInput): RenderedPrivateGuidance => ({
  purpose: "privateGuidance",
  maskedEmail: maskEmail(email),
  guidance: { category, value: privateGuidanceByCategory[category] },
  expiresAt: formatExpiry(expiresAt),
});
