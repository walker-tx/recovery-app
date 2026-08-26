import { describe, expect, it } from "vitest";

import {
  buildWorkOSOwnedProfile,
  normalizeWorkOSProfileInput,
  shapePublicWorkOSProfile,
} from "./workosProfilePolicy";

describe("WorkOS profile policy", () => {
  it("derives ownership from the validated WorkOS subject", () => {
    expect(
      buildWorkOSOwnedProfile("user_123", {
        displayName: "  Taylor Reed  ",
        firstName: " Taylor ",
      }),
    ).toEqual({
      ownerSubject: "user_123",
      displayName: "Taylor Reed",
      firstName: "Taylor",
      onboardingComplete: true,
    });
  });

  it("normalizes names and omits an empty optional first name", () => {
    expect(
      normalizeWorkOSProfileInput({ displayName: " Taylor ", firstName: "  " }),
    ).toEqual({ displayName: "Taylor" });
  });

  it.each([
    { displayName: "   " },
    { displayName: "x".repeat(81) },
    { displayName: "Taylor", firstName: "x".repeat(51) },
  ])("rejects invalid normalized input %#", (input) => {
    expect(() => normalizeWorkOSProfileInput(input)).toThrowError(
      expect.objectContaining({ data: { code: "INVALID_PROFILE" } }),
    );
  });

  it("returns only the public profile shape", () => {
    expect(
      shapePublicWorkOSProfile({
        _id: "profile_123",
        _creationTime: 123,
        ownerSubject: "user_123",
        email: "private@example.com",
        displayName: "Taylor Reed",
        firstName: "Taylor",
        onboardingComplete: true,
      }),
    ).toEqual({
      displayName: "Taylor Reed",
      firstName: "Taylor",
      onboardingComplete: true,
    });
  });
});
