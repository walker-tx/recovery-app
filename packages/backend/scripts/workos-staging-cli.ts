import { readFile, writeFile } from 'node:fs/promises';
import { fingerprint, smoke, stagingGuard } from './workos-staging.ts';

// Enrollment only pins the operator-confirmed pair locally; it proves nothing
// about the WorkOS environment. Never enroll automatically on a smoke run.
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 2 && args[0] === 'enroll' && args[1] === '--confirm-owner-verified-staging-pair') {
    if (!stagingGuard(process.env, false)) throw Error();
    const path = 'mise.local.toml'; // Run from repository root; never accepts a credential/path argument.
    const original = await readFile(path, 'utf8');
    if (!/^\[env\]\s*$/m.test(original)) throw Error();
    // Refuse existing pins: rotation needs an explicit owner-verified config edit.
    if (/WORKOS_STAGING_(KEY_SHA256|CLIENT_ID)/.test(original)) throw Error();
    const binding = `WORKOS_STAGING_KEY_SHA256 = ${JSON.stringify(fingerprint(process.env.WORKOS_API_KEY!))}\nWORKOS_STAGING_CLIENT_ID = ${JSON.stringify(process.env.WORKOS_CLIENT_ID!)}\n`;
    await writeFile(path, original.replace(/^(\[env\]\s*\n)/m, (section) => section + binding), { mode: 0o600 });
    console.log(JSON.stringify({ code: 'LOCAL_BINDING_ENROLLED' }));
    return;
  }
  if (args.length !== 1 || args[0] !== 'run') throw Error();
  const result = await smoke(process.env, async () => {
    const { WorkOS } = await import('@workos-inc/node');
    return new WorkOS(process.env.WORKOS_API_KEY!, { clientId: process.env.WORKOS_CLIENT_ID!, timeout: 10_000, maxRetries: 0 }).userManagement;
  });
  console.log(JSON.stringify(result));
  process.exitCode = result.code === 'OK' && result.cleanup === 'deleted' ? 0 : 1;
}
main().catch(() => { console.log(JSON.stringify({ code: 'CLI_REFUSED' })); process.exitCode = 1; });
