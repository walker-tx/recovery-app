import { it } from '@effect/vitest';
import { Effect } from 'effect';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile, readFile, readdir, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { WorkOS } from '@workos-inc/node';
import { acquireProvider } from '../src/provider.ts';
const require = createRequire(import.meta.url);
const { createRegistry } = require('../../../scripts/stack-registry.cjs');
const { createLifecycle } = require('../../../scripts/stack-lifecycle.cjs');
// Narrow compile-time views of the existing untyped CJS test boundary, not a new wire schema.
type Reservation = { stackId: string; providerGeneration: string; ports: { provider: number } };
type Destruction = { state: string; retirement: string; storage: Record<string, string>; trustRepairRequired: boolean };
const apiKey = `sk_test_local_${'ac'.repeat(32)}`;

it.live('destroys real stopped provider SQL/signing storage, refuses old-stack startup, preserves sibling and other domains', () => Effect.gen(function* () {
  const dir = yield* Effect.acquireRelease(
    Effect.promise(async () => realpath(await mkdtemp(join(tmpdir(), 'provider-destruction-integration-')))),
    dir => Effect.promise(() => rm(dir, { recursive: true, force: true })),
  );
  const worktree = join(dir, 'selected'), sibling = join(dir, 'sibling');
  yield* Effect.promise(async () => { await mkdir(worktree, { mode: 0o700 }); await mkdir(sibling, { mode: 0o700 }); });
  // Real port observation. No process adapter invents a stopped/live process identity.
  const registry = createRegistry({ registryPath: join(dir, 'registry'), inspectProcess: async () => null });
  const record = yield* Effect.promise<Reservation>(() => registry.reserve(worktree));
  const other = yield* Effect.promise<Reservation>(() => registry.reserve(sibling));
  const root = join(worktree, '.recovery-stack'), providerDir = join(root, 'provider');
  const database = join(providerDir, 'state.sqlite');
  const confirmation = { operation: 'destroy-provider-identity', worktree, stackId: record.stackId,
    providerGeneration: record.providerGeneration, affectedDomains: ['provider-data', 'provider-signing-identity'] };
  yield* Effect.promise(async () => {
    await mkdir(providerDir, { recursive: true, mode: 0o700 });
    const marker = JSON.stringify({ stackId: record.stackId, providerGeneration: record.providerGeneration });
    for (const target of [root, providerDir]) await writeFile(join(target, '.recovery-stack-owner.json'), marker, { mode: 0o600 });
  });
  const preserved = [join(root, 'mailpit.sqlite'), join(worktree, 'convex-fixture.sqlite'), join(root, 'synthetic-admin-seed'), join(dir, 'synthetic-device-state')];
  yield* Effect.promise(async () => { for (const file of preserved) await writeFile(file, 'owned-preserved-fixture', { mode: 0o600 }); });
  const snapshots = yield* Effect.promise(async () => Promise.all(preserved.map(async file => ({ file, bytes: await readFile(file), inode: (await lstat(file)).ino }))));
  const siblingProvider = yield* acquireProvider({ database: join(sibling, 'state.sqlite'), port: other.ports.provider, apiKey, providerGeneration: other.providerGeneration });
  const siblingUser = yield* siblingProvider.createIdentityFixture({ email: 'sibling@example.test', provider: 'GoogleOAuth' });
  const siblingSdk = new WorkOS(apiKey, { apiHostname: '127.0.0.1', port: siblingProvider.port, https: false });
  let prepared = false, commands = 0;
  const lifecycle = createLifecycle({ registry, run: async () => { commands++; }, identify: async () => null,
    ready: async () => true, prepare: async () => { prepared = true; } });
  // Closing this nested acquisition scope closes the actual HTTP listener and SQL
  // resource before the real filesystem lifecycle is allowed to remove storage.
  yield* Effect.scoped(Effect.gen(function* () {
    const provider = yield* acquireProvider({ database, port: record.ports.provider, apiKey, providerGeneration: record.providerGeneration });
    const sdk = new WorkOS(apiKey, { apiHostname: '127.0.0.1', port: provider.port, https: false });
    const user = yield* Effect.promise(() => sdk.userManagement.createUser({ email: 'destroy@example.test', password: 'Synthetic-password-42', emailVerified: true }));
    yield* Effect.promise(() => sdk.userManagement.authenticateWithPassword({ clientId: provider.clientId, email: user.email, password: 'Synthetic-password-42' }));
    const db = yield* Effect.acquireRelease(Effect.sync(() => new DatabaseSync(database, { readOnly: true })), db => Effect.sync(() => db.close()));
    const saved = JSON.parse(String(db.prepare('SELECT body FROM instance WHERE id=1').get()?.body));
    assert.equal(saved.generation, record.providerGeneration);
    // Check presence without printing, hashing, or returning private signing material.
    assert.equal(typeof saved.privateKey.d, 'string');
    assert.equal(saved.publicKey.kty, 'RSA');
    assert.equal(db.prepare('SELECT count(*) AS n FROM users').get()?.n, 1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get()?.n, 1);
    yield* Effect.promise(() => assert.rejects(lifecycle.destroyProvider(worktree, confirmation), /stopped/));
    yield* Effect.promise(() => assert.rejects(lstat(join(root, 'provider-retirement.json')), { code: 'ENOENT' }));
  }));
  assert.equal((yield* Effect.promise<{ services: { provider: string } }>(() => registry.status(worktree))).services.provider, 'stopped');
  const outcome = yield* Effect.promise<Destruction>(() => lifecycle.destroyProvider(worktree, confirmation));
  assert.equal(outcome.state, 'complete');
  assert.equal(outcome.retirement, 'recorded');
  assert.equal(outcome.storage['state.sqlite'], 'removed');
  assert.equal(outcome.trustRepairRequired, true);
  assert.deepEqual(yield* Effect.promise(() => readdir(providerDir)), ['.recovery-stack-owner.json']);
  // Read-only open cannot accidentally recreate the deleted SQL/signing store.
  assert.throws(() => new DatabaseSync(database, { readOnly: true }));
  const reserve = registry.reserve;
  registry.reserve = () => { throw Error('must not allocate retired identity'); };
  yield* Effect.promise(() => assert.rejects(lifecycle.start(worktree, () => []), /retired/));
  registry.reserve = reserve;
  assert.equal(prepared, false);
  assert.equal(commands, 0);
  yield* Effect.promise(() => assert.rejects(lstat(database), { code: 'ENOENT' }));
  assert.deepEqual(yield* Effect.promise(() => registry.readOwned(worktree, record.stackId)), record);
  for (const snapshot of snapshots) {
    assert.deepEqual(yield* Effect.promise(() => readFile(snapshot.file)), snapshot.bytes);
    assert.equal((yield* Effect.promise(() => lstat(snapshot.file))).ino, snapshot.inode);
  }
  assert.equal((yield* Effect.promise(() => siblingSdk.userManagement.getUser(siblingUser.id))).id, siblingUser.id);
  assert.deepEqual(yield* Effect.promise(() => registry.readOwned(sibling, other.stackId)), other);
}));
