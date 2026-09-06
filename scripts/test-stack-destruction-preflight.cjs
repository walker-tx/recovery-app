const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { preflightDestruction } = require('./stack-destruction-preflight.cjs');
const names = ['convexCloud', 'convexSite', 'metro', 'provider', 'mailpitHttp', 'mailpitSmtp'];
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'destroy-preflight-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const worktree = path.join(root, 'selected');
  fs.mkdirSync(worktree, { mode: 0o700 });
  const st = fs.statSync(worktree);
  const record = { stackId: randomUUID(), providerGeneration: randomUUID(), worktree,
    owner: `${st.dev}:${st.ino}`, ports: Object.fromEntries(names.map((n,i) => [n,24000+i])), processes: {} };
  const registryPath = path.join(root, 'registry');
  fs.mkdirSync(registryPath, { mode: 0o700 });
  const save = () => fs.writeFileSync(path.join(registryPath, 'registry.json'), JSON.stringify({ version: 1, stacks: { [worktree]: record } }), { mode: 0o600 });
  save();
  for (const relative of ['packages/backend/.convex/local/default', '.recovery-stack', '.recovery-stack/provider']) {
    const dir = path.join(worktree, relative);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(dir, '.recovery-stack-owner.json'), JSON.stringify({ stackId: record.stackId, providerGeneration: record.providerGeneration }), { mode: 0o600 });
  }
  fs.mkdirSync(path.join(root, 'sibling'), { mode: 0o700 });
  fs.writeFileSync(path.join(root, 'sibling/keep'), 'untouched');
  const target = { stackId: record.stackId, providerGeneration: record.providerGeneration, worktree };
  const confirmation = { operation: 'destroy-worktree-stack', ...target, affectedDomains: ['provider', 'convex', 'inbox', 'stack-metadata', 'routes', 'reservation'] };
  const options = { registryPath, worktree, target, confirmation, inspectProcess: async () => null, portAvailable: async () => true,
    routeEvidence: async () => ({ ...target, state: 'absent', scope: 'whole-stack' }) };
  return { root, worktree, record, options, save };
}
test('unsupported route callback is never consumed as authoritative evidence', async t => {
  const f = fixture(t);
  let called = false;
  f.options.routeEvidence = () => { called = true; throw Error('unsupported proof'); };
  const result = await preflightDestruction(f.options);
  assert.equal(called, false);
  assert.equal(result.confirmationAccepted, true);
  assert.equal(result.readyForTeardown, false);
  assert.deepEqual(result.blockers, [{ code: 'routes-unknown', domain: 'routes' }]);
});
function snapshot(root) {
  return fs.readdirSync(root).sort().flatMap(name => {
    const file = path.join(root,name), st = fs.lstatSync(file);
    return [[file, st.mode, st.ino, st.nlink, st.mtimeMs, st.isFile() ? fs.readFileSync(file).toString('hex') : null], ...(st.isDirectory() ? snapshot(file) : [])];
  });
}
test('legacy absent-route tuple cannot establish contract-ready teardown or mutate state', async t => {
  const f = fixture(t), before = snapshot(f.root);
  const result = await preflightDestruction(f.options);
  assert.deepEqual(result.blockers, [{ code: 'routes-unknown', domain: 'routes' }]);
  assert.equal(result.readyForTeardown, false);
  assert.equal(result.destructionImplemented, false);
  assert.equal(result.reservationReleaseAllowed, false);
  assert.deepEqual(result.affectedDomains.map(x => x.domain), ['provider', 'convex', 'inbox', 'stack-metadata', 'routes', 'reservation']);
  assert.deepEqual(snapshot(f.root), before);
});
for (const [name, change, code] of [
  ['wrong worktree', f => { f.options.target.worktree = path.join(f.root, 'sibling'); }, 'target-mismatch'],
  ['missing marker', f => fs.unlinkSync(path.join(f.worktree,'.recovery-stack/.recovery-stack-owner.json')), 'unsafe-state'],
  ['marker symlink', f => { const marker = path.join(f.worktree,'.recovery-stack/.recovery-stack-owner.json'); fs.renameSync(marker, marker + '.saved'); fs.symlinkSync(marker + '.saved', marker); }, 'unsafe-state'],
  ['marker hardlink', f => { const marker = path.join(f.worktree,'.recovery-stack/.recovery-stack-owner.json'); fs.linkSync(marker, marker + '.linked'); }, 'unsafe-state'],
  ['public marker', f => fs.chmodSync(path.join(f.worktree,'.recovery-stack/.recovery-stack-owner.json'),0o644), 'unsafe-state'],
  ['registry lock', f => fs.mkdirSync(path.join(f.options.registryPath,'lock')), 'registry-locked'],
  ['name-only process', f => { f.record.processes.provider = { name: 'provider' }; f.save(); }, 'process-not-stopped'],
  ['wrong UUID', f => { f.options.target.stackId = randomUUID(); }, 'target-mismatch'],
  ['wrong generation', f => { f.options.target.providerGeneration = randomUUID(); }, 'target-mismatch'],
  ['wrong marker', f => fs.writeFileSync(path.join(f.worktree,'.recovery-stack/.recovery-stack-owner.json'),'secret-canary'), 'unsafe-state'],
  ['symlink', f => fs.symlinkSync('../provider',path.join(f.worktree,'.recovery-stack/link')), 'unsafe-state'],
  ['hardlink', f => fs.linkSync(path.join(f.root,'sibling/keep'),path.join(f.worktree,'.recovery-stack/link')), 'unsafe-state'],
  ['unsafe ancestor', f => fs.chmodSync(path.join(f.worktree,'packages'),0o777), 'unsafe-state'],
  ['held lock', f => fs.mkdirSync(path.join(f.worktree,'.recovery-stack-lifecycle.lock')), 'lifecycle-locked'],
  ['occupied port', f => { f.options.portAvailable = async () => false; }, 'port-not-free'],
  ['process mismatch', f => { f.record.processes.provider = { pid: 123, startedAt: 'one', stackId: f.record.stackId, worktree: f.worktree }; f.save(); f.options.inspectProcess = async () => ({ pid: 123, startedAt: 'two' }); }, 'process-not-stopped'],
  ['unknown routes', f => { delete f.options.routeEvidence; }, 'routes-unknown'],
  ['foreign route evidence', f => { f.options.routeEvidence = async () => ({ ...f.options.target, stackId: randomUUID(), state: 'absent', scope: 'whole-stack' }); }, 'routes-unknown'],
]) test(name, async t => {
  const f = fixture(t); change(f); const before = snapshot(f.root);
  const result = await preflightDestruction(f.options);
  assert.equal(result.readyForTeardown,false);
  assert.ok(result.blockers.some(b => b.code === code), JSON.stringify(result));
  assert.ok(!JSON.stringify(result).includes('secret-canary'));
  assert.deepEqual(snapshot(f.root),before);
});
test('runtime selected-stack hook stays read-only and fails closed without route proof', async t => {

  const f = fixture(t);
  const { createRuntime } = require('./stack-runtime.cjs');
  const forbidden = () => { throw Error('unexpected effect'); };
  const runtime = await createRuntime({ worktree: f.worktree, registryPath: f.options.registryPath,
    inherited: new Proxy({}, { get: forbidden, has: forbidden }),
    inspector: { inspect: async () => null, close: async () => {} },
    identity: { identify: forbidden, inspectProcess: async () => null },
    run: forbidden, fetchImpl: forbidden, connect: forbidden, portAvailable: async () => true });
  const before = snapshot(f.root);
  const result = await runtime.destructionPreflight(f.options.target, f.options.confirmation);
  assert.deepEqual(result.blockers, [{ code: 'routes-unknown', domain: 'routes' }]);
  assert.equal(result.readyForTeardown, false);
  assert.deepEqual(snapshot(f.root), before);
  await runtime.close();
});

