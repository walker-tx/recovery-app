type AuthErrorPurpose = "signup" | "verification" | "recovery" | "reset";

const safeErrors: Record<AuthErrorPurpose, string> = {
  signup: "We couldn't start signup. Try again.",
  verification: "That code is invalid or expired. Start signup again if you need a new code.",
  recovery: "We couldn't start password recovery. Try again.",
  reset: "That reset token is invalid or expired. Request a new token and try again.",
};

export function toSafeAuthError(purpose: AuthErrorPurpose, _error: unknown) {
  return safeErrors[purpose];
}
