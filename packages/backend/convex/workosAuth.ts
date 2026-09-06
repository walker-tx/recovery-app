"use node";

import { randomUUID } from "node:crypto";

import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api";
import { action, type ActionCtx } from "./_generated/server";
import {
  deliverPrivateGuidance,
  deliverResetToken,
  deliverVerificationCode,
} from "./authEmailDelivery.ts";
import { workosGateway } from "./workos.ts";
import {
  createWorkOSAuthOrchestration,
  WorkOSAuthError,
} from "./workosAuthOrchestration.ts";
import {
  decryptPendingAuthenticationToken,
  encryptPendingAuthenticationToken,
  fingerprintEmail,
} from "./workosIntentCrypto.ts";

const sessionValue = v.object({
  accessToken: v.string(),
  refreshToken: v.string(),
});
const acceptedSignupValue = v.object({
  accepted: v.literal(true),
  intentId: v.string(),
});
const refreshValue = v.union(
  v.object({
    status: v.literal("success"),
    accessToken: v.string(),
    refreshToken: v.string(),
  }),
  v.object({ status: v.literal("invalid") }),
);

export const startSignup = action({
  args: { email: v.string(), password: v.string() },
  returns: acceptedSignupValue,
  handler: (ctx, args) =>
    runPublic(() => productionOrchestration(ctx).startSignup(args)),
});

export const completeSignup = action({
  args: { intentId: v.string(), code: v.string() },
  returns: sessionValue,
  handler: (ctx, args) =>
    runPublic(() => productionOrchestration(ctx).completeSignup(args)),
});

export const signIn = action({
  args: { email: v.string(), password: v.string() },
  returns: sessionValue,
  handler: (ctx, args) =>
    runPublic(() => productionOrchestration(ctx).signIn(args)),
});

export const refreshSession = action({
  args: { refreshToken: v.string() },
  returns: refreshValue,
  handler: (ctx, args) =>
    runPublic(() => productionOrchestration(ctx).refreshSession(args)),
});

export const signOutSession = action({
  args: { refreshToken: v.string() },
  returns: v.object({ revoked: v.literal(true) }),
  handler: (ctx, args) =>
    runPublic(() => productionOrchestration(ctx).signOutSession(args)),
});

export const startRecovery = action({
  args: { email: v.string() },
  returns: v.object({ accepted: v.literal(true) }),
  handler: (ctx, args) =>
    runPublic(() => productionOrchestration(ctx).startRecovery(args)),
});

export const resetPassword = action({
  args: { token: v.string(), newPassword: v.string() },
  returns: v.object({ reset: v.literal(true) }),
  handler: (ctx, args) =>
    runPublic(() => productionOrchestration(ctx).resetPassword(args)),
});

function productionOrchestration(
  ctx: ActionCtx,
): ReturnType<typeof createWorkOSAuthOrchestration> {
  return createWorkOSAuthOrchestration({
    gateway: workosGateway,
    now: Date.now,
    newIntentId: randomUUID,
    fingerprintEmail,
    encryptPendingAuthenticationToken,
    decryptPendingAuthenticationToken,
    delivery: {
      verification: deliverVerificationCode,
      reset: deliverResetToken,
      guidance: deliverPrivateGuidance,
    },
    intents: {
      async admitInitiationRequest(input) {
        const result = await ctx.runMutation(
          internal.workosAuthInternal.admitInitiationRequest,
          input,
        );
        return result.admitted;
      },
      async createSignupIntent(input) {
        await ctx.runMutation(
          internal.workosAuthInternal.createSignupIntent,
          input,
        );
      },
      async acquireSignupIntent(input) {
        return ctx.runMutation(
          internal.workosAuthInternal.acquireSignupIntent,
          input,
        );
      },
      async releaseSignupIntentLease(input) {
        await ctx.runMutation(
          internal.workosAuthInternal.releaseSignupIntentLease,
          input,
        );
      },
      async completeSignupIntent(input) {
        await ctx.runMutation(
          internal.workosAuthInternal.completeSignupIntent,
          input,
        );
      },
      async cleanupExpiredAuthData() {
        await ctx.runMutation(
          internal.workosAuthInternal.cleanupExpiredAuthData,
          {},
        );
      },
    },
  });
}

async function runPublic<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof WorkOSAuthError) {
      throw new ConvexError({ code: error.code });
    }
    throw new ConvexError({ code: "PROVIDER_UNAVAILABLE" as const });
  }
}
