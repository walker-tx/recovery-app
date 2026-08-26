import { describe, expect, it } from "vitest";

import type { WorkOSErrorCategory } from "./workosErrorPolicy.ts";
import type { WorkOSUserClassification } from "./workosGateway.ts";
import {
  normalizeAuthEmail,
  recoveryInitiationResult,
  signupInitiationResult,
} from "./workosAuthPolicy.ts";

const user = {
  id: "provider-user-id",
  email: "Person@Example.com",
  emailVerified: true,
};

const outcomes: WorkOSUserClassification[] = [
  { kind: "new" },
  { kind: "password", user },
  { kind: "unverifiedPassword", user: { ...user, emailVerified: false } },
  { kind: "googleOnly", user },
  { kind: "appleOnly", user },
  { kind: "unknownRecovery", user },
];

const safeErrorCategories: WorkOSErrorCategory[] = [
  "invalidCredentials",
  "verificationRequired",
  "invalidVerification",
  "invalidReset",
  "invalidSession",
  "rateLimited",
  "providerUnavailable",
];
const initiationOutcomes = [...outcomes, ...safeErrorCategories];

const intentId = "2c1bcf84-fb0f-4a56-8cf0-da563df91d9d";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const forbiddenPublicKeys = [
  "error",
  "user",
  "userId",
  "delivered",
  "deliveryState",
  "code",
  "token",
  "pendingAuthenticationToken",
  "guidance",
  "guidanceCategory",
];

describe("neutral WorkOS initiation policy", () => {
  it.each(initiationOutcomes)("returns one opaque signup shape for every outcome", (outcome) => {
    const result = signupInitiationResult(outcome, intentId);

    expect(result).toEqual({ accepted: true, intentId });
    expect(Object.keys(result).sort()).toEqual(["accepted", "intentId"]);
    expect(result.intentId).toMatch(uuidPattern);
    for (const key of forbiddenPublicKeys) expect(result).not.toHaveProperty(key);
  });

  it.each(initiationOutcomes)("returns one neutral recovery shape for every outcome", (outcome) => {
    const result = recoveryInitiationResult(outcome);

    expect(result).toEqual({ accepted: true });
    expect(Object.keys(result)).toEqual(["accepted"]);
    for (const key of forbiddenPublicKeys) expect(result).not.toHaveProperty(key);
  });

  it("rejects non-opaque signup intent IDs", () => {
    expect(() => signupInitiationResult({ kind: "new" }, "provider-user-id")).toThrow(
      "Invalid signup intent",
    );
  });

  it.each(["signup", "signIn", "recovery"] as const)(
    "uses the shared email normalization for %s",
    () => {
      expect(normalizeAuthEmail("  Person+Tag@Example.COM  ")).toBe(
        "person+tag@example.com",
      );
    },
  );
});