test('missing port observer reports unknown evidence, not occupied ports', async t => {
  const f = fixture(t);
  delete f.options.portAvailable;
  const result = await preflightDestruction(f.options);
  assert.deepEqual(result.blockers, [...names.map(domain => ({ code: 'ports-unknown', domain })), { code: 'routes-unknown', domain: 'routes' }]);
  assert.equal(result.destructionImplemented, false);
  assert.equal(result.reservationReleaseAllowed, false);
});
for (const adapter of ['inspectProcess', 'portAvailable']) {
  test(`bounded evidence collection when ${adapter} never resolves`, async t => {
    const f = fixture(t);
    f.record.processes.provider = { pid: 123, startedAt: 'one', stackId: f.record.stackId, worktree: f.worktree };
    f.save();
    f.options[adapter] = () => new Promise(() => {});
    f.options.timeoutMs = 20;
    let timer;
    const result = await Promise.race([preflightDestruction(f.options), new Promise(resolve => { timer = setTimeout(() => resolve(null), 300); })]);
    clearTimeout(timer);
    assert.notEqual(result, null, 'preflight must return before watchdog');
    assert.equal(result.readyForTeardown, false);
    assert.equal(result.destructionImplemented, false);
    assert.equal(result.reservationReleaseAllowed, false);
  });
}

