import type { WorkOSGatewayOperation } from "./workosGateway.ts";

export type WorkOSErrorCategory =
  | "invalidCredentials"
  | "verificationRequired"
  | "invalidVerification"
  | "invalidReset"
  | "invalidSession"
  | "rateLimited"
  | "providerUnavailable";

type ProviderErrorShape = {
  code?: unknown;
  name?: unknown;
  status?: unknown;
};

export function categorizeWorkOSError(
  operation: WorkOSGatewayOperation,
  error: unknown,
): WorkOSErrorCategory {
  const providerError = asProviderError(error);

  if (providerError?.status === 429 || providerError?.name === "RateLimitExceededException") {
    return "rateLimited";
  }

  if (operation === "authenticatePassword") {
    return providerError?.code === "email_verification_required"
      ? "verificationRequired"
      : "invalidCredentials";
  }

  if (operation === "getEmailVerification" || operation === "completeEmailVerification") {
    return "invalidVerification";
  }

  if (operation === "createPasswordReset" || operation === "completePasswordReset") {
    return "invalidReset";
  }

  if (operation === "refreshSession" || operation === "revokeSession") {
    return "invalidSession";
  }

  return "providerUnavailable";
}

export class WorkOSGatewayError extends Error {
  readonly name = "WorkOSGatewayError";

  constructor(readonly category: WorkOSErrorCategory) {
    super(category);
  }
}

function asProviderError(error: unknown): ProviderErrorShape | undefined {
  return typeof error === "object" && error !== null ? error : undefined;
}
