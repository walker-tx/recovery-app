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

const confirmedRejectionNames = new Set([
  "AuthenticationException",
  "BadRequestException",
  "ConflictException",
  "NotFoundException",
  "OauthException",
  "UnauthorizedException",
  "UnprocessableEntityException",
]);

const retryableErrorCodes = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

export function categorizeWorkOSError(
  operation: WorkOSGatewayOperation,
  error: unknown,
): WorkOSErrorCategory {
  const providerError = asProviderError(error);

  if (providerError?.status === 429 || providerError?.name === "RateLimitExceededException") {
    return "rateLimited";
  }

  if (isRetryableProviderFailure(error, providerError)) return "providerUnavailable";
  if (!isConfirmedProviderRejection(providerError)) return "providerUnavailable";

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

function isRetryableProviderFailure(
  error: unknown,
  providerError: ProviderErrorShape | undefined,
): boolean {
  if (error instanceof TypeError || providerError?.name === "AbortError") return true;
  if (providerError?.status === 408) return true;
  if (typeof providerError?.status === "number" && providerError.status >= 500) return true;
  return typeof providerError?.code === "string" && retryableErrorCodes.has(providerError.code);
}

function isConfirmedProviderRejection(providerError: ProviderErrorShape | undefined): boolean {
  if (
    typeof providerError?.status === "number" &&
    providerError.status >= 400 &&
    providerError.status < 500
  ) {
    return true;
  }
  return (
    typeof providerError?.name === "string" && confirmedRejectionNames.has(providerError.name)
  );
}
