import type { AppCleanup, FixtureExercise } from './workos-staging.ts';

// Pure policy and lifecycle ordering. No SDK authentication wrapper performs UI work.
export function verifyRuntime(value: unknown, runtime: string, now = Date.now()): boolean {
  const o = value as {path?: unknown; state?: unknown; expires?: string; target?: {deployment?: unknown; url?: unknown; site?: unknown}} | null;
  return !!o && o.path === runtime && o.state === 'ready' && Date.parse(o.expires ?? '') > now
    && o.target?.deployment === 'anonymous-agent' && o.target.url === 'http://127.0.0.1:3220'
    && o.target.site === 'http://127.0.0.1:3221';
}
type Node = {attributes?: Record<string, unknown>; children?: Node[]};
export function nativeState(root: Node) {
  const fields: {label: string; empty: boolean; masked: boolean; length: number; bounds: string | null}[] = [];
  const labels = new Set<string>();
  let keyboard = false;
  function walk(n: Node) {
    const a = n.attributes ?? {};
    for (const key of ['text','accessibilityText']) if (typeof a[key] === 'string') labels.add(a[key]);
    if (/keyboard/i.test(String(a.type ?? a.class ?? ''))) keyboard = true;
    if ((a.accessibilityText === 'Email' || a.accessibilityText === 'Password') && typeof a.value === 'string') {
      fields.push({label:a.accessibilityText,empty:a.value === '',masked:/^[•●]+$/.test(a.value),length:a.value.length,bounds:typeof a.bounds === 'string' && /^\[\d+,\d+\]\[\d+,\d+\]$/.test(a.bounds) ? a.bounds : null});
    }
    for (const child of n.children ?? []) walk(child);
  }
  walk(root);
  const password = fields.filter(f => f.label === 'Password');
  const email = fields.filter(f => f.label === 'Email');
  const savePassword = labels.has('Save Password?');
  const loadedCounts = labels.has('NO COUNTS YET') && labels.has('Create your first Count');
  return {inputsUnambiguous:email.length === 1 && password.length === 1 && fields.every(f => f.bounds !== null),fieldsEmpty:fields.length === 2 && fields.every(f => f.empty),passwordMasked:password.length === 1 && password[0]!.masked,passwordLength:password.length === 1 ? password[0]!.length : null,savePassword,onboarding:labels.has('LAST STEP'),loadedCounts,keyboard,screenshotSafe:loadedCounts && !savePassword && !keyboard && fields.length === 0};
}
type Fixture = Parameters<FixtureExercise>[0];
type CleanupFixture = Parameters<AppCleanup>[0];
// Concrete adapters MUST abort and settle requests, not Promise.race an ongoing write.
// Native onboard owns fresh hierarchy/bounds, clipboard-only input and prompt loop.
export type FixtureAdapters = {
  bind(f: CleanupFixture): Promise<void>;
  clearBinding(): Promise<void>;
  profile(f: CleanupFixture): Promise<unknown>;
  counts(f: CleanupFixture): Promise<{page: unknown[]; isDone: boolean}>;
  cleanup(f: CleanupFixture): Promise<{status: 'absent'}>;
  onboard(f: Fixture): Promise<void>;
  capture(): Promise<void>;
  signout(): Promise<void>;
  contain(): Promise<void>;
};
function refuse(): never { throw new Error('NATIVE_FIXTURE_REFUSED'); }
export function fixtureHooks(a: FixtureAdapters): {exercise: FixtureExercise; cleanup: AppCleanup} {
  let nativeAttempted = false;
  async function verifyAbsent(f: CleanupFixture) {
    // Both independent checks must run and settle even if either fails.
    const [profile,counts] = await Promise.allSettled([a.profile(f),a.counts(f)]);
    if (profile.status !== 'fulfilled' || profile.value !== null || counts.status !== 'fulfilled'
      || counts.value.page.length !== 0 || !counts.value.isDone) refuse();
  }
  const exercise: FixtureExercise = async f => {
    await a.bind(f);
    if (await a.profile(f) !== null) refuse();
    if ((await a.cleanup(f)).status !== 'absent') refuse();
    await verifyAbsent(f);
    nativeAttempted = true; // Set before native work: failure may already have created a profile.
    await a.onboard(f);
    const profile = await a.profile(f) as {displayName?:unknown; firstName?:unknown; onboardingComplete?:unknown} | null;
    const counts = await a.counts(f);
    if (profile?.displayName !== 'Native Fixture' || profile.firstName !== undefined || profile.onboardingComplete !== true || counts.page.length !== 0 || !counts.isDone) refuse();
    await a.capture();
  };
  const cleanup: AppCleanup = async f => {
    let signoutFailed = false;
    try {
      if (nativeAttempted) {
        try { await a.signout(); } catch { signoutFailed = true; try { await a.contain(); } catch { /* Still clean owned backend state. */ } }
      }
      if ((await a.cleanup(f)).status !== 'absent') refuse();
      await verifyAbsent(f);
      if (signoutFailed) refuse(); // Containment is never reported as signout.
      return {status:'absent'};
    } finally { await a.clearBinding(); }
  };
  return {exercise,cleanup};
}

