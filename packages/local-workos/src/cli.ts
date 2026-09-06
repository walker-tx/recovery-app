import { isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';
import { startProvider } from './provider.ts';

// The launcher owns configuration and credential persistence. Never accept secrets in argv.
try {
  const { values } = parseArgs({ options: {
    database: { type: 'string' }, port: { type: 'string' },
    'provider-generation': { type: 'string' },
  }, strict: true, allowPositionals: false });
  const apiKey = process.env.LOCAL_WORKOS_API_KEY;
  delete process.env.LOCAL_WORKOS_API_KEY;
  const port = Number(values.port);
  if (!values.database || !isAbsolute(values.database) || !values.port || !/^\d+$/.test(values.port)
    || !Number.isInteger(port) || port < 1 || port > 65535 || !values['provider-generation']
    || !apiKey || !/^sk_test_local_[0-9a-f]{64}$/.test(apiKey)) {
    throw new Error('Invalid bootstrap inputs');
  }
  const provider = await startProvider({ database: values.database, port,
    providerGeneration: values['provider-generation'], apiKey });
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 3000);
    void provider.close().then(() => {
      clearTimeout(deadline);
      process.exit(0);
    }, () => process.exit(1));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.stdout.write(JSON.stringify({ providerGeneration: provider.providerGeneration,
    issuer: provider.issuer, clientId: provider.clientId, port: provider.port }) + '\n');
} catch {
  // Deliberately omit errors/arguments: dependency diagnostics may contain credentials.
  process.stderr.write('Local provider startup failed; check explicit configuration and owned state.\n');
  process.exit(1);
}
