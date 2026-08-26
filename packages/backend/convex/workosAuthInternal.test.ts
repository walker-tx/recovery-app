import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import schema from "./schema.ts";

const modules = import.meta.glob("./**/*.ts");
const minute = 60_000;

type Purpose = "signup" | "recovery";
type EncryptedToken = { ciphertext: string; nonce: string; authenticationTag: string };

const admitInitiationRequest = makeFunctionReference<
  "mutation",
  { emailFingerprint: string; purpose: Purpose; now: number },
  { admitted: boolean }
>("workosAuthInternal:admitInitiationRequest");
const createSignupIntent = makeFunctionReference<
  "mutation",
  {
    publicId: string;
    emailFingerprint: string;
    purpose: "signup";
    encryptedPendingToken?: EncryptedToken;
    privateGuidanceCategory?: "passwordSignInOrRecovery" | "googleSignIn" | "appleSignIn";
    now: number;
  },
  null
>("workosAuthInternal:createSignupIntent");
const acquireSignupIntent = makeFunctionReference<
  "mutation",
  { publicId: string; now: number; leaseExpiresAt: number },
  {
    emailFingerprint: string;
    purpose: "signup";
    leaseExpiresAt: number;
    encryptedPendingToken?: EncryptedToken;
    privateGuidanceCategory?: "passwordSignInOrRecovery" | "googleSignIn" | "appleSignIn";
  }
>("workosAuthInternal:acquireSignupIntent");
const releaseSignupIntentLease = makeFunctionReference<
  "mutation",
  { publicId: string; leaseExpiresAt: number },
  null
>("workosAuthInternal:releaseSignupIntentLease");
const completeSignupIntent = makeFunctionReference<
  "mutation",
  { publicId: string; leaseExpiresAt: number; now: number },
  null
>("workosAuthInternal:completeSignupIntent");
const cleanupExpiredAuthData = makeFunctionReference<
  "mutation",
  { now: number },
  { deleted: number }
>("workosAuthInternal:cleanupExpiredAuthData");

async function createIntent(
  t: ReturnType<typeof convexTest>,
  publicId: string,
  now: number,
) {
  await t.mutation(createSignupIntent, {
    publicId,
    emailFingerprint: `fingerprint-${publicId}`,
    purpose: "signup",
    encryptedPendingToken: {
      ciphertext: "ciphertext",
      nonce: "nonce",
      authenticationTag: "tag",
    },
    now,
  });
}

