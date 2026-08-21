import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,
  profiles: defineTable({
    ownerId: v.id("users"),
    displayName: v.string(),
    firstName: v.optional(v.string()),
    onboardingComplete: v.boolean(),
  }).index("by_owner", ["ownerId"]),
});
