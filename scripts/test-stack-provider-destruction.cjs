const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createRegistry } = require('./stack-registry.cjs');
const { createLifecycle } = require('./stack-lifecycle.cjs');
async function fixture(t) {
  const worktree = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'provider-destruction-')));
  t.after(() => fs.rm(worktree, { recursive: true, force: true }));
  const registry = createRegistry({ registryPath: path.join(worktree, 'registry'), portAvailable: async () => true, inspectProcess: async () => null });
  const record = await registry.reserve(worktree);
  const root = path.join(worktree, '.recovery-stack'), provider = path.join(root, 'provider');
  await fs.mkdir(provider, { recursive: true, mode: 0o700 });
  const marker = JSON.stringify({ stackId: record.stackId, providerGeneration: record.providerGeneration });
  for (const dir of [root, provider]) await fs.writeFile(path.join(dir, '.recovery-stack-owner.json'), marker, { mode: 0o600 });
  for (const file of ['state.sqlite', 'state.sqlite-wal', 'state.sqlite-shm']) await fs.writeFile(path.join(provider, file), 'synthetic', { mode: 0o600 });
  await fs.writeFile(path.join(root, 'mailpit.sqlite'), 'preserve-inbox', { mode: 0o600 });
  let calls = 0;
  const lifecycle = createLifecycle({ registry, run: async () => { calls++; }, identify: async () => null, ready: async () => true });
  const confirmation = { operation: 'destroy-provider-identity', stackId: record.stackId, providerGeneration: record.providerGeneration,
    worktree, affectedDomains: ['provider-data', 'provider-signing-identity'] };
  return { worktree, root, provider, registry, record, lifecycle, confirmation, calls: () => calls };
}
test('confirmed stopped-provider destruction retires startup and preserves other domains and reservation', async t => {
  const f = await fixture(t);
  const result = await f.lifecycle.destroyProvider(f.worktree, f.confirmation);
  assert.equal(result.state, 'complete');
  assert.equal(result.reservationRetained, true);
  assert.equal(result.trustRepairRequired, true);
  assert.deepEqual(await fs.readdir(f.provider), ['.recovery-stack-owner.json']);
  assert.equal(await fs.readFile(path.join(f.root, 'mailpit.sqlite'), 'utf8'), 'preserve-inbox');
  assert.deepEqual(await f.registry.readOwned(f.worktree, f.record.stackId), f.record);
  await assert.rejects(f.lifecycle.start(f.worktree, () => { throw Error('definitions must not run'); }), /retired/);
  assert.equal(f.calls(), 0);
  await assert.rejects(f.lifecycle.destroyProvider(f.worktree, f.confirmation), /retired/);
});
for (const scenario of ['confirmation', 'symlink', 'hardlink', 'unknown-file', 'foreign-marker']) {
  test(`${scenario} blocks without retirement or deletion`, async t => {
    const f = await fixture(t);
    if (scenario === 'confirmation') f.confirmation.affectedDomains = ['provider-data'];
    if (scenario === 'symlink') { await fs.rename(path.join(f.provider, 'state.sqlite'), path.join(f.root, 'saved')); await fs.symlink('../saved', path.join(f.provider, 'state.sqlite')); }
    if (scenario === 'hardlink') await fs.link(path.join(f.provider, 'state.sqlite'), path.join(f.root, 'linked'));
    if (scenario === 'unknown-file') await fs.writeFile(path.join(f.provider, 'unowned'), 'keep');
    if (scenario === 'foreign-marker') await fs.writeFile(path.join(f.provider, '.recovery-stack-owner.json'), '{}');
    await assert.rejects(f.lifecycle.destroyProvider(f.worktree, f.confirmation));
    await fs.lstat(path.join(f.provider, 'state.sqlite'));
    await assert.rejects(fs.lstat(path.join(f.root, 'provider-retirement.json')), { code: 'ENOENT' });
  });
}
test('any retirement entry refuses startup before allocation or preparation', async t => {
  const f = await fixture(t);
  await fs.symlink('missing', path.join(f.root, 'provider-retirement.json'));
  f.registry.reserve = async () => { throw Error('must not allocate'); };
  await assert.rejects(f.lifecycle.start(f.worktree, () => []), /retired/);
});
test('running provider is refused before retirement', async t => {
  const f = await fixture(t), original = f.registry.status;
  f.registry.status = async (...args) => ({ ...await original(...args), services: { provider: 'running' } });
  await assert.rejects(f.lifecycle.destroyProvider(f.worktree, f.confirmation), /stopped/);
  await assert.rejects(fs.lstat(path.join(f.root, 'provider-retirement.json')), { code: 'ENOENT' });
});
test('later unlink failure reports partial outcome and retains retirement and lifecycle exclusion', async t => {
  const f = await fixture(t), unlink = fs.unlink;
  t.mock.method(fs, 'unlink', async file => { if (file.endsWith('-shm')) throw Error('secret-canary'); return unlink(file); });
  const result = await f.lifecycle.destroyProvider(f.worktree, f.confirmation);
  assert.equal(result.state, 'incomplete');
  assert.deepEqual(result.storage, { 'state.sqlite-wal': 'removed', 'state.sqlite-shm': 'uncertain', 'state.sqlite': 'not-attempted' });
  assert.equal(result.lifecycleLockRetained, true);
  assert.ok(!JSON.stringify(result).includes('secret-canary'));
  await fs.lstat(path.join(f.root, 'provider-retirement.json'));
  await assert.rejects(f.lifecycle.start(f.worktree, () => []), /locked/);
});
test('original file replacement after durable intent is not deleted', async t => {
  const f = await fixture(t), readOwned = f.registry.readOwned;
  let observations = 0;
  f.registry.readOwned = async (...args) => {
    const record = await readOwned(...args);
    if (++observations === 4) {
      await fs.rename(path.join(f.provider, 'state.sqlite'), path.join(f.root, 'original'));
      await fs.writeFile(path.join(f.provider, 'state.sqlite'), 'replacement', { mode: 0o600 });
    }
    return record;
  };
  const result = await f.lifecycle.destroyProvider(f.worktree, f.confirmation);
  assert.equal(result.state, 'incomplete');
  assert.ok(Object.values(result.storage).every(state => state === 'not-attempted'));
  assert.equal(await fs.readFile(path.join(f.provider, 'state.sqlite'), 'utf8'), 'replacement');
});
for (const failure of ['write', 'file-sync', 'directory-sync', 'write-and-close']) {
  test(`${failure} failure prevents every unlink and retains exclusion`, async t => {
    const f = await fixture(t), open = fs.open;
    t.mock.method(fs, 'open', async (file, ...args) => {
      const handle = await open(file, ...args);
      if (file === path.join(f.root, 'provider-retirement.json')) return {
        writeFile: ['write', 'write-and-close'].includes(failure) ? async () => { throw Error('failure'); } : handle.writeFile.bind(handle),
        sync: failure === 'file-sync' ? async () => { throw Error('failure'); } : handle.sync.bind(handle),
        close: failure === 'write-and-close' ? async () => { await handle.close(); throw Error('secret-close-canary'); } : handle.close.bind(handle),
      };
      if (file === f.root && failure === 'directory-sync') return { sync: async () => { throw Error('failure'); }, close: handle.close.bind(handle) };
      return handle;
    });
    const result = await f.lifecycle.destroyProvider(f.worktree, f.confirmation);
    assert.equal(result.state, 'incomplete');
    assert.equal(result.lifecycleLockRetained, true);
    assert.ok(!JSON.stringify(result).includes('secret-close-canary'));
    assert.ok(Object.values(result.storage).every(state => state === 'not-attempted'));
    await fs.lstat(path.join(f.provider, 'state.sqlite'));
    await assert.rejects(f.lifecycle.start(f.worktree, () => []), /locked/);
  });
}
