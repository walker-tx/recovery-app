import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import { countUnit } from "./countPolicy";

const authInitiationPurpose = v.union(
  v.literal("signup"),
  v.literal("recovery"),
);
const encryptedPendingToken = v.object({
  ciphertext: v.string(),
  nonce: v.string(),
  authenticationTag: v.string(),
});
const privateGuidanceCategory = v.union(
  v.literal("passwordSignInOrRecovery"),
  v.literal("googleSignIn"),
  v.literal("appleSignIn"),
);

export default defineSchema({
  counts: defineTable({
    ownerSubject: v.string(),
    name: v.string(),
    nameKey: v.string(),
    startAt: v.number(),
    unit: countUnit,
    order: v.number(),
  })
    .index("by_owner_order", ["ownerSubject", "order"])
    .index("by_owner_name", ["ownerSubject", "nameKey"]),
  signupIntents: defineTable({
    publicId: v.string(),
    emailFingerprint: v.string(),
    purpose: v.literal("signup"),
    encryptedPendingToken: v.optional(encryptedPendingToken),
    privateGuidanceCategory: v.optional(privateGuidanceCategory),
    state: v.union(
      v.literal("pending"),
      v.literal("inFlight"),
      v.literal("consumed"),
    ),
    leaseExpiresAt: v.optional(v.number()),
    expiresAt: v.number(),
    consumedAt: v.optional(v.number()),
  })
    .index("by_public_id", ["publicId"])
    .index("by_state_and_lease_expiry", ["state", "leaseExpiresAt"])
    .index("by_expiry", ["expiresAt"]),
  authInitiationRequests: defineTable({
    emailFingerprint: v.string(),
    purpose: authInitiationPurpose,
    expiresAt: v.number(),
  })
    .index("by_fingerprint_purpose_and_creation", [
      "emailFingerprint",
      "purpose",
    ])
    .index("by_expiry", ["expiresAt"]),
  profiles: defineTable({
    ownerSubject: v.string(),
    displayName: v.string(),
    firstName: v.optional(v.string()),
    onboardingComplete: v.boolean(),
  }).index("by_owner_subject", ["ownerSubject"]),
});
