// Test/local overlay only. Never include in the normal deployed Convex tree.
import { v } from 'convex/values';
import { mutation } from '../convex/_generated/server';
import { requireWorkOSIdentity } from '../convex/workosIdentity';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function refuse(): never { throw new Error('FIXTURE_CLEANUP_REFUSED'); }
function requireBinding(subject: string, runId: string) {
  const env = process.env;
  // CONVEX_CLOUD_URL is the server's built-in target, not a caller argument.
  if (env.WORKOS_MODE !== 'staging' || env.NODE_ENV === 'production'
    || env.CONVEX_DEPLOY_KEY || !/^(local|anonymous):[A-Za-z0-9_-]+$/.test(env.RECOVERY_FIXTURE_DEPLOYMENT ?? '')
    || !env.WORKOS_CLIENT_ID || env.WORKOS_CLIENT_ID !== env.WORKOS_STAGING_CLIENT_ID) refuse();
  let binding: unknown;
  try { binding = JSON.parse(env.RECOVERY_FIXTURE_BINDING ?? ''); } catch { refuse(); }
  if (typeof binding !== 'object' || binding === null) refuse();
  const b = binding as Record<string, unknown>;
  if (b.subject !== subject || b.runId !== runId || !uuid.test(runId)
    || typeof b.baseUrl !== 'string' || b.baseUrl !== env.CONVEX_CLOUD_URL) refuse();
  // Canonical exact HTTP loopback origin with explicit port; no credentials/path/query.
  if (!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):[1-9][0-9]{0,4}$/.test(b.baseUrl)) refuse();
  try { if (new URL(b.baseUrl).origin !== b.baseUrl) refuse(); } catch { refuse(); }
}

export const cleanup = mutation({
  args: { runId: v.string() },
  returns: v.object({ status: v.literal('absent') }),
  handler: async (ctx, {runId}) => {
    const {subject} = await requireWorkOSIdentity(ctx);
    requireBinding(subject, runId);
    const count = await ctx.db.query('counts').withIndex('by_owner_order', q => q.eq('ownerSubject', subject)).first();
    if (count !== null) refuse();
    // unique() refuses ambiguous ownership instead of deleting multiple rows.
    const profile = await ctx.db.query('profiles').withIndex('by_owner_subject', q => q.eq('ownerSubject', subject)).unique();
    if (profile !== null) await ctx.db.delete(profile._id);
    return {status:'absent'} as const;
  },
});
