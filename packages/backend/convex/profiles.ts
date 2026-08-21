import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";

import { mutation, query, type QueryCtx } from "./_generated/server";

const DISPLAY_NAME_MAX_LENGTH = 80;
const FIRST_NAME_MAX_LENGTH = 50;

const profileValue = v.object({
  displayName: v.string(),
  firstName: v.optional(v.string()),
  onboardingComplete: v.boolean(),
});

async function requireUserId(ctx: Pick<QueryCtx, "auth">) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError({ code: "UNAUTHENTICATED" });
  }
  return userId;
}

function publicProfile(profile: {
  displayName: string;
  firstName?: string;
  onboardingComplete: boolean;
}) {
  return {
    displayName: profile.displayName,
    ...(profile.firstName === undefined ? {} : { firstName: profile.firstName }),
    onboardingComplete: profile.onboardingComplete,
  };
}

export const getMine = query({
  args: {},
  returns: v.union(v.null(), profileValue),
  handler: async (ctx) => {
    const ownerId = await requireUserId(ctx);
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .unique();

    return profile === null ? null : publicProfile(profile);
  },
});

export const complete = mutation({
  args: {
    displayName: v.string(),
    firstName: v.optional(v.string()),
  },
  returns: profileValue,
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const displayName = args.displayName.trim();
    const firstName = args.firstName?.trim() || undefined;

    if (
      displayName === "" ||
      displayName.length > DISPLAY_NAME_MAX_LENGTH ||
      (firstName !== undefined && firstName.length > FIRST_NAME_MAX_LENGTH)
    ) {
      throw new ConvexError({ code: "INVALID_PROFILE" });
    }

    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .unique();
    const profile = {
      ownerId,
      displayName,
      firstName,
      onboardingComplete: true,
    };

    if (existing === null) {
      await ctx.db.insert("profiles", profile);
    } else {
      await ctx.db.patch(existing._id, profile);
    }

    return publicProfile(profile);
  },
});
