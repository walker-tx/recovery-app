import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import schema from '../convex/schema';
import { api } from '../convex/_generated/api';
const modules = { ...import.meta.glob('../convex/**/*.ts'), '../convex/fixtureCleanup.ts': () => import('./fixtureCleanup') };
const cleanup = makeFunctionReference<'mutation', {runId:string}, {status:'absent'}>('fixtureCleanup:cleanup');
const runId = '12345678-1234-4234-8234-123456789abc';
const identity = { subject: 'user_fixture', client_id: 'client_TEST', issuer: 'https://api.workos.com/user_management/client_TEST' };
const binding = JSON.stringify({subject:identity.subject,runId,baseUrl:'http://127.0.0.1:3210'});
beforeEach(() => {
  for (const [key,value] of Object.entries({WORKOS_CLIENT_ID:'client_TEST',WORKOS_STAGING_CLIENT_ID:'client_TEST',WORKOS_MODE:'staging',NODE_ENV:'test',RECOVERY_FIXTURE_DEPLOYMENT:'local:fixture',CONVEX_CLOUD_URL:'http://127.0.0.1:3210',RECOVERY_FIXTURE_BINDING:binding})) vi.stubEnv(key,value);
  vi.stubEnv('CONVEX_DEPLOY_KEY','');
  vi.stubEnv('CONVEX_DEPLOYMENT',undefined);
});
afterEach(() => vi.unstubAllEnvs());
async function setup() {
  const t = convexTest(schema,modules);
  await t.run(async ctx => {
    for (const ownerSubject of [identity.subject,'user_ordinary']) await ctx.db.insert('profiles',{ownerSubject,displayName:'Same synthetic-looking name',onboardingComplete:true});
  });
  return {t,owned:t.withIdentity(identity)};
}
test('deletes only bound profile; independent getMine proves absence; repeat is harmless',async()=>{
  const {t,owned}=await setup();
  expect(await owned.mutation(cleanup,{runId})).toEqual({status:'absent'});
  expect(await owned.query(api.profiles.getMine,{})).toBeNull();
  expect(await owned.mutation(cleanup,{runId})).toEqual({status:'absent'});
  expect(await t.withIdentity({...identity,subject:'user_ordinary'}).query(api.profiles.getMine,{})).not.toBeNull();
});
for (const override of [null,{client_id:'client_OTHER'},{issuer:'https://evil.invalid'},{subject:'user_ordinary'}]) test(`refuses identity ${JSON.stringify(override)}`,async()=>{
  const {t}=await setup();
  const caller=override===null?t:t.withIdentity({...identity,...override});
  await expect(caller.mutation(cleanup,{runId})).rejects.toThrow();
  expect(await t.run(ctx=>ctx.db.query('profiles').collect())).toHaveLength(2);
});
for (const [key,value] of Object.entries({WORKOS_MODE:'production',NODE_ENV:'production',WORKOS_STAGING_CLIENT_ID:'client_OTHER',RECOVERY_FIXTURE_DEPLOYMENT:'prod:foo',CONVEX_CLOUD_URL:'https://example.com',RECOVERY_FIXTURE_BINDING:'bad',CONVEX_DEPLOY_KEY:'secret'})) test(`refuses ${key}`,async()=>{
  const {owned}=await setup();vi.stubEnv(key,value);await expect(owned.mutation(cleanup,{runId})).rejects.toThrow();
});
for (const key of ['WORKOS_MODE','RECOVERY_FIXTURE_DEPLOYMENT','CONVEX_CLOUD_URL','RECOVERY_FIXTURE_BINDING']) test(`missing ${key}`,async()=>{
  const {owned}=await setup();vi.stubEnv(key,undefined);await expect(owned.mutation(cleanup,{runId})).rejects.toThrow();
});
for (const patch of [{subject:'user_other'},{runId:'wrong'},{baseUrl:'http://127.0.0.1:3211'},{baseUrl:'http://localhost:3210/'},{baseUrl:'https://example.com'}]) test(`binding refuses ${JSON.stringify(patch)}`,async()=>{
 const {owned}=await setup();vi.stubEnv('RECOVERY_FIXTURE_BINDING',JSON.stringify({...JSON.parse(binding),...patch}));await expect(owned.mutation(cleanup,{runId})).rejects.toThrow();
});
test('run mismatch, duplicates and Counts fail closed',async()=>{
 const {t,owned}=await setup();
 await expect(owned.mutation(cleanup,{runId:'wrong'})).rejects.toThrow();
 const duplicate=await t.run(ctx=>ctx.db.insert('profiles',{ownerSubject:identity.subject,displayName:'duplicate',onboardingComplete:true}));
 await expect(owned.mutation(cleanup,{runId})).rejects.toThrow();
 await t.run(async ctx=>{await ctx.db.delete(duplicate);await ctx.db.insert('counts',{ownerSubject:identity.subject,name:'Count',nameKey:'count',startAt:0,unit:'days',order:0});});
 await expect(owned.mutation(cleanup,{runId})).rejects.toThrow();
 expect(await owned.query(api.profiles.getMine,{})).not.toBeNull();
 expect(await t.run(ctx=>ctx.db.query('counts').collect())).toHaveLength(1);
});
for (const baseUrl of ['http://127.0.0.1:0','http://127.0.0.1:99999','http://127.0.0.1:03210','http://127.0.0.1:3210/','http://user@127.0.0.1:3210','http://127.0.0.1:3210?x=1','https://example.com','http://127.0.0.1.evil:3210']) test(`invalid exact target ${baseUrl}`,async()=>{
 const {owned}=await setup();vi.stubEnv('CONVEX_CLOUD_URL',baseUrl);vi.stubEnv('RECOVERY_FIXTURE_BINDING',JSON.stringify({...JSON.parse(binding),baseUrl}));await expect(owned.mutation(cleanup,{runId})).rejects.toThrow('FIXTURE_CLEANUP_REFUSED');
});
for (const malformed of ['null','[]','{}','"user_fixture"']) test(`malformed binding ${malformed}`,async()=>{
 const {owned}=await setup();vi.stubEnv('RECOVERY_FIXTURE_BINDING',malformed);await expect(owned.mutation(cleanup,{runId})).rejects.toThrow('FIXTURE_CLEANUP_REFUSED');
});
test('other user Counts survive and do not block fixture profile cleanup',async()=>{
 const {t,owned}=await setup();await t.run(ctx=>ctx.db.insert('counts',{ownerSubject:'user_ordinary',name:'Count',nameKey:'count',startAt:0,unit:'days',order:0}));
 await owned.mutation(cleanup,{runId});expect(await t.run(ctx=>ctx.db.query('counts').collect())).toHaveLength(1);
});
test('caller-supplied subject cannot broaden the mutation contract',async()=>{
 const {owned}=await setup();await expect(owned.mutation(cleanup,{runId,subject:'user_ordinary'} as {runId:string})).rejects.toThrow();
});
test('Counts refusal also applies when profile is already absent',async()=>{
 const {t,owned}=await setup();await owned.mutation(cleanup,{runId});
 await t.run(ctx=>ctx.db.insert('counts',{ownerSubject:identity.subject,name:'Count',nameKey:'count',startAt:0,unit:'days',order:0}));
 await expect(owned.mutation(cleanup,{runId})).rejects.toThrow('FIXTURE_CLEANUP_REFUSED');
});

for (const deployment of ['', 'local:', 'local:bad space', 'dev:remote', 'prod:remote', ' anonymous:fixture', 'local:fixture\n']) test(`invalid server deployment ${deployment}`,async()=>{
 const {owned}=await setup();vi.stubEnv('RECOVERY_FIXTURE_DEPLOYMENT',deployment);vi.stubEnv('CONVEX_DEPLOYMENT','local:cliOnly');await expect(owned.mutation(cleanup,{runId})).rejects.toThrow('FIXTURE_CLEANUP_REFUSED');
});
