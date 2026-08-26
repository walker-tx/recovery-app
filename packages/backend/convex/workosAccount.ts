import { ConvexError, v } from "convex/values";

import { internalMutation, query } from "./_generated/server";
import { normalizeAuthEmail } from "./workosAuthPolicy";
import { requireWorkOSIdentity } from "./workosIdentity";

const accountValue = v.object({ userId: v.string(), email: v.string() });

export const upsertWorkOSIdentitySnapshot = internalMutation({
  args: { ownerSubject: v.string(), email: v.string(), updatedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const snapshots = await ctx.db
      .query("workosIdentitySnapshots")
      .withIndex("by_subject", (q) => q.eq("ownerSubject", args.ownerSubject))
      .take(2);
    if (snapshots.length > 1) {
      throw new ConvexError({ code: "WORKOS_IDENTITY_SNAPSHOT_DUPLICATE" });
    }

    const values = {
      ownerSubject: args.ownerSubject,
      email: normalizeAuthEmail(args.email),
      updatedAt: args.updatedAt,
    };
    if (snapshots[0] === undefined) {
      await ctx.db.insert("workosIdentitySnapshots", values);
    } else {
      await ctx.db.patch(snapshots[0]._id, values);
    }
    return null;
  },
});

export const getCurrentWorkOSAccount = query({
  args: {},
  returns: accountValue,
  handler: async (ctx) => {
    const { subject } = await requireWorkOSIdentity(ctx);
    const snapshots = await ctx.db
      .query("workosIdentitySnapshots")
      .withIndex("by_subject", (q) => q.eq("ownerSubject", subject))
      .take(2);
    if (snapshots.length > 1) {
      throw new ConvexError({ code: "WORKOS_IDENTITY_SNAPSHOT_DUPLICATE" });
    }
    const snapshot = snapshots[0];
    if (snapshot === undefined) {
      throw new ConvexError({ code: "WORKOS_IDENTITY_SNAPSHOT_MISSING" });
    }
    return { userId: subject, email: snapshot.email };
  },
});
