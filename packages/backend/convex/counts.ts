import {
  paginationOptsValidator,
  paginationResultValidator,
} from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { countUnit, validatedName, validateStart } from "./countPolicy";
import { requireWorkOSIdentity } from "./workosIdentity";

const countValue = v.object({
  _id: v.id("counts"),
  _creationTime: v.number(),
  ownerSubject: v.string(),
  name: v.string(),
  nameKey: v.string(),
  startAt: v.number(),
  unit: countUnit,
  order: v.number(),
});
async function owned(ctx: QueryCtx, id: Id<"counts">, subject: string) {
  const count = await ctx.db.get(id);
  if (count === null || count.ownerSubject !== subject)
    throw new ConvexError({ code: "COUNT_NOT_FOUND" });
  return count;
}

export const create = mutation({
  args: { name: v.string(), startAt: v.number() },
  returns: v.id("counts"),
  handler: async (ctx, args) => {
    const { subject } = await requireWorkOSIdentity(ctx);
    const name = validatedName(args.name);
    validateStart(args.startAt);
    const first = await ctx.db
      .query("counts")
      .withIndex("by_owner_order", (q) => q.eq("ownerSubject", subject))
      .first();
    const order = (first?.order ?? 0) - 1;
    if (!Number.isSafeInteger(order))
      throw new ConvexError({ code: "ORDER_OUT_OF_RANGE" });
    return await ctx.db.insert("counts", {
      ownerSubject: subject,
      ...name,
      startAt: args.startAt,
      unit: "days",
      order,
    });
  },
});
export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(countValue),
  handler: async (ctx, { paginationOpts }) => {
    const { subject } = await requireWorkOSIdentity(ctx);
    if (
      !Number.isInteger(paginationOpts.numItems) ||
      paginationOpts.numItems < 1 ||
      paginationOpts.numItems > 100
    ) {
      throw new ConvexError({ code: "INVALID_PAGE_SIZE" });
    }
    return await ctx.db
      .query("counts")
      .withIndex("by_owner_order", (q) => q.eq("ownerSubject", subject))
      .paginate({
        ...paginationOpts,
        // endCursor can exceed numItems; keep read budgets server-owned.
        maximumRowsRead: 100,
        // Bound large graphemes too; Convex may split the page at this budget.
        maximumBytesRead: 1024 * 1024,
      });
  },
});
export const get = query({
  args: { id: v.id("counts") },
  returns: countValue,
  handler: async (ctx, { id }) => {
    const { subject } = await requireWorkOSIdentity(ctx);
    return await owned(ctx, id, subject);
  },
});
export const findDuplicate = query({
  args: { name: v.string(), excludeId: v.optional(v.id("counts")) },
  returns: v.union(v.null(), countValue),
  handler: async (ctx, { name, excludeId }) => {
    const { subject } = await requireWorkOSIdentity(ctx);
    if (excludeId !== undefined) await owned(ctx, excludeId, subject);
    if (name.trim() === "") return null;
    const { nameKey } = validatedName(name);
    const matches = await ctx.db
      .query("counts")
      .withIndex("by_owner_name", (q) =>
        q.eq("ownerSubject", subject).eq("nameKey", nameKey),
      )
      .take(2);
    return matches.find((count) => count._id !== excludeId) ?? null;
  },
});
export const edit = mutation({
  args: { id: v.id("counts"), name: v.string(), startAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { id, name, startAt }) => {
    const { subject } = await requireWorkOSIdentity(ctx);
    await owned(ctx, id, subject);
    const normalized = validatedName(name);
    validateStart(startAt);
    await ctx.db.patch(id, { ...normalized, startAt });
    return null;
  },
});
export const setUnit = mutation({
  args: { id: v.id("counts"), unit: countUnit },
  returns: v.null(),
  handler: async (ctx, { id, unit }) => {
    const { subject } = await requireWorkOSIdentity(ctx);
    await owned(ctx, id, subject);
    await ctx.db.patch(id, { unit });
    return null;
  },
});
export const remove = mutation({
  args: { id: v.id("counts") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    const { subject } = await requireWorkOSIdentity(ctx);
    await owned(ctx, id, subject);
    await ctx.db.delete(id);
    return null;
  },
});
// Bounded permutation of selected positions, not replacement of collection membership.
// Clients can reorder any subset; omitted/new Counts stay in their current positions.
export const reorder = mutation({
  args: { ids: v.array(v.id("counts")) },
  returns: v.null(),
  handler: async (ctx, { ids }) => {
    const { subject } = await requireWorkOSIdentity(ctx);
    if (ids.length > 256 || new Set(ids).size !== ids.length)
      throw new ConvexError({ code: "INVALID_ORDER" });
    const counts = [];
    for (const id of ids) {
      const count = await ctx.db.get(id);
      if (count === null) continue; // A stale order must not resurrect a deletion.
      if (count.ownerSubject !== subject)
        throw new ConvexError({ code: "COUNT_NOT_FOUND" });
      counts.push(count);
    }
    const positions = counts.map((count) => count.order).sort((a, b) => a - b);
    for (let i = 0; i < counts.length; i++)
      await ctx.db.patch(counts[i]._id, { order: positions[i] });
    return null;
  },
});
