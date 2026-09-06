import {readFileSync, realpathSync, accessSync, constants} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {verifyRuntime, manifestBundle} from './native-fixture.ts';

// Prep-only entry point. Deliberately cannot create fixtures or set server config.
let stage = 'ARGUMENTS';
async function main() {
  const [mode,runtime,wrapper,uuid,...extra] = process.argv.slice(2);
  if (mode !== 'preflight' || !runtime || !wrapper || extra.length || uuid !== 'E0C0F689-DBAD-4E8C-85DB-2E7A9CE03452'
    || realpathSync(wrapper) !== realpathSync('/tmp/maestro-pr3496.F7AlwO/maestro-isolated')) throw Error();
  accessSync(wrapper,constants.X_OK);
  stage = 'RUNTIME';
  const owner = JSON.parse(readFileSync('/tmp/recovery-native-runtime-owned/owner.json','utf8'));
  if (!verifyRuntime(owner,realpathSync(runtime))) throw Error();
  process.kill(owner.supervisor,0);
  stage = 'SIMULATOR';
  const p = spawnSync('/usr/bin/xcrun',['simctl','list','devices','booted','--json'],{encoding:'utf8',timeout:8000,maxBuffer:1000000,env:{PATH:'/usr/bin:/bin:/usr/sbin:/sbin',HOME:process.env.HOME}});
  if (p.status !== 0) throw Error();
  const devices = JSON.parse(p.stdout).devices as Record<string,{udid:string;state:string}[]>;
  if (!Object.values(devices).flat().some(d => d.udid === uuid && d.state === 'Booted')) throw Error();
  stage = 'MANIFEST';
  const response = await fetch('http://localhost:8082',{headers:{'expo-platform':'ios',accept:'application/expo+json'},signal:AbortSignal.timeout(8000)});
  if (!response.ok) throw Error();
  const bundle = manifestBundle(await response.json());
  stage = 'BUNDLE';
  bundle.searchParams.set('transform.bytecode','0');
  const downloaded = await fetch(bundle,{signal:AbortSignal.timeout(20000)});
  if (!downloaded.ok) throw Error();
  const text = await downloaded.text();
  if (!text.includes('http://127.0.0.1:3220') || /https?:\/\/(?:localhost|127\.0\.0\.1):3210\b/.test(text) || text.includes('walkers-mba.tail7d394.ts.net')) throw Error();
  console.log(JSON.stringify({code:'PREFLIGHT_READY',fixtureExecutionEnabled:false,expires:owner.expires,simulatorBooted:true,manifestAndBundleAligned:true,overlayPrepared:false}));
}
main().catch(()=>{console.log(JSON.stringify({code:'PREFLIGHT_REFUSED',stage,fixtureExecutionEnabled:false}));process.exitCode=1;});
