const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createRegistry } = require('./stack-registry.cjs');
const { createRuntime } = require('./stack-runtime.cjs');
async function fixture(t, mode = 'ready') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'status-readiness-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const worktree = path.join(root, 'worktree');
  await fs.mkdir(worktree);
  const registryPath = path.join(root, 'registry');
  const processes = new Map();
  const inspectProcess = async pid => processes.get(pid) ?? null;
  const registry = createRegistry({ registryPath, inspectProcess, portAvailable: async () => true });
  const record = await registry.reserve(worktree);
  const groups = [['mailpitHttp', 'mailpitSmtp'], ['provider'], ['convexCloud', 'convexSite'], ['metro']];
  const daemons = new Map();
  for (const [i, group] of groups.entries()) {
    const identity = { pid: 100 + i, startedAt: 'original', stackId: record.stackId, worktree: record.worktree };
    processes.set(identity.pid, identity);
    await registry.recordProcess(worktree, record.stackId, group, identity);
    daemons.set(`recovery-local/recovery-${record.stackId}-${group[0]}`, identity);
  }
  if (mode === 'split-pair') {
    processes.delete(102);
    const identity = { pid: 200, startedAt: 'other', stackId: record.stackId, worktree: record.worktree };
    processes.set(identity.pid, identity);
    await registry.recordProcess(worktree, record.stackId, 'convexSite', identity);
    processes.set(102, daemons.get(`recovery-local/recovery-${record.stackId}-convexCloud`));
  }
  const probes = [], signals = [], mappings = [];
  const runtime = await createRuntime({
    worktree, registryPath, readinessTimeoutMs: 15,
    inspector: { inspect: inspectProcess, close: async () => {} },
    identity: { inspectProcess, identify: async name => {
      mappings.push(name);
      const original = daemons.get(name);
      if (mode === 'mapping-failed') throw Error('secret mapping detail');
      return mode === 'replacement' ? { ...original, startedAt: 'replacement' } : original;
    } },
    portAvailable: async () => true,
    run: async () => { throw Error('Unexpected effect'); },
    fetchImpl: async (url, { signal }) => {
      probes.push(url); signals.push(signal);
      if (mode === 'timeout') return new Promise(() => {});
      if (mode === 'failed') throw Error('secret response detail');
      return new Response(url.endsWith('/status') ? 'packager-status:running' : url.endsWith('/instance_name') ? 'local-name' : '{}');
    },
    connect: ({ port }) => {
      probes.push(port);
      const socket = new EventEmitter();
      socket.destroy = () => {};
      queueMicrotask(() => port === record.ports.convexSite ? socket.emit('connect') : socket.emit('data', Buffer.from('220 ready\r\n')));
      return socket;
    },
    inherited: new Proxy({}, { get() { throw Error('Unexpected environment read'); } }),
  });
  t.after(() => runtime.close());
  return { runtime, record, probes, signals, mappings, processes };
}
test('status probes verified original daemons once and labels site transport only', async t => {
  const f = await fixture(t);
  const status = await f.runtime.status(f.record.stackId);
  assert.equal(f.probes.length, 6);
  assert.equal(f.mappings.length, 4);
  assert.match(status.guidance, /mise run zero -- --isolated <absolute-backend-executable>/);
  assert.match(status.guidance, /not inferred/);
  for (const service of Object.keys(f.record.ports)) assert.deepEqual(status.readiness[service], {
    state: 'ready', evidence: service === 'convexSite' ? 'transport' : 'protocol',
  });
});
for (const mode of ['replacement', 'mapping-failed']) test(`status leaves ${mode} ownership unprobed`, async t => {
  const f = await fixture(t, mode);
  const status = await f.runtime.status(f.record.stackId);
  assert.equal(f.probes.length, 0);
  assert.match(status.guidance, /Resume refused/);
  assert.doesNotMatch(status.guidance, /mise run zero/);
  assert.ok(Object.values(status.readiness).every(value => value.state === 'unknown'));
});
test('status refuses both endpoints of a split daemon pair', async t => {
  const f = await fixture(t, 'split-pair');
  const status = await f.runtime.status(f.record.stackId);
  assert.equal(f.probes.length, 4);
  assert.deepEqual(status.readiness.convexCloud, { state: 'unknown', reason: 'not-probed' });
  assert.deepEqual(status.readiness.convexSite, { state: 'unknown', reason: 'not-probed' });
});
for (const mode of ['failed', 'timeout']) test(`status sanitizes ${mode} probes without changing ownership state`, async t => {
  const f = await fixture(t, mode);
  const status = await f.runtime.status(f.record.stackId);
  assert.equal(f.probes.length, 6);
  assert.equal(status.services.provider, 'running');
  assert.match(status.guidance, /Resume refused/);
  assert.doesNotMatch(status.guidance, /mise run zero/);
  assert.deepEqual(status.readiness.provider, { state: 'not-ready', reason: 'probe-failed' });
  assert.equal(JSON.stringify(status).includes('secret'), false);
  if (mode === 'timeout') assert.ok(f.signals.every(signal => signal.aborted));
});
test('status never probes stopped or mismatched original processes', async t => {
  const f = await fixture(t);
  f.processes.delete(100);
  f.processes.set(102, { ...f.processes.get(102), startedAt: 'reused-pid' });
  const status = await f.runtime.status(f.record.stackId);
  assert.equal(f.probes.length, 2);
  for (const service of ['mailpitHttp', 'mailpitSmtp', 'convexCloud', 'convexSite']) assert.equal(status.readiness[service].state, 'unknown');
});