test('runtime defaults to the existing port observer when omitted', async t => {
  const f = fixture(t);
  const { createRuntime } = require('./stack-runtime.cjs');
  const runtime = await createRuntime({ worktree: f.worktree, registryPath: f.options.registryPath,
    inspector: { inspect: async () => null, close: async () => {} },
    identity: { identify: async () => null, inspectProcess: async () => null } });
  t.after(() => runtime.close());
  const result = await runtime.destructionPreflight(f.options.target, f.options.confirmation);
  assert.equal(result.blockers.some(b => b.code === 'ports-unknown'), false);
  assert.ok(result.blockers.some(b => b.code === 'routes-unknown'));
});

for (const domain of ['registry', 'marker', 'depth']) {
  test(`oversized ${domain} evidence fails closed`, async t => {
    const f = fixture(t);
    if (domain === 'registry') fs.appendFileSync(path.join(f.options.registryPath, 'registry.json'), ' '.repeat(1024 * 1024));
    else if (domain === 'marker') fs.appendFileSync(path.join(f.worktree, '.recovery-stack/.recovery-stack-owner.json'), ' '.repeat(4096));
    else fs.mkdirSync(path.join(f.worktree, '.recovery-stack', ...Array(34).fill('nested')), { recursive: true, mode: 0o700 });
    const result = await preflightDestruction(f.options);
    assert.equal(result.readyForTeardown, false);
    assert.ok(result.blockers.some(b => b.code === (domain === 'registry' ? 'target-mismatch' : 'unsafe-state')));
  });
}

for (const [name, change] of [
  ['missing', f => { delete f.options.confirmation; }],
  ['wrong operation', f => { f.options.confirmation.operation = 'stop'; }],
  ['wrong stack', f => { f.options.confirmation.stackId = randomUUID(); }],
  ['stale generation', f => { f.options.confirmation.providerGeneration = randomUUID(); }],
  ['sibling worktree', f => { f.options.confirmation.worktree = path.join(f.root, 'sibling'); }],
  ['missing inbox', f => { f.options.confirmation.affectedDomains.splice(2, 1); }],
  ['duplicate domain', f => { f.options.confirmation.affectedDomains[2] = 'provider'; }],
  ['extra device deletion', f => { f.options.confirmation.affectedDomains.push('device-storage'); }],
  ['malformed domains', f => { f.options.confirmation.affectedDomains = 'all'; }],
]) test(`confirmation rejects ${name} without authorizing any effects`, async t => {
  const f = fixture(t); change(f); const before = snapshot(f.root);
  const result = await preflightDestruction(f.options);
  assert.equal(result.confirmationAccepted, false);
  assert.equal(result.readyForTeardown, false);
  assert.ok(result.blockers.some(b => b.domain === 'confirmation'));
  assert.equal(result.destructionImplemented, false);
  assert.equal(result.reservationReleaseAllowed, false);
  assert.deepEqual(snapshot(f.root), before);
});
test('exact confirmation accepts reordered domains but never bypasses missing routes', async t => {
  const f = fixture(t);
  f.options.confirmation.affectedDomains.reverse();
  delete f.options.routeEvidence;
  const result = await preflightDestruction(f.options);
  assert.equal(result.confirmationAccepted, true);
  assert.deepEqual(result.requiredConfirmation, { operation: 'destroy-worktree-stack', ...f.options.target,
    affectedDomains: ['provider', 'convex', 'inbox', 'stack-metadata', 'routes', 'reservation'] });
  assert.deepEqual(result.blockers, [{ code: 'routes-unknown', domain: 'routes' }]);
  assert.equal(result.readyForTeardown, false);
  assert.equal(result.destructionImplemented, false);
  assert.equal(result.reservationReleaseAllowed, false);
});

for (const changed of ['generation', 'process', 'routes']) {
  test(`reusing accepted confirmation still reobserves changed ${changed}`, async t => {
    const f = fixture(t);
    const first = await preflightDestruction(f.options);
    assert.equal(first.confirmationAccepted, true);
    assert.equal(first.readyForTeardown, false);
    if (changed === 'generation') {
      f.record.providerGeneration = randomUUID();
      f.save();
    } else if (changed === 'process') {
      f.record.processes.provider = { pid: 123, startedAt: 'new', stackId: f.record.stackId, worktree: f.worktree };
      f.save();
      f.options.inspectProcess = async () => f.record.processes.provider;
    } else delete f.options.routeEvidence;
    const before = snapshot(f.root);
    const result = await preflightDestruction(f.options);
    assert.equal(result.readyForTeardown, false);
    assert.ok(result.blockers.some(b => b.code === ({ generation: 'target-mismatch', process: 'process-not-stopped', routes: 'routes-unknown' })[changed]));
    assert.equal(result.destructionImplemented, false);
    assert.equal(result.reservationReleaseAllowed, false);
    assert.deepEqual(snapshot(f.root), before);
  });
}
