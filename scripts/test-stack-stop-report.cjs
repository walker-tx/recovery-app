const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createLifecycle } = require('./stack-lifecycle.cjs');
const { runCli } = require('./stack-runtime.cjs');
async function fixture(t, fail = false, change = false) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stop-report-'));
  const worktree = await fs.realpath(dir);
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const names = ['metro', 'convexCloud', 'convexSite', 'provider', 'mailpitHttp', 'mailpitSmtp'];
  const record = { stackId: randomUUID(), providerGeneration: randomUUID(), worktree, ports: {}, processes: {} };
  names.forEach((n,i) => { record.ports[n] = 24000+i; record.processes[n] = { pid: i+100, stackId: record.stackId, worktree, startedAt: 'one' }; });
  const states = Object.fromEntries(names.map(n => [n, 'running']));
  const calls = [];
  const registry = { status: async () => ({ ...structuredClone(record), state: 'reserved', services: { ...states } }), readOwned: async () => structuredClone(record) };
  const lifecycle = createLifecycle({ registry, ready: async () => true,
    identify: async name => structuredClone(record.processes[name.split('-').at(-1)]),
    run: async (_cmd, args) => {
      assert.ok((await fs.stat(path.join(worktree, '.recovery-stack-lifecycle.lock'))).isDirectory());
      const service = args[1].split('-').at(-1); calls.push(service);
      if (fail && service === 'convexCloud') throw Error('secret-canary');
      states[service] = 'stopped';
      if (service === 'convexCloud') states.convexSite = 'stopped';
      if (service === 'mailpitHttp') states.mailpitSmtp = 'stopped';
      if (change) record.providerGeneration = randomUUID();
    } });
  return { lifecycle, record, worktree, calls };
}
test('partial stop reports completed, uncertain and unattempted process domains through CLI', async t => {
  const f = await fixture(t, true), output = [];
  const code = await runCli(['stop', f.record.stackId], { open: async () => ({ stop: id => f.lifecycle.stop(f.worktree, id), close: async () => {} }), write: s => output.push(s) });
  assert.equal(code, 1);
  const report = JSON.parse(output[0]);
  assert.equal(report.operation, 'stop-stack-processes');
  assert.equal(report.state, 'incomplete');
  assert.deepEqual(report.processDomains, { metro: 'stopped', convex: 'uncertain', provider: 'not-attempted', inbox: 'not-attempted' });
  assert.equal(report.reservationRetained, true);
  assert.equal(report.lifecycleLockRetained, true);
  assert.ok((await fs.stat(path.join(f.worktree, '.recovery-stack-lifecycle.lock'))).isDirectory());
  assert.ok(!JSON.stringify(report).includes('secret-canary'));
  assert.deepEqual(f.calls, ['metro', 'convexCloud']);
});
test('changed authoritative generation halts the already-started stop sequence', async t => {
  const f = await fixture(t, false, true);
  await assert.rejects(f.lifecycle.stop(f.worktree, f.record.stackId), /ownership/);
  assert.deepEqual(f.calls, ['metro']);
});

test('owned-record inspection never recreates a missing reservation', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'stop-owned-record-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const worktree = path.join(dir, 'worktree');
  await fs.mkdir(worktree);
  const registryPath = path.join(dir, 'registry');
  const { createRegistry } = require('./stack-registry.cjs');
  const registry = createRegistry({ registryPath, portAvailable: async () => true, inspectProcess: async () => null });
  await assert.rejects(registry.readOwned(worktree, randomUUID()), /ownership missing/);
  await assert.rejects(fs.readFile(path.join(registryPath, 'registry.json')), { code: 'ENOENT' });
  const record = await registry.reserve(worktree);
  await assert.rejects(registry.readOwned(worktree, randomUUID()), /ownership mismatch/);
  assert.deepEqual(await registry.readOwned(worktree, record.stackId), record);
});
