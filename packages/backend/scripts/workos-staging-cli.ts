import { smoke } from './workos-staging.ts';

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== 'run') throw Error();
  const result = await smoke(process.env, async () => {
    const { WorkOS } = await import('@workos-inc/node');
    return new WorkOS(process.env.WORKOS_API_KEY!, { clientId: process.env.WORKOS_CLIENT_ID!, timeout: 10_000, maxRetries: 0 }).userManagement;
  });
  console.log(JSON.stringify(result));
  process.exitCode = result.code === 'OK' && result.cleanup === 'deleted' ? 0 : 1;
}
main().catch(() => { console.log(JSON.stringify({ code: 'CLI_REFUSED' })); process.exitCode = 1; });
