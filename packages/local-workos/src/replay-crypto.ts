import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { Effect, Redacted } from "effect";

// Narrow native adapters. Identity-derived key material never enters configuration
// or wire responses. AAD binds each recoverable result to its exact SQLite row.
export const deriveReplayKey = (privateExponent: string, generation: string) =>
  Redacted.make(
    new Uint8Array(
      hkdfSync(
        "sha256",
        Buffer.from(privateExponent, "base64url"),
        generation,
        "local-workos/refresh-replay/v1",
        32,
      ),
    ),
  );
export const sealReplay = (
  key: Redacted.Redacted<Uint8Array>,
  plaintext: string,
  aad: string,
) =>
  Effect.try(() => {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", Redacted.value(key), nonce);
    cipher.setAAD(Buffer.from(aad));
    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString(
      "base64url",
    );
  });
export const openReplay = (
  key: Redacted.Redacted<Uint8Array>,
  sealed: string,
  aad: string,
) =>
  Effect.try(() => {
    const bytes = Buffer.from(sealed, "base64url");
    if (bytes.length < 29) {
      throw new Error("Invalid replay envelope");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      Redacted.value(key),
      bytes.subarray(0, 12),
    );
    decipher.setAAD(Buffer.from(aad));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([
      decipher.update(bytes.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
  });
