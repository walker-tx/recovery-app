import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nativeState, fixtureHooks, verifyRuntime } from './native-fixture.ts';
test('preflight refuses expired, foreign or mismatched runtimes', () => {
 const owner = {path:'/runtime',state:'ready',expires:'2026-09-06T00:00:00Z',target:{deployment:'anonymous-agent',url:'http://127.0.0.1:3220',site:'http://127.0.0.1:3221'}};
 assert.equal(verifyRuntime(owner,'/runtime',Date.parse('2026-09-05T23:00:00Z')),true);
 assert.equal(verifyRuntime(owner,'/other',0),false);
 assert.equal(verifyRuntime(owner,'/runtime',Date.parse('2026-09-07')),false);
 assert.equal(verifyRuntime({...owner,target:{...owner.target,url:'http://127.0.0.1:3210'}},'/runtime',0),false);
});
test('state exports classifications, never credentials; duplicate inputs fail closed',()=>{
 const node={children:[{attributes:{accessibilityText:'Email',value:'secret@example.org',bounds:'[1,2][30,40]'}},{attributes:{accessibilityText:'Password',value:'••••',bounds:'[1,50][30,80]'}}]};
 const s=nativeState(node);assert.equal(s.passwordLength,4);assert.equal(s.passwordMasked,true);assert.equal(JSON.stringify(s).includes('secret'),false);assert.equal(s.inputsUnambiguous,true);assert.equal(nativeState({children:[node,node]}).inputsUnambiguous,false);
});
const fixture={subject:'owned',runId:'run',accessToken:'token',email:'synthetic',password:'secret'};
function harness(failNative=false,failProfile=false){
 const events:string[]=[];let profile:unknown=null;
 const hooks=fixtureHooks({bind:async()=>{events.push('bind');},clearBinding:async()=>{events.push('clear');},profile:async()=>{events.push('profile');if(failProfile)throw Error();return profile;},counts:async()=>{events.push('counts');return {page:[],isDone:true};},cleanup:async()=>{events.push('cleanup');profile=null;return {status:'absent'};},onboard:async()=>{events.push('native');profile={displayName:'Native Fixture',onboardingComplete:true};if(failNative)throw Error();},capture:async()=>{events.push('capture');},signout:async()=>{events.push('signout');},contain:async()=>{events.push('contain');}});return {hooks,events};
}
test('guard before native; signout before cleanup; binding cleared last',async()=>{
 const {hooks,events}=harness();await hooks.exercise(fixture);await hooks.cleanup(fixture);
 assert.deepEqual(events,['bind','profile','cleanup','profile','counts','native','profile','counts','capture','signout','cleanup','profile','counts','clear']);
});
test('native failure after profile creation still signs out and cleans',async()=>{
 const {hooks,events}=harness(true);await assert.rejects(hooks.exercise(fixture));await hooks.cleanup(fixture);
 assert.deepEqual(events.slice(-5),['signout','cleanup','profile','counts','clear']);
});
test('independent absence checks settle and binding clears on failure',async()=>{
 const {hooks,events}=harness(false,true);await assert.rejects(hooks.cleanup(fixture));assert.equal(events.at(-1),'clear');assert.ok(events.includes('counts'));
});
test('literal label value is not empty',()=>{assert.equal(nativeState({children:[{attributes:{accessibilityText:'Email',value:'Email'}},{attributes:{accessibilityText:'Password',value:'Password'}}]}).fieldsEmpty,false);});
test('manifest SDK is nested and wrong SDK refuses',async()=>{const {manifestBundle}=await import('./native-fixture.ts');assert.equal(manifestBundle({extra:{expoClient:{sdkVersion:'57.0.0'}},launchAsset:{url:'http://localhost:8082/a.bundle'}}).port,'8082');assert.throws(()=>manifestBundle({extra:{expoClient:{sdkVersion:'56.0.0'}},launchAsset:{url:'http://localhost:8082/a.bundle'}}));});
test('incomplete profile refuses capture',async()=>{let captured=false;const hooks=fixtureHooks({bind:async()=>{},clearBinding:async()=>{},profile:async()=>++reads<=2?null:{displayName:'Native Fixture',onboardingComplete:false},counts:async()=>({page:[],isDone:true}),cleanup:async()=>({status:'absent'}),onboard:async()=>{},capture:async()=>{captured=true;},signout:async()=>{},contain:async()=>{}});let reads=0;await assert.rejects(hooks.exercise(fixture));assert.equal(captured,false);});
test('failed signout contains and cleans but cannot succeed',async()=>{const events:string[]=[];let reads=0;const hooks=fixtureHooks({bind:async()=>{},clearBinding:async()=>{events.push('clear');},profile:async()=>++reads===3?{displayName:'Native Fixture',onboardingComplete:true}:null,counts:async()=>({page:[],isDone:true}),cleanup:async()=>{events.push('cleanup');return {status:'absent'};},onboard:async()=>{},capture:async()=>{},signout:async()=>{throw Error();},contain:async()=>{events.push('contain');}});await hooks.exercise(fixture);await assert.rejects(hooks.cleanup(fixture));assert.deepEqual(events,['cleanup','contain','cleanup','clear']);});

