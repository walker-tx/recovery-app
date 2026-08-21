export const DISPLAY_NAME_MAX_LENGTH = 80;
export const FIRST_NAME_MAX_LENGTH = 50;

type ProfileSummary = { onboardingComplete: boolean } | null | undefined;

type ProfileValidation = {
  displayName?: string;
  firstName?: string;
};

export function getAuthenticatedDestination(
  profile: ProfileSummary,
): "onboarding" | "app" | null {
  if (profile === undefined) return null;
  return profile?.onboardingComplete === true ? "app" : "onboarding";
}

export function getProfileValidation(
  displayName: string,
  firstName: string,
): ProfileValidation {
  const errors: ProfileValidation = {};
  const normalizedDisplayName = displayName.trim();
  const normalizedFirstName = firstName.trim();

  if (normalizedDisplayName === "") {
    errors.displayName = "Enter a display name.";
  } else if (normalizedDisplayName.length > DISPLAY_NAME_MAX_LENGTH) {
    errors.displayName = `Use ${DISPLAY_NAME_MAX_LENGTH} characters or fewer.`;
  }
  if (normalizedFirstName.length > FIRST_NAME_MAX_LENGTH) {
    errors.firstName = `Use ${FIRST_NAME_MAX_LENGTH} characters or fewer.`;
  }

  return errors;
}

export function normalizeProfileInput(displayName: string, firstName: string) {
  const normalizedFirstName = firstName.trim();
  return {
    displayName: displayName.trim(),
    firstName: normalizedFirstName === "" ? undefined : normalizedFirstName,
  };
}
