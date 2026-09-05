import { ConvexError, v } from "convex/values";
import { caseFold } from "unicode-case-folding";
import { graphemeSegments } from "unicode-segmenter/grapheme";

export const countUnit = v.union(
  v.literal("hours"),
  v.literal("days"),
  v.literal("weeks"),
  v.literal("months"),
  v.literal("years"),
);

export function validatedName(input: string) {
  const name = input.trim();
  let length = 0;
  for (const _ of graphemeSegments(name)) {
    if (++length > 100)
      throw new ConvexError({
        code: "INVALID_NAME",
        message: "Use 100 characters or fewer.",
      });
  }
  if (length === 0) throw new ConvexError({ code: "INVALID_NAME" });
  return { name, nameKey: caseFold(name.normalize("NFD")).normalize("NFC") };
}

export function validateStart(startAt: number) {
  if (
    !Number.isFinite(startAt) ||
    Math.abs(startAt) > 8640000000000000 ||
    startAt > Date.now()
  ) {
    throw new ConvexError({ code: "INVALID_START" });
  }
}
