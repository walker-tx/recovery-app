import { createHash, randomBytes, randomUUID } from 'node:crypto';

type Env = Record<string, string | undefined>;
type User = { id: string; email: string; externalId?: string | null; metadata: Record<string, string> };
export type Api = {
  createUser(input: { email: string; password: string; emailVerified: boolean; externalId: string; metadata: Record<string, string> }): Promise<User>;
  authenticateWithPassword(input: { clientId: string; email: string; password: string }): Promise<{ user: { id: string }; accessToken: string; refreshToken: string }>;
  listSessions(userId: string, options: { limit: number; after?: string }): Promise<{ data: { id: string; userId: string }[]; listMetadata: { after?: string | null } }>;
  revokeSession(input: { sessionId: string }): Promise<void>;
  deleteUser(id: string): Promise<void>;
};
export const fingerprint = (key: string) => createHash('sha256').update(key).digest('hex');
export function stagingGuard(env: Env): boolean {
  return env.WORKOS_MODE === 'staging' && env.NODE_ENV !== 'production'
    && !env.CONVEX_DEPLOY_KEY
    && (!env.CONVEX_DEPLOYMENT || (env.CONVEX_DEPLOYMENT === env.CONVEX_DEPLOYMENT.trim()
      && /^(?:local|anonymous):[A-Za-z0-9_-]+$/.test(env.CONVEX_DEPLOYMENT)))
    && !!env.WORKOS_API_KEY?.trim() && !!env.WORKOS_CLIENT_ID?.trim()
    && (env.WORKOS_STAGING_KEY_SHA256 === fingerprint(env.WORKOS_API_KEY!)
      && env.WORKOS_STAGING_CLIENT_ID === env.WORKOS_CLIENT_ID);
}
// Callback must verify profiles.getMine is null independently before returning absent.
export type AppCleanup = (fixture: { subject: string; runId: string; accessToken: string }) => Promise<{ status: 'absent' }>;
// Credentials are memory-only; adapters must never log or persist this input.
export type FixtureExercise = (fixture: { subject: string; runId: string; accessToken: string; email: string; password: string }) => Promise<void>;
export async function smoke(env: Env, factory: () => Api | Promise<Api>, appCleanup?: AppCleanup, exercise?: FixtureExercise) {
  const result: { runId: string; code: string; cleanup: string; sessions: string; authReason?: string; authStatus?: number; appCleanup?: 'not_attempted' | 'absent' | 'failed' } = { runId: randomUUID(), code: 'GUARD_REFUSED', cleanup: 'not_needed', sessions: 'not_attempted' };
  if (appCleanup) result.appCleanup = 'not_attempted';
  if (!stagingGuard(env)) return result;
  let api: Api;
  try { api = await factory(); } catch { result.code = 'SDK_INIT_FAILED'; return result; }
  const email = `recovery-smoke+${result.runId}@example.org`;
  const externalId = `recovery-smoke:${result.runId}`;
  const password = randomBytes(32).toString('base64url') + 'aA1!';
  let userId: string | undefined;
  let accessToken: string | undefined;
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
    if (!auth?.user?.id) { result.authReason = 'MISSING_USER_ID'; return result; }
    if (auth.user.id !== userId) { result.authReason = 'USER_ID_MISMATCH'; return result; }
    if (!auth.accessToken || !auth.refreshToken) { result.authReason = 'MISSING_TOKENS'; return result; }
    accessToken = auth.accessToken;
    if (exercise) {
      result.code = 'EXERCISE_FAILED';
      await exercise({ subject: userId, runId: result.runId, accessToken, email, password });
    }
    result.code = 'OK';
  } catch (error) {
    if (result.code === 'AUTH_FAILED') {
      // SDK OAuth exceptions use `error`; other exceptions use `code`.
      // Only fixed values cross this boundary, never provider strings or rawData.
      const provider = typeof error === 'object' && error !== null ? error as { code?: unknown; error?: unknown; status?: unknown } : {};
      const reasons = new Map<unknown, string>([
        ['invalid_grant', 'INVALID_GRANT'],
        ['invalid_credentials', 'INVALID_CREDENTIALS'],
        ['email_verification_required', 'EMAIL_VERIFICATION_REQUIRED'],
        ['organization_authentication_methods_required', 'ORGANIZATION_AUTHENTICATION_METHODS_REQUIRED'],
        ['organization_selection_required', 'ORGANIZATION_SELECTION_REQUIRED'],
        ['sso_required', 'SSO_REQUIRED'],
        ['mfa_enrollment', 'MFA_ENROLLMENT'],
        ['mfa_challenge', 'MFA_CHALLENGE'],
        ['mfa_verification', 'MFA_VERIFICATION'],
      ]);
      result.authReason = reasons.get(provider.code ?? provider.error) ?? 'UNKNOWN';
      if (typeof provider.status === 'number' && [400, 401, 403, 404, 408, 409, 422, 429, 500, 502, 503, 504].includes(provider.status)) result.authStatus = provider.status;
    }
  }
  finally {
    if (userId) {
      if (appCleanup && accessToken) {
        result.appCleanup = 'failed';
        try {
          const outcome = await appCleanup({ subject: userId, runId: result.runId, accessToken });
          if (outcome?.status !== 'absent') throw Error();
          result.appCleanup = 'absent';
        } catch { if (result.code === 'OK') result.code = 'APP_CLEANUP_FAILED'; }
      }
      result.sessions = 'failed';
      try {
        let after: string | undefined;
        let complete = false;
        const seen = new Set<string>();
        for (let page = 0; page < 3; page++) {
          const sessions = await api.listSessions(userId, { limit: 10, after });
          if (sessions.data.length > 10 || sessions.data.some(s => !s.id || s.userId !== userId)) throw Error();
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
