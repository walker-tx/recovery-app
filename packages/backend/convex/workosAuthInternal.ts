import { ConvexError, v } from "convex/values";

import { internalMutation } from "./_generated/server";

export const SIGNUP_INTENT_LIFETIME_MS = 10 * 60 * 1_000;
export const INITIATION_RATE_WINDOW_MS = 15 * 60 * 1_000;
export const INITIATION_RATE_LIMIT = 5;
export const AUTH_CLEANUP_BATCH_SIZE = 100;

const purposeValidator = v.union(v.literal("signup"), v.literal("recovery"));
const encryptedPendingTokenValidator = v.object({
  ciphertext: v.string(),
  nonce: v.string(),
  authenticationTag: v.string(),
});
const privateGuidanceCategoryValidator = v.union(
  v.literal("passwordSignInOrRecovery"),
  v.literal("googleSignIn"),
  v.literal("appleSignIn"),
);
const invalidSignupIntent = () =>
  new ConvexError({ code: "INVALID_SIGNUP_INTENT" as const });

export const admitInitiationRequest = internalMutation({
  args: {
    emailFingerprint: v.string(),
    purpose: purposeValidator,
    now: v.number(),
  },
  returns: v.object({ admitted: v.boolean() }),
  handler: async (ctx, args) => {
    const windowStart = args.now - INITIATION_RATE_WINDOW_MS;
    const recent = await ctx.db
      .query("authInitiationRequests")
      .withIndex("by_fingerprint_purpose_and_creation", (query) =>
        query
          .eq("emailFingerprint", args.emailFingerprint)
          .eq("purpose", args.purpose)
          .gt("_creationTime", windowStart),
      )
      .take(INITIATION_RATE_LIMIT);

    if (recent.length >= INITIATION_RATE_LIMIT) return { admitted: false };

    await ctx.db.insert("authInitiationRequests", {
      emailFingerprint: args.emailFingerprint,
      purpose: args.purpose,
      expiresAt: args.now + INITIATION_RATE_WINDOW_MS,
    });
    return { admitted: true };
  },
});

export const createSignupIntent = internalMutation({
  args: {
    publicId: v.string(),
    emailFingerprint: v.string(),
    purpose: v.literal("signup"),
    encryptedPendingToken: v.optional(encryptedPendingTokenValidator),
    privateGuidanceCategory: v.optional(privateGuidanceCategoryValidator),
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("signupIntents")
      .withIndex("by_public_id", (query) => query.eq("publicId", args.publicId))
      .unique();
    if (existing !== null) throw invalidSignupIntent();

    await ctx.db.insert("signupIntents", {
      publicId: args.publicId,
      emailFingerprint: args.emailFingerprint,
      purpose: args.purpose,
      encryptedPendingToken: args.encryptedPendingToken,
      privateGuidanceCategory: args.privateGuidanceCategory,
      state: "pending",
      expiresAt: args.now + SIGNUP_INTENT_LIFETIME_MS,
    });
    return null;
  },
});

export const acquireSignupIntent = internalMutation({
  args: {
    publicId: v.string(),
    now: v.number(),
    leaseExpiresAt: v.number(),
  },
  returns: v.object({
    emailFingerprint: v.string(),
    purpose: v.literal("signup"),
    leaseExpiresAt: v.number(),
    encryptedPendingToken: v.optional(encryptedPendingTokenValidator),
    privateGuidanceCategory: v.optional(privateGuidanceCategoryValidator),
  }),
  handler: async (ctx, args) => {
    const intent = await ctx.db
      .query("signupIntents")
      .withIndex("by_public_id", (query) => query.eq("publicId", args.publicId))
      .unique();
    const canAcquire =
      intent !== null &&
      intent.expiresAt > args.now &&
      args.leaseExpiresAt > args.now &&
      (intent.state === "pending" ||
        (intent.state === "inFlight" &&
          intent.leaseExpiresAt !== undefined &&
          intent.leaseExpiresAt <= args.now));
    if (!canAcquire || intent === null) throw invalidSignupIntent();

    await ctx.db.patch(intent._id, {
      state: "inFlight",
      leaseExpiresAt: args.leaseExpiresAt,
    });
    return {
      emailFingerprint: intent.emailFingerprint,
      purpose: intent.purpose,
      leaseExpiresAt: args.leaseExpiresAt,
      encryptedPendingToken: intent.encryptedPendingToken,
      privateGuidanceCategory: intent.privateGuidanceCategory,
    };
  },
});

export const releaseSignupIntentLease = internalMutation({
  args: { publicId: v.string(), leaseExpiresAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const intent = await ctx.db
      .query("signupIntents")
      .withIndex("by_public_id", (query) => query.eq("publicId", args.publicId))
      .unique();
    if (
      intent === null ||
      intent.state !== "inFlight" ||
      intent.leaseExpiresAt !== args.leaseExpiresAt
    ) {
      throw invalidSignupIntent();
    }

    await ctx.db.patch(intent._id, { state: "pending", leaseExpiresAt: undefined });
    return null;
  },
});

export const completeSignupIntent = internalMutation({
  args: { publicId: v.string(), leaseExpiresAt: v.number(), now: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const intent = await ctx.db
      .query("signupIntents")
      .withIndex("by_public_id", (query) => query.eq("publicId", args.publicId))
      .unique();
    if (
      intent === null ||
      intent.state !== "inFlight" ||
      intent.leaseExpiresAt !== args.leaseExpiresAt
    ) {
      throw invalidSignupIntent();
    }

    await ctx.db.patch(intent._id, {
      state: "consumed",
      leaseExpiresAt: undefined,
      consumedAt: args.now,
    });
    return null;
  },
});

export const cleanupExpiredAuthData = internalMutation({
  args: { now: v.number() },
  returns: v.object({ deleted: v.number() }),
  handler: async (ctx, args) => {
    const consumedIntents = await ctx.db
      .query("signupIntents")
      .withIndex("by_state_and_lease_expiry", (query) => query.eq("state", "consumed"))
      .take(AUTH_CLEANUP_BATCH_SIZE);
    for (const intent of consumedIntents) await ctx.db.delete(intent._id);

    const afterConsumed = AUTH_CLEANUP_BATCH_SIZE - consumedIntents.length;
    const expiredIntents =
      afterConsumed === 0
        ? []
        : await ctx.db
            .query("signupIntents")
            .withIndex("by_expiry", (query) => query.lte("expiresAt", args.now))
            .take(afterConsumed);
    for (const intent of expiredIntents) await ctx.db.delete(intent._id);

    const afterIntents = afterConsumed - expiredIntents.length;
    const expiredRequests =
      afterIntents === 0
        ? []
        : await ctx.db
            .query("authInitiationRequests")
            .withIndex("by_expiry", (query) => query.lte("expiresAt", args.now))
            .take(afterIntents);
    for (const request of expiredRequests) await ctx.db.delete(request._id);

    return {
      deleted: consumedIntents.length + expiredIntents.length + expiredRequests.length,
    };
  },
});
