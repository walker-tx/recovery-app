import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,readdirSync,statSync,realpathSync,existsSync} from 'node:fs';
import {dirname} from 'node:path';
import {smoke,stagingGuard} from './workos-staging.ts';
import {fixtureHooks,verifyRuntime,manifestBundle,deleteOwnedProviderUser,settleNativeScreen,assessArtifactProbe,artifactCanary,artifactMissingSelector} from './native-fixture.ts';
process.umask(0o077);
const [mode,runtimeArg,wrapperArg,uuid,...extra]=process.argv.slice(2);
const approved='/tmp/maestro-pr3496.F7AlwO/maestro-isolated';
const cleanEnv={PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:process.env.HOME};
const secrets=[],buffers=[];const started=Date.now();
const artifacts=mkdtempSync('/tmp/recovery-native-fixture-');
const report={code:'ARGUMENTS_REFUSED',artifacts,fixtureCreated:false};
let runtime,wrapper,cliEnv,owner;
let probeStarted=false;
function artifactProbeApproved(){
 const lib=dirname(approved)+'/Maestro/maestro-cli/build/install/maestro/lib/';
 const pins=[
  [approved,'224590c71da01e424786e5b933ee047336213c0570b5a907a269f297896b1f0a'],
  [lib+'maestro-orchestra.jar','1eae8e84e26034663dd7ba8dcede02caa9ece71e646ef1daa55c18057bce0d95'],
  [lib+'maestro-cli-2.8.0.jar','8a11ae706d35858432e8a9dd2b4ae36a936acb964c098396cb8c2b76ba798b36'],
  [lib+'maestro-ios-driver.jar','0b3193df2b8cfaa2c34038d293f79be33d2c3ba4981571dc1f4c310a1aab9517']
 ];
 try{return pins.every(([path,hash])=>createHash('sha256').update(readFileSync(path)).digest('hex')===hash);}catch{return false;}
}
function fail(){throw Error('NATIVE_FIXTURE_REFUSED');}
function command(cmd,args,timeout=15000,input,env=cleanEnv,cwd=runtime){const p=spawnSync(cmd,args,{cwd,env,timeout,input,encoding:'utf8',maxBuffer:30000000});buffers.push(p.stdout??'',p.stderr??'');if(p.status!==0)fail();return p.stdout;}
function clipboard(value){command('/usr/bin/xcrun',['simctl','pbcopy',uuid],8000,value);}
function flow(name,body){const path=artifacts+'/'+name+'.yaml';writeFileSync(path,'appId: host.exp.Exponent\n---\n'+body);command(wrapper,['--udid',uuid,'test','--format','JUNIT','--output',artifacts+'/'+name+'.xml','--test-output-dir',artifacts+'/'+name,'--debug-output',artifacts+'/'+name+'-debug',path],40000);}
function hierarchy(){const raw=command(wrapper,['--udid',uuid,'hierarchy'],18000);if(mode==='artifact-probe')buffers.splice(-2);const tree=JSON.parse(raw.slice(raw.indexOf('{')));const nodes=[];function walk(n){nodes.push(n.attributes??{});for(const c of n.children??[])walk(c);}walk(tree);return nodes;}
function has(ns,label){return ns.some(a=>a.text===label||a.accessibilityText===label);}
function bounds(a){const m=String(a.bounds??'').match(/^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/);return m?m.slice(1).map(Number):null;}
function input(ns,label){const candidates=ns.filter(a=>a.accessibilityText===label&&typeof a.value==='string').map(a=>({a,b:bounds(a)})).filter(x=>x.b&&x.b[2]-x.b[0]>=100&&x.b[3]-x.b[1]>=35);const unique=[...new Map(candidates.map(x=>[x.b.join(','),x])).values()];if(unique.length!==1)fail();return unique[0];}
function point(ns,box){const viewport=ns.map(bounds).filter(Boolean).sort((a,b)=>(b[2]*b[3])-(a[2]*a[3]))[0];if(!viewport||viewport[0]!==0||viewport[1]!==0||box[2]>viewport[2]||box[3]>viewport[3])fail();return `${((box[0]+box[2])/2/viewport[2]*100).toFixed(3)}%,${((box[1]+box[3])/2/viewport[3]*100).toFixed(3)}%`;}
function paste(label,value,name){const ns=hierarchy();const selected=input(ns,label);if(selected.a.value!=='')fail();const p=point(ns,selected.b);clipboard(value);try{flow(name,`- tapOn:\n    point: "${p}"\n- longPressOn:\n    point: "${p}"\n- tapOn: "Paste"\n- runFlow:\n    when:\n      visible: "Allow Paste"\n    commands:\n      - tapOn: "Allow Paste"\n`);}finally{clipboard('');}}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function loaded(){let attempt=0;return settleNativeScreen({read:async()=>{const ns=hierarchy();if(has(ns,'Save Password?'))return 'save-password';if(has(ns,'LAST STEP'))return 'onboarding';if(has(ns,'NO COUNTS YET')&&has(ns,'Create your first Count'))return 'counts';if(has(ns,'Show password')||has(ns,'Get started'))return 'unauthenticated';return 'unknown';},dismiss:async()=>{flow('not-now-'+attempt++,'- tapOn: "Not Now"\n');},wait,now:Date.now});}
function migration(){if(existsSync(runtime+'/packages/backend/.env.local'))command('/bin/sh',[runtime+'/scripts/migrate-convex-dotenv.sh'],15000,undefined,{...process.env,CONVEX_AGENT_MODE:'anonymous'},runtime);}
function envCommand(args,value){migration();return command('pnpm',['exec','convex','env',...args],15000,value,cliEnv,runtime+'/packages/backend');}
function clearBinding(){envCommand(['remove','RECOVERY_FIXTURE_BINDING']);}
function scan(){let full=0,fragments=0,skipped=0,files=0;const needles=secrets.filter(s=>typeof s==='string'&&s.length>=16);function check(text){for(const n of needles){if(text.includes(n))full++;if(text.includes(n.slice(0,16))||text.includes(n.slice(-16)))fragments++;}}for(const b of buffers)check(b);function walk(dir){try{for(const f of readdirSync(dir,{withFileTypes:true})){const p=dir+'/'+f.name;if(f.isDirectory())walk(p);else if(f.isFile()){const s=statSync(p);if(s.mtimeMs<started)continue;if(s.size>30000000){skipped++;continue;}files++;check(readFileSync(p).toString('utf8'));}}}catch{skipped++;}}for(const p of [artifacts,dirname(approved)+'/home/.maestro',dirname(approved)+'/tmp'])walk(p);return {files,fullMatches:full,fragmentMatches:fragments,skipped};}
async function artifactProbe(){
 probeStarted=true;report.code='ARTIFACT_PROBE_FAILED';let failure={status:null,output:'',junit:''};const flowBufferStart=buffers.length;
 try {
  paste('Email',artifactCanary,'probe-paste');
  const current=hierarchy();if(!has(current,'Show password')||input(current,'Email').a.value!==artifactCanary||input(current,'Password').a.value!=='')fail();
  const path=artifacts+'/probe-failure.yaml';writeFileSync(path,'appId: host.exp.Exponent\n---\n- assertVisible: "'+artifactMissingSelector+'"\n');
  const result=spawnSync(wrapper,['--udid',uuid,'test','--format','JUNIT','--output',artifacts+'/probe-failure.xml','--test-output-dir',artifacts+'/probe-failure','--debug-output',artifacts+'/probe-failure-debug',path],{cwd:runtime,env:cleanEnv,encoding:'utf8',timeout:40000,maxBuffer:30000000});
  buffers.push(result.stdout??'',result.stderr??'');failure={status:result.status,output:(result.stdout??'')+(result.stderr??''),junit:existsSync(artifacts+'/probe-failure.xml')?readFileSync(artifacts+'/probe-failure.xml','utf8'):''};
 } catch {report.probeActionFailed=true;} finally {
  try {const current=hierarchy();if(!has(current,'Show password')||input(current,'Password').a.value!=='')fail();const p=point(current,input(current,'Email').b);flow('probe-erase',`- tapOn:\n    point: "${p}"\n- eraseText: 100\n`);report.probeEmailCleared=input(hierarchy(),'Email').a.value==='';if(!report.probeEmailCleared)fail();}
  finally {clipboard('');report.probeClipboardEmpty=command('/usr/bin/xcrun',['simctl','pbpaste',uuid],8000)==='';if(!report.probeClipboardEmpty)fail();}
 }
 const files=[];let bytes=0;let visited=0;
 function walk(dir,freshOnly){for(const entry of readdirSync(dir,{withFileTypes:true})){if(++visited>10000)fail();const path=dir+'/'+entry.name;if(entry.isSymbolicLink())fail();if(entry.isDirectory())walk(path,freshOnly);else if(entry.isFile()){const st=statSync(path);if(freshOnly&&st.mtimeMs<started)continue;bytes+=st.size;if(bytes>30000000||files.length>=1000)fail();const data=readFileSync(path);files.push({path,text:data.toString('utf8'),image:data.subarray(0,4).equals(Buffer.from([137,80,78,71]))||data.subarray(0,3).equals(Buffer.from([255,216,255]))});}}}
 walk(artifacts,false);for(const dir of [dirname(approved)+'/home/.maestro',dirname(approved)+'/tmp'])walk(dir,true);
 failure.output=buffers.slice(flowBufferStart).join('\n');report.probe=assessArtifactProbe(failure,files);report.probe.scope='task artifact directory and fresh files in pinned wrapper home/tmp; not whole-OS proof';report.probe.warningExercised=false;
 if(!report.probe.ok||report.probeEmailCleared!==true||report.probeActionFailed)fail();report.code='ARTIFACT_PROBE_PASSED';
}