test('owned deletion and absence verification survive session listing failure',async()=>{
 const {deleteOwnedProviderUser}=await import('./native-fixture.ts');const events:string[]=[];
 const result=await deleteOwnedProviderUser({listSessions:async()=>{throw Error('sensitive');},deleteUser:async()=>{events.push('delete');},getUser:async()=>{events.push('get');throw {status:404};}},'owned');
 assert.deepEqual(events,['delete','get']);assert.deepEqual(result,{sessionsVerified:'failed',providerDelete:'deleted',userVerified:'absent',ok:false});
});
test('active sessions and pagination refusal cannot skip owned deletion',async()=>{
 const {deleteOwnedProviderUser}=await import('./native-fixture.ts');
 for(const active of [true,false]){let deleted=0;const result=await deleteOwnedProviderUser({listSessions:async()=>({data:[{userId:'owned',status:active?'active':'revoked'}],listMetadata:{after:'repeat'}}),deleteUser:async()=>{deleted++;},getUser:async()=>{throw {status:404};}},'owned');assert.equal(deleted,1);assert.equal(result.ok,false);assert.equal(result.userVerified,'absent');}
});
test('delete failure still independently checks provider absence',async()=>{
 const {deleteOwnedProviderUser}=await import('./native-fixture.ts');let checked=false;
 const result=await deleteOwnedProviderUser({listSessions:async()=>({data:[],listMetadata:{}}),deleteUser:async()=>{throw Error();},getUser:async()=>{checked=true;throw {status:404};}},'owned');assert.equal(checked,true);assert.equal(result.providerDelete,'failed');assert.equal(result.sessionsVerified,'inactive');assert.equal(result.ok,false);
});
test('late password prompt resets settling before onboarding/counts advance',async()=>{
 const {settleNativeScreen}=await import('./native-fixture.ts');let now=0;let index=0;let dismissed=0;
 const trace=['counts','save-password','counts','counts','counts','counts','counts'] as const;
 const result=await settleNativeScreen({read:async()=>trace[Math.min(index++,trace.length-1)]!,dismiss:async()=>{dismissed++;},wait:async ms=>{now+=ms;},now:()=>now});
 assert.equal(result,'counts');assert.equal(dismissed,1);assert.ok(now>=3000);assert.ok(index>=7);
});
test('unsettled screen times out rather than advancing',async()=>{
 const {settleNativeScreen}=await import('./native-fixture.ts');let now=0;let index=0;
 await assert.rejects(settleNativeScreen({read:async()=>++index%2?'onboarding':'save-password',dismiss:async()=>{},wait:async ms=>{now+=ms;},now:()=>now}));assert.equal(now,12000);
});
test('provider cleanup success requires all three independent outcomes',async()=>{
 const {deleteOwnedProviderUser}=await import('./native-fixture.ts');
 const sdk={listSessions:async()=>({data:[{userId:'owned',status:'revoked'}],listMetadata:{}}),deleteUser:async()=>{},getUser:async()=>{throw {status:404};}};
 assert.equal((await deleteOwnedProviderUser(sdk,'owned')).ok,true);
 const result=await deleteOwnedProviderUser({...sdk,getUser:async()=>({id:'owned'})},'owned');assert.equal(result.ok,false);assert.equal(result.providerDelete,'deleted');assert.equal(result.userVerified,'failed');
});
test('artifact probe refuses images, hierarchy, canary and ordinary pass',async()=>{
 const {assessArtifactProbe}=await import('./native-fixture.ts');
 const failure={status:1,output:'RECOVERY_ARTIFACT_PROBE_MISSING_SELECTOR',junit:'<failure />'};
 assert.equal(assessArtifactProbe(failure,[]).ok,true);
 assert.equal(assessArtifactProbe({...failure,status:0},[]).ok,false);
 for(const file of [{path:'failure.png',text:''},{path:'view-hierarchy.json',text:''},{path:'commands.json',text:'native-artifact-canary@example.org'}])assert.equal(assessArtifactProbe(failure,[file]).ok,false);
 assert.equal(assessArtifactProbe({...failure,output:failure.output+' native-artifact-canary@example.org'},[]).ok,false);
 assert.equal(assessArtifactProbe(failure,[{path:'commands.json',text:'{"command":"tapOn"}'}]).ok,true);
});