export function manifestBundle(m: unknown): URL {
 const manifest = m as {extra?:{expoClient?:{sdkVersion?:string}};launchAsset?:{url?:string}};
 const u = new URL(manifest.launchAsset?.url ?? '');
 if(manifest.extra?.expoClient?.sdkVersion !== '57.0.0' || u.protocol !== 'http:' || u.hostname !== 'localhost' || u.port !== '8082' || u.username || u.password) refuse();
 return u;
}

// The caller supplies the SDK's bounded, no-retry methods. All three outcomes are
// independent: failed verification must never prevent deletion of the owned user.
export async function deleteOwnedProviderUser(sdk: {
 listSessions(id:string,options:{limit:number;after?:string}):Promise<{data:{userId:string;status:string}[];listMetadata:{after?:string|null}}>;
 deleteUser(id:string):Promise<unknown>;
 getUser(id:string):Promise<unknown>;
}, id:string) {
 const result: {sessionsVerified:'failed'|'inactive';providerDelete:'failed'|'deleted';userVerified:'failed'|'absent';ok:boolean} = {sessionsVerified:'failed',providerDelete:'failed',userVerified:'failed',ok:false};
 try {
  let after:string|undefined;const seen=new Set<string>();let exhausted=false;
  for(let page=0;page<3;page++) {
   const sessions=await sdk.listSessions(id,{limit:10,after});
   if(sessions.data.length>10||sessions.data.some(s=>s.userId!==id||!['expired','revoked'].includes(s.status)))refuse();
   const next=sessions.listMetadata.after;
   if(!next){exhausted=true;break;}
   if(seen.has(next))refuse();seen.add(next);after=next;
  }
  if(!exhausted)refuse();result.sessionsVerified='inactive';
 }catch{/* Sanitized independent outcome; proceed with owned deletion. */}
 try {await sdk.deleteUser(id);result.providerDelete='deleted';}catch{/* Verify independently even after transport failure. */}
 try {await sdk.getUser(id);}catch(e){if(typeof e==='object'&&e!==null&&'status' in e&&e.status===404)result.userVerified='absent';}
 result.ok=result.sessionsVerified==='inactive'&&result.providerDelete==='deleted'&&result.userVerified==='absent';
 return result;
}

type NativeScreen = 'onboarding'|'counts'|'unauthenticated'|'save-password'|'unknown';
// Fresh hierarchy on every iteration; two continuous seconds without a prompt.
// Read/dismiss implementations must themselves have bounded, settling timeouts.
export async function settleNativeScreen(a:{read():Promise<NativeScreen>;dismiss():Promise<void>;wait(ms:number):Promise<void>;now():number}):Promise<'onboarding'|'counts'|'unauthenticated'> {
 const deadline=a.now()+12000;let candidate:NativeScreen='unknown';let since=0;
 while(a.now()<deadline) {
  const screen=await a.read();
  if(a.now()>=deadline)break;
  if(screen==='save-password') {candidate='unknown';await a.dismiss();}
  else if(screen==='unknown')candidate='unknown';
  else {
   if(screen!==candidate){candidate=screen;since=a.now();}
   else if(a.now()-since>=2000)return screen;
  }
  if(a.now()>=deadline)break;
  await a.wait(Math.min(500,deadline-a.now()));
 }
 return refuse();
}

export const artifactCanary = 'native-artifact-canary@example.org';
export const artifactMissingSelector = 'RECOVERY_ARTIFACT_PROBE_MISSING_SELECTOR';
export function assessArtifactProbe(failure:{status:number|null;output:string;junit:string},files:{path:string;text:string;image?:boolean}[]) {
 const observed=failure.status===1&&/<failure\b/.test(failure.junit)&&failure.output.includes(artifactMissingSelector);
 const imageOrHierarchyFiles=files.filter(f=>f.image||/\.(png|jpe?g)$/i.test(f.path)||/hierarchy|screenshot/i.test(f.path)).length;
 const canaryMatches=files.filter(f=>f.text.includes(artifactCanary)).length+Number(failure.output.includes(artifactCanary))+Number(failure.junit.includes(artifactCanary));
 return {intentionalFailureObserved:observed,imageOrHierarchyFiles,canaryMatches,ok:observed&&imageOrHierarchyFiles===0&&canaryMatches===0};
}
