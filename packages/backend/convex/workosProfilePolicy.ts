import { ConvexError } from "convex/values";

const DISPLAY_NAME_MAX_LENGTH = 80;
const FIRST_NAME_MAX_LENGTH = 50;

type WorkOSProfileInput = {
  displayName: string;
  firstName?: string;
};

type PublicWorkOSProfile = {
  displayName: string;
  firstName?: string;
  onboardingComplete: boolean;
};

export function normalizeWorkOSProfileInput(input: WorkOSProfileInput) {
  const displayName = input.displayName.trim();
  const firstName = input.firstName?.trim() || undefined;

  if (
    displayName === "" ||
    displayName.length > DISPLAY_NAME_MAX_LENGTH ||
    (firstName !== undefined && firstName.length > FIRST_NAME_MAX_LENGTH)
  ) {
    throw new ConvexError({ code: "INVALID_PROFILE" });
  }

  return {
    displayName,
    ...(firstName === undefined ? {} : { firstName }),
  };
}

export function buildWorkOSOwnedProfile(
  ownerSubject: string,
  input: WorkOSProfileInput,
) {
  return {
    ownerSubject,
    ...normalizeWorkOSProfileInput(input),
    onboardingComplete: true,
  };
}

export function shapePublicWorkOSProfile(
  profile: PublicWorkOSProfile & Record<string, unknown>,
): PublicWorkOSProfile {
  return {
    displayName: profile.displayName,
    ...(profile.firstName === undefined
      ? {}
      : { firstName: profile.firstName }),
    onboardingComplete: profile.onboardingComplete,
  };
}