try{
 if(mode==='artifact-probe'&&!artifactProbeApproved()){report.code='ARTIFACT_PROBE_REVIEW_REQUIRED';fail();}
 if(mode==='artifact-probe')report.approvedArtifactPins=true;
 if(!['prepare','run','artifact-probe'].includes(mode)||extra.length||uuid!=='E0C0F689-DBAD-4E8C-85DB-2E7A9CE03452'||!runtimeArg||!wrapperArg||realpathSync(wrapperArg)!==realpathSync(approved))fail();
 runtime=realpathSync(runtimeArg);wrapper=realpathSync(wrapperArg);owner=JSON.parse(readFileSync('/tmp/recovery-native-runtime-owned/owner.json','utf8'));
 report.code='RUNTIME_REFUSED';if(!verifyRuntime(owner,runtime))fail();process.kill(owner.supervisor,0);
 const config=JSON.parse(readFileSync(runtime+'/packages/backend/.convex/local/default/config.json','utf8'));
 if(config.deploymentName!==owner.target.deployment||config.ports.cloud!==3220||config.ports.site!==3221||config.cloudProjectId||!config.adminKey)fail();
 cliEnv={...process.env};for(const k of ['CONVEX_DEPLOYMENT','CONVEX_DEPLOY_KEY','CONVEX_DEPLOYMENT_TOKEN','CONVEX_SELF_HOSTED_URL','CONVEX_SELF_HOSTED_ADMIN_KEY'])delete cliEnv[k];
 cliEnv.CONVEX_SELF_HOSTED_URL=owner.target.url;cliEnv.CONVEX_SELF_HOSTED_ADMIN_KEY=config.adminKey;
 secrets.push(config.adminKey,process.env.WORKOS_API_KEY);
 report.code='ALIGNMENT_REFUSED';const response=await fetch('http://localhost:8082',{headers:{'expo-platform':'ios',accept:'application/expo+json'},signal:AbortSignal.timeout(8000)});if(!response.ok)fail();const u=manifestBundle(await response.json());u.searchParams.set('transform.bytecode','0');const r=await fetch(u,{signal:AbortSignal.timeout(20000)});if(!r.ok)fail();const bundle=await r.text();if(!bundle.includes('http://127.0.0.1:3220')||/https?:\/\/(?:localhost|127\.0\.0\.1):3210\b/.test(bundle)||bundle.includes('walkers-mba.tail7d394.ts.net'))fail();
 report.code='NATIVE_PREFLIGHT_REFUSED';command('/usr/bin/xcrun',['simctl','openurl',uuid,'exp://localhost:8082/--/sign-in']);await wait(1500);let ns=hierarchy();if(!has(ns,'Show password')||input(ns,'Email').a.value!==''||input(ns,'Password').a.value!=='')fail();
 report.prepared=true;report.expires=owner.expires;
 if(mode==='artifact-probe'){await artifactProbe();}
 else if(mode==='prepare'){report.code='PREPARE_READY';}
 else{
  // Review gate is intentionally absent until parent explicitly approves execution.
  report.code='REVIEW_APPROVAL_REQUIRED';if(process.env.RECOVERY_NATIVE_FIXTURE_APPROVED!=='parent-reviewed-run')fail();
  // Pinned Maestro captures screenshots/hierarchy on failed or warned commands.
  // This hard gate must remain until credential-phase artifact suppression is reviewed.
  report.code='CREDENTIAL_ARTIFACT_SAFETY_UNRESOLVED';fail();
  if(!stagingGuard(process.env))fail();
  const {WorkOS}=await import('@workos-inc/node');const {ConvexHttpClient}=await import('convex/browser');const {makeFunctionReference}=await import('convex/server');
  const sdk=new WorkOS(process.env.WORKOS_API_KEY,{clientId:process.env.WORKOS_CLIENT_ID,timeout:10000,maxRetries:0}).userManagement;
  function client(f){return new ConvexHttpClient(owner.target.url,{auth:f.accessToken,logger:false,fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(10000)})});}
  const profile=f=>client(f).query(makeFunctionReference('profiles:getMine'),{});
  const counts=f=>client(f).query(makeFunctionReference('counts:list'),{paginationOpts:{numItems:25,cursor:null}});
  const hooks=fixtureHooks({
   bind:async f=>{envCommand(['set','RECOVERY_FIXTURE_BINDING'],JSON.stringify({subject:f.subject,runId:f.runId,baseUrl:owner.target.url}));},clearBinding:async()=>clearBinding(),profile,counts,
   cleanup:async f=>{const value=await client(f).mutation(makeFunctionReference('fixtureCleanup:cleanup'),{runId:f.runId});report.profileCleanup=value.status;return value;},
   onboard:async f=>{report.native='attempted';paste('Email',f.email,'email');if(input(hierarchy(),'Email').a.value!==f.email)fail();paste('Password',f.password,'password');ns=hierarchy();const password=input(ns,'Password').a.value;if(!has(ns,'Show password')||!/^([•●])+$/.test(password)||password.length!==f.password.length)fail();flow('sign-in','- tapOn: "Sign in"\n');const screen=await loaded();if(!['onboarding','counts'].includes(screen))fail();if(screen==='onboarding'){ns=hierarchy();if(input(ns,'First name').a.value!=='')fail();paste('Display name','Native Fixture','display-name');flow('done','- tapOn: "Done"\n');if(await loaded()!=='counts')fail();}report.native='counts_loaded';},
   capture:async()=>{if(await loaded()!=='counts')fail();flow('hide-keyboard','- hideKeyboard\n');if(await loaded()!=='counts')fail();ns=hierarchy();if(!has(ns,'NO COUNTS YET')||!has(ns,'Create your first Count')||ns.some(a=>/keyboard|alert|dialog/i.test(String(a.type??a.class??'')))||['Save Password?','Show password','LAST STEP'].some(s=>has(ns,s))||ns.some(a=>['Email','Password'].includes(a.accessibilityText)))fail();command('/usr/bin/xcrun',['simctl','io',uuid,'screenshot',artifacts+'/counts.png']);report.screenshot=artifacts+'/counts.png';},
   signout:async()=>{if(await loaded()!=='counts')fail();flow('signout','- tapOn: "You"\n- tapOn: "Sign out"\n- extendedWaitUntil:\n    visible: "Show password|Get started"\n    timeout: 10000\n');if(await loaded()!=='unauthenticated')fail();ns=hierarchy();if(!(has(ns,'Show password')||has(ns,'Get started'))||['You','Counts','LAST STEP','Create your first Count'].some(s=>has(ns,s)))fail();report.signout='confirmed';},
   contain:async()=>{report.signout='failed';command('/usr/bin/xcrun',['simctl','terminate',uuid,'host.exp.Exponent'],8000);report.containment='terminated';}
  });
  report.lifecycle=await smoke(process.env,()=>({
   createUser:async x=>{secrets.push(x.password);const user=await sdk.createUser(x);report.fixtureCreated=true;return user;},
   authenticateWithPassword:async x=>{const auth=await sdk.authenticateWithPassword(x);secrets.push(auth.accessToken,auth.refreshToken);return auth;},
   listSessions:(...x)=>sdk.listSessions(...x),revokeSession:x=>sdk.revokeSession(x),
   deleteUser:async id=>{const outcome=await deleteOwnedProviderUser(sdk,id);report.sessionsVerified=outcome.sessionsVerified;report.providerDelete=outcome.providerDelete;report.userVerified=outcome.userVerified;if(!outcome.ok)fail();}
  }),hooks.cleanup,hooks.exercise);report.code=report.lifecycle.code;
 }
}catch{/* Only allowlisted stage codes cross the output boundary. */}
finally{try{if(uuid==='E0C0F689-DBAD-4E8C-85DB-2E7A9CE03452'&&(mode!=='artifact-probe'||probeStarted))clipboard('');report.clipboard=mode==='artifact-probe'&&!probeStarted?'not_attempted':'cleared';}catch{report.clipboard='clear_failed';}report.scan=scan();if(report.scan.fullMatches||report.scan.fragmentMatches||report.scan.skipped)report.code='SECRET_SCAN_FAILED';report.elapsedSeconds=Math.round((Date.now()-started)/1000);console.log(JSON.stringify(report));process.exitCode=['OK','PREPARE_READY','ARTIFACT_PROBE_PASSED'].includes(report.code)?0:1;}
