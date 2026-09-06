import type { WorkOSErrorCategory } from "./workosErrorPolicy.ts";
import type { WorkOSUserClassification } from "./workosGateway.ts";

type WorkOSInitiationOutcome = WorkOSUserClassification | WorkOSErrorCategory;

const opaqueIntentIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function normalizeAuthEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function signupInitiationResult(
  _outcome: WorkOSInitiationOutcome,
  intentId: string,
): { accepted: true; intentId: string } {
  if (!opaqueIntentIdPattern.test(intentId)) {
    throw new Error("Invalid signup intent");
  }
  return { accepted: true, intentId };
}

export function recoveryInitiationResult(_outcome: WorkOSInitiationOutcome): {
  accepted: true;
} {
  return { accepted: true };
}
