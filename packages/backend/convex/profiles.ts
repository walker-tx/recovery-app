import { v } from "convex/values";

import { mutation, query } from "./_generated/server";
import { requireWorkOSIdentity } from "./workosIdentity";
import {
  buildWorkOSOwnedProfile,
  shapePublicWorkOSProfile,
} from "./workosProfilePolicy";

const profileValue = v.object({
  displayName: v.string(),
  firstName: v.optional(v.string()),
  onboardingComplete: v.boolean(),
});

export const getMine = query({
  args: {},
  returns: v.union(v.null(), profileValue),
  handler: async (ctx) => {
    const { subject } = await requireWorkOSIdentity(ctx);
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_owner_subject", (q) => q.eq("ownerSubject", subject))
      .unique();

    return profile === null ? null : shapePublicWorkOSProfile(profile);
  },
});

export const complete = mutation({
  args: {
    displayName: v.string(),
    firstName: v.optional(v.string()),
  },
  returns: profileValue,
  handler: async (ctx, args) => {
    const { subject } = await requireWorkOSIdentity(ctx);
    const existing = await ctx.db
      .query("profiles")
      .withIndex("by_owner_subject", (q) => q.eq("ownerSubject", subject))
      .unique();
    const profile = buildWorkOSOwnedProfile(subject, args);

    if (existing === null) {
      await ctx.db.insert("profiles", profile);
    } else {
      await ctx.db.patch(existing._id, profile);
    }

    return shapePublicWorkOSProfile(profile);
  },
});
