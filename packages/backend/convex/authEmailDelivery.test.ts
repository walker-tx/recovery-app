import { afterEach, describe, expect, it, vi } from "vitest";

import { createMailpitAuthEmailDelivery } from "./authEmailDelivery";

const localConfig = {
  cloudUrl: "http://127.0.0.1:3210",
  siteUrl: "http://localhost:3211",
  deliveryUrl: "http://127.0.0.1:8025/api/v1/send",
};
const expiresAt = Date.parse("2026-08-26T12:15:00.000Z");

function successfulFetch() {
  return vi.fn(async () => new Response(null, { status: 200 }));
}

describe("Mailpit auth email delivery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    {
      method: "verification" as const,
      input: { email: "person@example.net", code: "123456", expiresAt },
      subject: "Recovery email verification",
      text: "Enter this verification code to continue signup.\n\nVerification code: 123456\nExpires at: 2026-08-26T12:15:00.000Z",
    },
    {
      method: "reset" as const,
      input: {
        email: "reset@example.net",
        resetToken: "reset-secret",
        expiresAt,
      },
      subject: "Recovery password reset",
      text: "Enter this reset token to choose a new password.\n\nReset token: reset-secret\nExpires at: 2026-08-26T12:15:00.000Z",
    },
    {
      method: "guidance" as const,
      input: {
        email: "existing@example.net",
        category: "appleSignIn" as const,
        expiresAt,
      },
      subject: "Recovery account guidance",
      text: "Sign in with Apple to continue.\n\nExpires at: 2026-08-26T12:15:00.000Z",
    },
  ])(
    "posts $method mail to Mailpit",
    async ({ method, input, subject, text }) => {
      const fetch = successfulFetch();
      const delivery = createMailpitAuthEmailDelivery({
        ...localConfig,
        fetch,
      });

      await delivery[method](input as never);

      expect(fetch).toHaveBeenCalledWith(localConfig.deliveryUrl, {
        method: "POST",
        redirect: "error",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          From: { Email: "no-reply@recovery.local", Name: "Recovery" },
          To: [{ Email: input.email }],
          Subject: subject,
          Text: text,
        }),
      });
    },
  );

  it("refuses redirects so credential bodies stay on loopback", async () => {
    const fetch = successfulFetch();
    const delivery = createMailpitAuthEmailDelivery({ ...localConfig, fetch });

    await delivery.verification({
      email: "person@example.net",
      code: "credential-value",
      expiresAt,
    });

    expect(fetch).toHaveBeenCalledWith(
      localConfig.deliveryUrl,
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it.each([
    [undefined, localConfig.siteUrl],
    [localConfig.cloudUrl, undefined],
    ["https://example.convex.cloud", localConfig.siteUrl],
    [localConfig.cloudUrl, "https://example.convex.site"],
    ["not a url", localConfig.siteUrl],
  ])(
    "fails closed outside a local Convex runtime: %s / %s",
    (cloudUrl, siteUrl) => {
      expect(() =>
        createMailpitAuthEmailDelivery({
          ...localConfig,
          cloudUrl,
          siteUrl,
          fetch: successfulFetch(),
        }),
      ).toThrow("Mailpit auth delivery requires local Convex runtime URLs");
    },
  );

  it("fails closed for a non-loopback Mailpit URL", () => {
    expect(() =>
      createMailpitAuthEmailDelivery({
        ...localConfig,
        deliveryUrl: "https://mail.example.com/api/v1/send",
        fetch: successfulFetch(),
      }),
    ).toThrow("Mailpit auth delivery requires a local delivery URL");
  });

  it("rejects non-successful Mailpit responses", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 503 }));
    const delivery = createMailpitAuthEmailDelivery({ ...localConfig, fetch });

    await expect(
      delivery.verification({
        email: "person@example.net",
        code: "credential-value",
        expiresAt,
      }),
    ).rejects.toThrow("Mailpit auth delivery failed with status 503");
  });

  it("propagates Mailpit network rejection", async () => {
    const delivery = createMailpitAuthEmailDelivery({
      ...localConfig,
      fetch: vi.fn(async () => {
        throw new Error("network unavailable");
      }),
    });

    await expect(
      delivery.reset({
        email: "person@example.net",
        resetToken: "credential-value",
        expiresAt,
      }),
    ).rejects.toThrow("network unavailable");
  });

  it("never writes credentials to console", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const delivery = createMailpitAuthEmailDelivery({
      ...localConfig,
      fetch: successfulFetch(),
    });

    await delivery.verification({
      email: "person@example.net",
      code: "credential-value",
      expiresAt,
    });

    expect(
      JSON.stringify([...info.mock.calls, ...log.mock.calls]),
    ).not.toContain("credential-value");
    expect(info).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });
});
