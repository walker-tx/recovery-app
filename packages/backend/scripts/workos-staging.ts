import { createHash, randomBytes, randomUUID } from 'node:crypto';

type Env = Record<string, string | undefined>;
type User = { id: string; email: string; externalId?: string | null; metadata: Record<string, string> };
export type Api = {
  createUser(input: { email: string; password: string; emailVerified: boolean; externalId: string; metadata: Record<string, string> }): Promise<User>;
  authenticateWithPassword(input: { clientId: string; email: string; password: string }): Promise<{ user: { id: string }; accessToken: string; refreshToken: string }>;
  listSessions(userId: string, options: { limit: number; after?: string }): Promise<{ data: { id: string; userId?: string }[]; listMetadata: { after?: string | null } }>;
  revokeSession(input: { sessionId: string }): Promise<void>;
  deleteUser(id: string): Promise<void>;
};
export const fingerprint = (key: string) => createHash('sha256').update(key).digest('hex');
export function stagingGuard(env: Env, requireBinding = true): boolean {
  return env.WORKOS_MODE === 'staging' && env.NODE_ENV !== 'production'
    && !env.CONVEX_DEPLOY_KEY
    && (!env.CONVEX_DEPLOYMENT || env.CONVEX_DEPLOYMENT.startsWith('local:'))
    && !!env.WORKOS_API_KEY && !!env.WORKOS_CLIENT_ID
    && (!requireBinding || (env.WORKOS_STAGING_KEY_SHA256 === fingerprint(env.WORKOS_API_KEY)
      && env.WORKOS_STAGING_CLIENT_ID === env.WORKOS_CLIENT_ID));
}
export async function smoke(env: Env, factory: () => Api | Promise<Api>) {
  const result = { runId: randomUUID(), code: 'GUARD_REFUSED', cleanup: 'not_needed', sessions: 'not_attempted' };
  if (!stagingGuard(env)) return result;
  let api: Api;
  try { api = await factory(); } catch { result.code = 'SDK_INIT_FAILED'; return result; }
  const email = `recovery-smoke+${result.runId}@example.com`;
  const externalId = `recovery-smoke:${result.runId}`;
  const password = randomBytes(32).toString('base64url') + 'aA1!';
  let userId: string | undefined;
  try {
    result.code = 'CREATE_UNKNOWN'; result.cleanup = 'unknown';
    // No retry: a transport failure may still have created the user.
    const user = await api.createUser({ email, password, emailVerified: true, externalId, metadata: { recoverySmokeRun: result.runId } });
    if (!user.id || user.email !== email || user.externalId !== externalId || user.metadata?.recoverySmokeRun !== result.runId) {
      result.code = 'OWNERSHIP_FAILED'; return result;
    }
    userId = user.id;
    result.code = 'AUTH_FAILED';
    const auth = await api.authenticateWithPassword({ clientId: env.WORKOS_CLIENT_ID!, email, password });
    if (auth.user.id !== userId || !auth.accessToken || !auth.refreshToken) return result;
    result.code = 'OK';
  } catch { /* Never serialize SDK errors: they may contain credentials. */ }
  finally {
    if (userId) {
      result.sessions = 'failed';
      try {
        let after: string | undefined;
        let complete = false;
        const seen = new Set<string>();
        for (let page = 0; page < 3; page++) {
          const sessions = await api.listSessions(userId, { limit: 10, after });
          if (sessions.data.length > 10 || sessions.data.some(s => !s.id || (s.userId !== undefined && s.userId !== userId))) throw Error();
          for (const session of sessions.data) await api.revokeSession({ sessionId: session.id });
          const next = sessions.listMetadata.after;
          if (!next) { complete = true; break; }
          if (seen.has(next)) throw Error();
          seen.add(next); after = next;
        }
        if (!complete) throw Error();
        result.sessions = 'revoked';
      } catch { if (result.code === 'OK') result.code = 'SESSION_CLEANUP_FAILED'; }
      try { await api.deleteUser(userId); result.cleanup = 'deleted'; }
      catch { result.cleanup = 'failed'; if (result.code === 'OK') result.code = 'DELETE_FAILED'; }
    }
  }
  return result;
}