describe("WorkOS auth persistence", () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date("2026-08-26T12:00:00Z")));
  afterEach(() => vi.useRealTimers());

  it("allows only one racing lease acquisition", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await createIntent(t, "intent-race", now);

    const attempts = await Promise.allSettled([
      t.mutation(acquireSignupIntent, {
        publicId: "intent-race",
        now,
        leaseExpiresAt: now + minute,
      }),
      t.mutation(acquireSignupIntent, {
        publicId: "intent-race",
        now,
        leaseExpiresAt: now + 2 * minute,
      }),
    ]);

    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejection = attempts.find(({ status }) => status === "rejected");
    expect(rejection).toMatchObject({
      status: "rejected",
      reason: { data: { code: "INVALID_SIGNUP_INTENT" } },
    });
  });

  it("reacquires an expired lease and rejects a stale release", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await createIntent(t, "intent-expiry", now);
    const firstLease = now + minute;
    const secondLease = now + 3 * minute;
    await t.mutation(acquireSignupIntent, {
      publicId: "intent-expiry",
      now,
      leaseExpiresAt: firstLease,
    });

    await expect(
      t.mutation(acquireSignupIntent, {
        publicId: "intent-expiry",
        now: firstLease,
        leaseExpiresAt: secondLease,
      }),
    ).resolves.toMatchObject({ leaseExpiresAt: secondLease });
    await expect(
      t.mutation(releaseSignupIntentLease, {
        publicId: "intent-expiry",
        leaseExpiresAt: firstLease,
      }),
    ).rejects.toMatchObject({ data: { code: "INVALID_SIGNUP_INTENT" } });
    await expect(
      t.mutation(releaseSignupIntentLease, {
        publicId: "intent-expiry",
        leaseExpiresAt: secondLease,
      }),
    ).resolves.toBeNull();
  });

  it("completes only the active lease and prevents replay", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await createIntent(t, "intent-complete", now);
    const leaseExpiresAt = now + minute;
    await t.mutation(acquireSignupIntent, {
      publicId: "intent-complete",
      now,
      leaseExpiresAt,
    });
    await t.mutation(completeSignupIntent, {
      publicId: "intent-complete",
      leaseExpiresAt,
      now: now + 1,
    });

    await expect(
      t.mutation(acquireSignupIntent, {
        publicId: "intent-complete",
        now: now + 2,
        leaseExpiresAt: now + 2 * minute,
      }),
    ).rejects.toMatchObject({ data: { code: "INVALID_SIGNUP_INTENT" } });
    const stored = await t.run(async (ctx) =>
      ctx.db
        .query("signupIntents")
        .withIndex("by_public_id", (q) => q.eq("publicId", "intent-complete"))
        .unique(),
    );
    expect(stored).toMatchObject({ state: "consumed", consumedAt: now + 1 });
    expect(stored).not.toHaveProperty("leaseExpiresAt");
  });

  it("admits five requests per fingerprint and purpose in each 15-minute window", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();

    for (let index = 0; index < 5; index += 1) {
      await expect(
        t.mutation(admitInitiationRequest, {
          emailFingerprint: "same-fingerprint",
          purpose: "signup",
          now,
        }),
      ).resolves.toEqual({ admitted: true });
    }
    await expect(
      t.mutation(admitInitiationRequest, {
        emailFingerprint: "same-fingerprint",
        purpose: "signup",
        now,
      }),
    ).resolves.toEqual({ admitted: false });
    await expect(
      t.mutation(admitInitiationRequest, {
        emailFingerprint: "same-fingerprint",
        purpose: "recovery",
        now,
      }),
    ).resolves.toEqual({ admitted: true });

    vi.setSystemTime(now + 15 * minute);
    await expect(
      t.mutation(admitInitiationRequest, {
        emailFingerprint: "same-fingerprint",
        purpose: "signup",
        now: now + 15 * minute,
      }),
    ).resolves.toEqual({ admitted: true });
  });

  it("deletes at most 100 expired or consumed records per cleanup batch", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    await t.run(async (ctx) => {
      for (let index = 0; index < 40; index += 1) {
        await ctx.db.insert("signupIntents", {
          publicId: `consumed-${index}`,
          emailFingerprint: `fingerprint-${index}`,
          purpose: "signup",
          state: "consumed",
          expiresAt: now + minute,
          consumedAt: now - 1,
        });
        await ctx.db.insert("signupIntents", {
          publicId: `expired-${index}`,
          emailFingerprint: `expired-fingerprint-${index}`,
          purpose: "signup",
          state: "pending",
          expiresAt: now - 1,
        });
        await ctx.db.insert("authInitiationRequests", {
          emailFingerprint: `request-fingerprint-${index}`,
          purpose: "recovery",
          expiresAt: now - 1,
        });
      }
    });

    await expect(t.mutation(cleanupExpiredAuthData, { now })).resolves.toEqual({ deleted: 100 });
    const remainingAfterFirstBatch = await t.run(async (ctx) => {
      const intents = await ctx.db.query("signupIntents").collect();
      const requests = await ctx.db.query("authInitiationRequests").collect();
      return intents.length + requests.length;
    });
    expect(remainingAfterFirstBatch).toBe(20);
    await expect(t.mutation(cleanupExpiredAuthData, { now })).resolves.toEqual({ deleted: 20 });
  });
});
