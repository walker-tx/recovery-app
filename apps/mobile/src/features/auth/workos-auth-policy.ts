import { getEmailError } from "./email-policy.ts";

type WorkOSSignInValidation = {
  email?: string;
  password?: string;
};

type WorkOSRoutingSession = {
  isLoading: boolean;
  isAuthenticated: boolean;
  retry?: { operation: "restore" | "refresh" | "signOut" } | null;
};

type ProfileSummary = { onboardingComplete: boolean } | null | undefined;

export type WorkOSRouteDestination = "loading" | "auth" | "onboarding" | "app";

export function getWorkOSSignInValidation(
  email: string,
  password: string,
): WorkOSSignInValidation {
  const errors: WorkOSSignInValidation = {};
  const emailError = getEmailError(email);
  if (emailError !== undefined) errors.email = emailError;
  if (password.length === 0) errors.password = "Enter your password.";
  return errors;
}

export function getFirstInvalidWorkOSSignInField(errors: WorkOSSignInValidation) {
  if (errors.email !== undefined) return "email" as const;
  if (errors.password !== undefined) return "password" as const;
  return null;
}

export function toSafeWorkOSSignInError(_error: unknown) {
  return "We couldn't sign you in. Check your email and password, then try again.";
}

export function getWorkOSRouteDestination(
  session: WorkOSRoutingSession,
  profile: ProfileSummary,
): WorkOSRouteDestination {
  if (session.isLoading) return "loading";
  if (!session.isAuthenticated) return "auth";
  if (profile === undefined) return "loading";
  return profile?.onboardingComplete === true ? "app" : "onboarding";
}
