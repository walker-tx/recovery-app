import {
  type PrivateGuidanceTemplateInput,
  type ResetTokenTemplateInput,
  type VerificationCodeTemplateInput,
  renderPrivateGuidance,
  renderResetToken,
  renderVerificationCode,
} from "./authEmailTemplates";

type ConvexRuntimeUrls = { cloudUrl?: string; siteUrl?: string };

export function assertLocalConsoleDeliveryRuntime({ cloudUrl, siteUrl }: ConvexRuntimeUrls): void {
  if (!isLoopbackUrl(cloudUrl) || !isLoopbackUrl(siteUrl)) {
    throw new Error("Console auth delivery requires local Convex runtime URLs");
  }
}

function isLoopbackUrl(value: string | undefined): boolean {
  if (value === undefined) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return (url.protocol === "http:" || url.protocol === "https:")
      && (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1");
  } catch {
    return false;
  }
}

function assertLocalRuntime(): void {
  assertLocalConsoleDeliveryRuntime({
    cloudUrl: process.env.CONVEX_CLOUD_URL,
    siteUrl: process.env.CONVEX_SITE_URL,
  });
}

export const deliverVerificationCode = (input: VerificationCodeTemplateInput): void => {
  assertLocalRuntime();
  console.info("Auth credential delivery", renderVerificationCode(input));
};

export const deliverResetToken = (input: ResetTokenTemplateInput): void => {
  assertLocalRuntime();
  console.info("Auth credential delivery", renderResetToken(input));
};

export const deliverPrivateGuidance = (input: PrivateGuidanceTemplateInput): void => {
  assertLocalRuntime();
  console.info("Auth private guidance delivery", renderPrivateGuidance(input));
};
