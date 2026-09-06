import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { test } from 'node:test';

const key = 'sk_test_local_' + 'a'.repeat(64);
function launch(args: string[], credential = key) {
  const child = spawn(process.execPath, ['--experimental-strip-types', new URL('../src/cli.ts', import.meta.url).pathname, ...args], {
    env: { PATH: process.env.PATH, LOCAL_WORKOS_API_KEY: credential }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const deadline = setTimeout(() => child.kill('SIGKILL'), 10000);
  const exited = new Promise<number | null>(resolve => child.on('close', code => { clearTimeout(deadline); resolve(code); }));
  const ready = new Promise<Record<string, any>>((resolve, reject) => {
    child.stdout.on('data', () => { if (stdout.includes('\n')) { try { resolve(JSON.parse(stdout.split('\n')[0]!)); } catch (e) { reject(e); } } });
    child.on('close', () => reject(new Error('Exited before readiness')));
  });
  void ready.catch(() => {});
  return { child, exited, ready, output: () => stdout + stderr };
}

test('CLI emits authoritative readiness, persists identity, and handles signals', { timeout: 25000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'local-workos-cli-'));
  const reservation = createServer();
  await new Promise<void>(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const generation = randomUUID();
  const args = ['--database', join(dir, 'provider.sqlite'), '--port', String(port), '--provider-generation', generation];
  try {
    for (const signal of ['SIGTERM', 'SIGINT'] as const) {
      const p = launch(args);
      try {
        const ready = await p.ready;
        assert.deepEqual(Object.keys(ready).sort(), ['clientId', 'issuer', 'port', 'providerGeneration']);
        assert.equal(ready.providerGeneration, generation);
        assert.equal(ready.port, port);
        assert.equal(ready.issuer, `https://local-workos.invalid/instances/${generation}`);
        assert.equal((await fetch(`http://127.0.0.1:${port}/sso/jwks/${ready.clientId}`)).status, 200);
        p.child.kill(signal);
        assert.equal(await p.exited, 0);
        assert.ok(!p.output().includes(key));
      } finally { p.child.kill('SIGKILL'); await p.exited; }
    }
    // A real-shaped WorkOS test key must never be accepted by the local CLI.
    const wrongCredential = launch(args, 'sk_test_real_provider_fixture');
    const rejected = await Promise.race([wrongCredential.exited, wrongCredential.ready.then(async () => {
      wrongCredential.child.kill('SIGTERM');
      return wrongCredential.exited;
    })]);
    assert.equal(rejected, 1);
    const mismatch = launch([...args.slice(0, -1), randomUUID()]);
    assert.equal(await mismatch.exited, 1);
    assert.ok(!mismatch.output().includes(key));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('CLI rejects absent secrets and invalid arguments without echoing inputs', async () => {
  for (const [args, credential] of [[[], key], [['--api-key', key], key], [['--database', '/unused', '--port', '0', '--provider-generation', randomUUID()], key], [['--database', '/unused', '--port', '12345', '--provider-generation', randomUUID()], '']] as const) {
    const p = launch([...args], credential);
    assert.equal(await p.exited, 1);
    assert.ok(!p.output().includes(key));
    assert.ok(!p.output().includes('providerGeneration'));
  }
});
