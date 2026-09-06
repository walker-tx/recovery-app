import {
  type PrivateGuidanceTemplateInput,
  type ResetTokenTemplateInput,
  type VerificationCodeTemplateInput,
  renderPrivateGuidance,
  renderResetToken,
  renderVerificationCode,
} from "./authEmailTemplates";

type MailpitFetch = (
  url: string,
  init: RequestInit,
) => Promise<Pick<Response, "ok" | "status">>;

type MailpitDeliveryConfig = {
  cloudUrl?: string;
  siteUrl?: string;
  deliveryUrl?: string;
  fetch: MailpitFetch;
};

function assertLocalDeliveryRuntime(
  config: MailpitDeliveryConfig,
): asserts config is MailpitDeliveryConfig & { deliveryUrl: string } {
  if (!isLoopbackUrl(config.cloudUrl) || !isLoopbackUrl(config.siteUrl)) {
    throw new Error("Mailpit auth delivery requires local Convex runtime URLs");
  }
  if (!isLoopbackUrl(config.deliveryUrl)) {
    throw new Error("Mailpit auth delivery requires a local delivery URL");
  }
}

function isLoopbackUrl(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        hostname === "::1")
    );
  } catch {
    return false;
  }
}

export function createMailpitAuthEmailDelivery(config: MailpitDeliveryConfig) {
  assertLocalDeliveryRuntime(config);

  const send = async (
    email: string,
    subject: string,
    text: string,
  ): Promise<void> => {
    const response = await config.fetch(config.deliveryUrl, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        From: { Email: "no-reply@recovery.local", Name: "Recovery" },
        To: [{ Email: email }],
        Subject: subject,
        Text: text,
      }),
    });
    if (!response.ok) {
      throw new Error(
        `Mailpit auth delivery failed with status ${response.status}`,
      );
    }
  };

  return {
    verification: async (
      input: VerificationCodeTemplateInput,
    ): Promise<void> => {
      const message = renderVerificationCode(input);
      await send(
        input.email,
        "Recovery email verification",
        `${message.guidance}\n\nVerification code: ${message.credential.value}\nExpires at: ${message.expiresAt}`,
      );
    },
    reset: async (input: ResetTokenTemplateInput): Promise<void> => {
      const message = renderResetToken(input);
      await send(
        input.email,
        "Recovery password reset",
        `${message.guidance}\n\nReset token: ${message.credential.value}\nExpires at: ${message.expiresAt}`,
      );
    },
    guidance: async (input: PrivateGuidanceTemplateInput): Promise<void> => {
      const message = renderPrivateGuidance(input);
      await send(
        input.email,
        "Recovery account guidance",
        `${message.guidance.value}\n\nExpires at: ${message.expiresAt}`,
      );
    },
  };
}

function productionDelivery() {
  return createMailpitAuthEmailDelivery({
    cloudUrl: process.env.CONVEX_CLOUD_URL,
    siteUrl: process.env.CONVEX_SITE_URL,
    deliveryUrl: process.env.AUTH_EMAIL_DELIVERY_URL,
    fetch,
  });
}

export const deliverVerificationCode = (
  input: VerificationCodeTemplateInput,
): Promise<void> => productionDelivery().verification(input);

export const deliverResetToken = (
  input: ResetTokenTemplateInput,
): Promise<void> => productionDelivery().reset(input);

export const deliverPrivateGuidance = (
  input: PrivateGuidanceTemplateInput,
): Promise<void> => productionDelivery().guidance(input);
