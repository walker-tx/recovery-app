"use node";

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const AUTHENTICATION_TAG_BYTES = 16;

export type EncryptedPendingAuthenticationToken = {
  ciphertext: string;
  nonce: string;
  authenticationTag: string;
};

export function fingerprintEmail(
  normalizedEmail: string,
  encodedKey = process.env.WORKOS_EMAIL_HMAC_KEY,
): string {
  return createHmac("sha256", decodeKey(encodedKey))
    .update(normalizedEmail, "utf8")
    .digest("hex");
}

export function encryptPendingAuthenticationToken(
  token: string,
  encodedKey = process.env.WORKOS_INTENT_ENCRYPTION_KEY,
  nonce = randomBytes(NONCE_BYTES),
): EncryptedPendingAuthenticationToken {
  if (nonce.length !== NONCE_BYTES) throw new Error("Invalid encryption nonce");

  const cipher = createCipheriv("aes-256-gcm", decodeKey(encodedKey), nonce, {
    authTagLength: AUTHENTICATION_TAG_BYTES,
  });
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);

  return {
    ciphertext: ciphertext.toString("base64"),
    nonce: nonce.toString("base64"),
    authenticationTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptPendingAuthenticationToken(
  encrypted: EncryptedPendingAuthenticationToken,
  encodedKey = process.env.WORKOS_INTENT_ENCRYPTION_KEY,
): string {
  const nonce = decodeBase64(encrypted.nonce);
  const authenticationTag = decodeBase64(encrypted.authenticationTag);
  if (nonce.length !== NONCE_BYTES || authenticationTag.length !== AUTHENTICATION_TAG_BYTES) {
    throw new Error("Invalid encrypted token");
  }

  const decipher = createDecipheriv("aes-256-gcm", decodeKey(encodedKey), nonce, {
    authTagLength: AUTHENTICATION_TAG_BYTES,
  });
  decipher.setAuthTag(authenticationTag);
  return Buffer.concat([
    decipher.update(decodeBase64(encrypted.ciphertext)),
    decipher.final(),
  ]).toString("utf8");
}

function decodeKey(encodedKey: string | undefined): Buffer {
  if (encodedKey === undefined) throw new Error("Invalid WorkOS key configuration");
  const key = decodeBase64(encodedKey);
  if (key.length !== KEY_BYTES) throw new Error("Invalid WorkOS key configuration");
  return key;
}

function decodeBase64(value: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Invalid WorkOS key configuration");
  }
  return Buffer.from(value, "base64");
}
