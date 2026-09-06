import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  decryptPendingAuthenticationToken,
  encryptPendingAuthenticationToken,
  fingerprintEmail,
} from "./workosIntentCrypto.ts";

const hmacKey = Buffer.alloc(32, 0x11).toString("base64");
const encryptionKey = Buffer.alloc(32, 0x22).toString("base64");
const wrongEncryptionKey = Buffer.alloc(32, 0x33).toString("base64");
const nonce = Buffer.from("000102030405060708090a0b", "hex");

describe("WorkOS intent cryptography", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the named environment keys by default", () => {
    vi.stubEnv("WORKOS_EMAIL_HMAC_KEY", hmacKey);
    vi.stubEnv("WORKOS_INTENT_ENCRYPTION_KEY", encryptionKey);

    expect(fingerprintEmail("person@example.com")).toBe(
      fingerprintEmail("person@example.com", hmacKey),
    );
    expect(
      decryptPendingAuthenticationToken(
        encryptPendingAuthenticationToken("pending-token", undefined, nonce),
      ),
    ).toBe("pending-token");
  });

  it("creates deterministic HMAC-SHA256 fingerprints of normalized emails", () => {
    const expected = createHmac("sha256", Buffer.from(hmacKey, "base64"))
      .update("person@example.com", "utf8")
      .digest("hex");

    expect(fingerprintEmail("person@example.com", hmacKey)).toBe(expected);
  });

  it("encrypts and decrypts pending tokens deterministically with an injected nonce", () => {
    const encrypted = encryptPendingAuthenticationToken(
      "pending-authentication-token",
      encryptionKey,
      nonce,
    );

    expect(encrypted).toEqual({
      ciphertext: "NqX5e9JD7+lZQ2HhITLXExcotT4uz0n3gEkQ3A==",
      nonce: nonce.toString("base64"),
      authenticationTag: "FAQCzUEMcU3dEmuL/TDsYQ==",
    });
    expect(decryptPendingAuthenticationToken(encrypted, encryptionKey)).toBe(
      "pending-authentication-token",
    );
    expect(JSON.stringify(encrypted)).not.toContain(
      "pending-authentication-token",
    );
  });

  it("uses a fresh random nonce by default", () => {
    const first = encryptPendingAuthenticationToken(
      "same-token",
      encryptionKey,
    );
    const second = encryptPendingAuthenticationToken(
      "same-token",
      encryptionKey,
    );

    expect(first.nonce).not.toBe(second.nonce);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("fails authentication for tampered values and the wrong key", () => {
    const encrypted = encryptPendingAuthenticationToken(
      "secret",
      encryptionKey,
      nonce,
    );
    const tamperedTag = {
      ...encrypted,
      authenticationTag: Buffer.alloc(16, 0xff).toString("base64"),
    };
    const ciphertext = Buffer.from(encrypted.ciphertext, "base64");
    ciphertext[0] ^= 0xff;
    const tamperedCiphertext = {
      ...encrypted,
      ciphertext: ciphertext.toString("base64"),
    };

    expect(() =>
      decryptPendingAuthenticationToken(tamperedTag, encryptionKey),
    ).toThrow();
    expect(() =>
      decryptPendingAuthenticationToken(tamperedCiphertext, encryptionKey),
    ).toThrow();
    expect(() =>
      decryptPendingAuthenticationToken(encrypted, wrongEncryptionKey),
    ).toThrow();
  });

  it("fails closed when the named environment keys are missing", () => {
    vi.stubEnv("WORKOS_EMAIL_HMAC_KEY", "");
    vi.stubEnv("WORKOS_INTENT_ENCRYPTION_KEY", "");

    expect(() => fingerprintEmail("person@example.com")).toThrow(
      "Invalid WorkOS key configuration",
    );
    expect(() => encryptPendingAuthenticationToken("secret")).toThrow(
      "Invalid WorkOS key configuration",
    );
  });

  it.each(["", "not-base64", Buffer.alloc(31).toString("base64")])(
    "fails closed for a malformed key",
    (key) => {
      expect(() => fingerprintEmail("person@example.com", key)).toThrow(
        "Invalid WorkOS key configuration",
      );
      expect(() => encryptPendingAuthenticationToken("secret", key)).toThrow(
        "Invalid WorkOS key configuration",
      );
    },
  );
});
