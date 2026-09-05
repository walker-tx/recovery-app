import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { smoke, type Api } from './workos-staging.ts';
const secret = 'CANARY-secret-password-token';
const env = { WORKOS_MODE: 'staging', WORKOS_API_KEY: secret, WORKOS_CLIENT_ID: 'client-fixture', WORKOS_STAGING_CLIENT_ID: 'client-fixture', WORKOS_STAGING_KEY_SHA256: createHash('sha256').update(secret).digest('hex') };
function fixture(fail = '') {
  const calls: string[] = []; let user: any;
  const api: Api = {
    async createUser(input) { calls.push('create'); if (fail === 'create') throw Error(secret); user = { ...input, id: 'created-user' }; return user; },
    async authenticateWithPassword(input) { calls.push('auth'); assert.equal(input.password, user.password); if (fail === 'auth') throw Error(secret); return { user, accessToken: secret, refreshToken: secret }; },
    async listSessions(id) { calls.push('list'); assert.equal(id, user.id); return { data: [{ id: 'session', userId: fail === 'foreign' ? 'other' : id }], listMetadata: { after: null } }; },
    async revokeSession() { calls.push('revoke'); if (fail === 'revoke') throw Error(secret); },
    async deleteUser(id) { calls.push('delete'); assert.equal(id, user.id); if (fail === 'delete') throw Error(secret); },
  };
  return { api, calls, user: () => user };
}
for (const override of [{WORKOS_MODE:'production'}, {NODE_ENV:'production'}, {CONVEX_DEPLOYMENT:'prod:bad'}, {WORKOS_API_KEY:''}, {WORKOS_STAGING_KEY_SHA256:''}, {WORKOS_STAGING_KEY_SHA256:'bad'}, {WORKOS_STAGING_CLIENT_ID:'other'}]) {
  test(`guard ${JSON.stringify(override)}`, async () => { const f = fixture(); let factories = 0; const result = await smoke({...env,...override}, () => { factories++; return f.api; }); assert.equal(result.code, 'GUARD_REFUSED'); assert.equal(factories, 0); assert.deepEqual(f.calls, []); });
}
for (const failure of ['', 'create', 'auth', 'revoke', 'delete', 'foreign']) {
  test(`lifecycle ${failure || 'success'}`, async () => {
    const f = fixture(failure); const result = await smoke(env, () => f.api);
    assert.equal(JSON.stringify(result).includes(secret), false);
    assert.equal(result.code === 'OK', failure === '');
    assert.equal(result.cleanup, failure === 'create' ? 'unknown' : failure === 'delete' ? 'failed' : 'deleted');
    assert.equal(f.calls.includes('delete'), failure !== 'create');
    if (failure !== 'create') { assert.equal(f.user().email, `recovery-smoke+${result.runId}@example.org`); assert.equal(f.user().externalId, `recovery-smoke:${result.runId}`); assert.deepEqual(f.user().metadata, { recoverySmokeRun: result.runId }); assert.equal(f.user().emailVerified, true); }
    if (failure === 'foreign') assert.equal(f.calls.includes('revoke'), false);
  });
}
test('reject unowned create response without deleting', async () => { const f=fixture(); f.api.createUser=async () => ({id:'foreign',email:'other',externalId:'other',metadata:{}}); const r=await smoke(env,()=>f.api); assert.equal(r.cleanup,'unknown'); assert.equal(f.calls.includes('delete'),false); });
test('paginates only the owned user', async () => {
  const f=fixture(); let pages=0;
  f.api.listSessions=async (id, options) => { assert.equal(id,'created-user'); assert.equal(options.after, pages === 0 ? undefined : 'cursor'); pages++; return {data:[],listMetadata:{after:pages === 1 ? 'cursor' : null}}; };
  const r=await smoke(env,()=>f.api); assert.equal(pages,2); assert.equal(r.code,'OK'); assert.equal(r.cleanup,'deleted');
});
test('pagination failure still deletes', async () => {
  const f=fixture(); let pages=0;
  f.api.listSessions=async () => { pages++; return {data:[],listMetadata:{after:'repeat'}}; };
  const r=await smoke(env,()=>f.api); assert.equal(pages,2); assert.equal(r.code,'SESSION_CLEANUP_FAILED'); assert.equal(r.cleanup,'deleted');
});
test('page bound still deletes', async () => {
  const f=fixture(); let pages=0;
  f.api.listSessions=async () => ({data:[],listMetadata:{after:String(++pages)}});
  const r=await smoke(env,()=>f.api); assert.equal(pages,3); assert.equal(r.code,'SESSION_CLEANUP_FAILED'); assert.equal(r.cleanup,'deleted');
});
for (const override of [
  {CONVEX_DEPLOYMENT:'local:'}, {CONVEX_DEPLOYMENT:'anonymous:'},
  {CONVEX_DEPLOYMENT:'local:bad value'}, {CONVEX_DEPLOYMENT:'local:fixture\n'}, {CONVEX_DEPLOYMENT:'anonymous:a:b'},
  {CONVEX_DEPLOYMENT:'dev:cloud'}, {CONVEX_DEPLOYMENT:'cloud'}, {CONVEX_DEPLOY_KEY:'key'},
  {WORKOS_API_KEY:'   ', WORKOS_STAGING_KEY_SHA256:createHash('sha256').update('   ').digest('hex')},
  {WORKOS_CLIENT_ID:'   ', WORKOS_STAGING_CLIENT_ID:'   '},
  {WORKOS_STAGING_KEY_SHA256:'   '}, {WORKOS_STAGING_CLIENT_ID:'   '},
  {WORKOS_STAGING_KEY_SHA256:undefined}, {WORKOS_STAGING_CLIENT_ID:undefined},
]) {
  test(`strict guard ${JSON.stringify(override)}`, async () => {
    const f=fixture(); let factories=0;
    const r=await smoke({...env,...override},()=>{ factories++; return f.api; });
    assert.equal(r.code,'GUARD_REFUSED'); assert.equal(factories,0); assert.deepEqual(f.calls,[]);
  });
}
for (const deployment of ['local:fixture-123', 'anonymous:fixture_123']) {
  test(`accept ${deployment}`, async () => {
    const f=fixture(); const r=await smoke({...env,CONVEX_DEPLOYMENT:deployment},()=>f.api);
    assert.equal(r.code,'OK'); assert.equal(r.cleanup,'deleted');
  });
}
test('missing session ownership refuses all revocation but attempts owned deletion', async () => {
  const f=fixture();
  f.api.listSessions=async () => ({data:[{id:'owned',userId:'created-user'},{id:'unowned'}] as unknown as {id:string;userId:string}[],listMetadata:{}});
  const r=await smoke(env,()=>f.api);
  assert.equal(r.code,'SESSION_CLEANUP_FAILED'); assert.equal(r.cleanup,'deleted');
  assert.equal(f.calls.includes('revoke'),false); assert.equal(f.calls.includes('delete'),true);
});
test('CLI rejects enroll without changing a mock credential file', async () => {
  const {mkdtemp,writeFile,readFile,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const {fileURLToPath}=await import('node:url');
  const {spawnSync}=await import('node:child_process');
  const cwd=await mkdtemp(join(tmpdir(),'workos-cli-'));
  try {
    const original='[env]\nMOCK = "untouched"\n';
    await writeFile(join(cwd,'mise.local.toml'),original);
    const r=spawnSync(process.execPath,[fileURLToPath(new URL('./workos-staging-cli.ts',import.meta.url)),'enroll','--confirm-owner-verified-staging-pair'],{cwd,env:{...env},encoding:'utf8',timeout:10000});
    assert.equal(r.status,1); assert.deepEqual(JSON.parse(r.stdout),{code:'CLI_REFUSED'});
    assert.equal(await readFile(join(cwd,'mise.local.toml'),'utf8'),original);
  } finally { await rm(cwd,{recursive:true,force:true}); }
});
for (const field of ['code', 'error']) {
  for (const [value, reason] of [['invalid_grant', 'INVALID_GRANT'], ['organization_authentication_methods_required', 'ORGANIZATION_AUTHENTICATION_METHODS_REQUIRED'], [secret, 'UNKNOWN']]) {
    test(`sanitized auth ${field} ${reason}`, async () => {
      const f = fixture();
      f.api.authenticateWithPassword = async () => { throw { [field]: value, status: 400, message: secret, rawData: { error: secret }, headers: secret, requestID: secret }; };
      const r = await smoke(env, () => f.api);
      assert.equal(r.authReason, reason); assert.equal(r.authStatus, 400);
      assert.equal(JSON.stringify(r).includes(secret), false); assert.equal(r.cleanup, 'deleted');
    });
  }
}
test('unknown status and missing auth response fields stay sanitized', async () => {
  for (const [response, reason] of [[{}, 'MISSING_USER_ID'], [{user:{id:'other'}}, 'USER_ID_MISMATCH'], [{user:{id:'created-user'}}, 'MISSING_TOKENS']] as const) {
    const f = fixture(); f.api.authenticateWithPassword = async () => response as any;
    const r = await smoke(env, () => f.api); assert.equal(r.authReason, reason); assert.equal(r.cleanup, 'deleted');
  }
  const f = fixture(); f.api.authenticateWithPassword = async () => { throw {code:secret,status:secret}; };
  const r = await smoke(env, () => f.api); assert.equal(r.authReason, 'UNKNOWN'); assert.equal(r.authStatus, undefined); assert.equal(JSON.stringify(r).includes(secret), false);
});
