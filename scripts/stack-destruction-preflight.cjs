// Read-only checkpoint, not teardown authorization. Never call registry.status:
// its transaction creates a lock. No seed/configuration/credential reads here.
const fs = require('node:fs');
const path = require('node:path');
const names = ['convexCloud', 'convexSite', 'metro', 'provider', 'mailpitHttp', 'mailpitSmtp'];
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const absolute = value => typeof value === 'string' && !value.includes('\0') && path.isAbsolute(value) && path.normalize(value) === value;
function inspect(file, privateMode, directory) {
  const st = fs.lstatSync(file);
  if (st.isSymbolicLink() || st.uid !== process.getuid() ||
      (st.mode & (privateMode ? 0o077 : 0o022)) !== 0 ||
      (directory ? !st.isDirectory() : !st.isFile() || st.nlink !== 1)) throw Error();
  return st;
}
function ancestors(base, destination) {
  inspect(base, false, true);
  let current = base;
  for (const part of path.relative(base, destination).split(path.sep)) {
    current = path.join(current, part);
    inspect(current, current === destination, true);
  }
}
// Conservative observation limits, not a wall-clock guarantee for filesystem I/O.
function contents(dir, budget, depth = 0) {
  if (depth > 32) throw Error();
  const entries = fs.opendirSync(dir);
  try {
    let entry;
    while ((entry = entries.readSync()) !== null) {
      if (--budget.remaining < 0) throw Error();
      const file = path.join(dir, entry.name), st = fs.lstatSync(file);
      inspect(file, true, st.isDirectory());
      if (st.isDirectory()) contents(file, budget, depth + 1);
    }
  } finally { entries.closeSync(); }
}
async function preflightDestruction({ worktree, registryPath, target, confirmation, inspectProcess, portAvailable, timeoutMs = 2000 } = {}) {
  const blockers = [];
  const block = (code, domain) => blockers.push({ code, domain });
  const result = { readyForTeardown: false, confirmationAccepted: false, destructionImplemented: false,
    reservationReleaseAllowed: false, blockers, affectedDomains: [] };
  let record;
  try {
    if (!absolute(worktree) || fs.realpathSync(worktree) !== worktree ||
        !target || target.worktree !== worktree || !uuid(target.stackId) ||
        !uuid(target.providerGeneration) || target.stackId === target.providerGeneration) throw Error();
    const st = inspect(worktree, false, true);
    if (!absolute(registryPath) || fs.realpathSync(registryPath) !== registryPath) throw Error();
    inspect(registryPath, true, true);
    const file = path.join(registryPath, 'registry.json');
    if (inspect(file, true, false).size > 1024 * 1024) throw Error();
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    record = data.stacks?.[worktree];
    if (data.version !== 1 || !record || record.stackId !== target.stackId ||
        record.providerGeneration !== target.providerGeneration || record.worktree !== worktree ||
        record.owner !== `${st.dev}:${st.ino}` || !record.processes ||
        !record.ports || Object.keys(record.ports).length !== names.length ||
        !names.every(n => Number.isSafeInteger(record.ports[n]) && record.ports[n] > 0 && record.ports[n] <= 65535) ||
        new Set(Object.values(record.ports)).size !== names.length ||
        Object.keys(record.processes).some(n => !names.includes(n))) throw Error();
  } catch { block('target-mismatch', 'reservation'); return result; }
  const root = path.join(worktree, '.recovery-stack');
  const backend = path.join(worktree, 'packages/backend/.convex/local/default');
  result.target = { stackId: record.stackId, providerGeneration: record.providerGeneration, worktree };
  result.affectedDomains = [
    { domain: 'provider', path: path.join(root, 'provider') },
    { domain: 'convex', path: backend },
    { domain: 'inbox', paths: ['mailpit.sqlite', 'mailpit.sqlite-wal', 'mailpit.sqlite-shm'].map(n => path.join(root,n)) },
    { domain: 'stack-metadata', path: root },
    { domain: 'routes', scope: 'whole-stack' },
    { domain: 'reservation', stackId: record.stackId },
  ];
  // Confirmation names the precise identity and every affected domain. It is
  // not a capability: no saved preflight/confirmation can authorize deletion.
  result.requiredConfirmation = { operation: 'destroy-worktree-stack', ...result.target,
    affectedDomains: result.affectedDomains.map(({ domain }) => domain) };
  const expected = result.requiredConfirmation;
  result.confirmationAccepted = Boolean(confirmation &&
    confirmation.operation === expected.operation &&
    confirmation.stackId === expected.stackId &&
    confirmation.providerGeneration === expected.providerGeneration &&
    confirmation.worktree === expected.worktree &&
    Array.isArray(confirmation.affectedDomains) &&
    confirmation.affectedDomains.length === expected.affectedDomains.length &&
    new Set(confirmation.affectedDomains).size === expected.affectedDomains.length &&
    confirmation.affectedDomains.every(domain => expected.affectedDomains.includes(domain)));
  if (!result.confirmationAccepted) block(confirmation == null ? 'confirmation-required' : 'confirmation-mismatch', 'confirmation');
  for (const [file, code] of [[path.join(worktree, '.recovery-stack-lifecycle.lock'), 'lifecycle-locked'], [path.join(registryPath,'lock'), 'registry-locked']]) {
    try { fs.lstatSync(file); block(code, 'coordination'); }
    catch (e) { if (e.code !== 'ENOENT') block(code, 'coordination'); }
  }
  try {
    const marker = JSON.stringify({ stackId: record.stackId, providerGeneration: record.providerGeneration });
    for (const dir of [backend, root, path.join(root,'provider')]) {
      ancestors(worktree, dir);
      const file = path.join(dir, '.recovery-stack-owner.json');
      if (inspect(file, true, false).size > 4096) throw Error();
      if (fs.readFileSync(file, 'utf8') !== marker) throw Error();
    }
    const budget = { remaining: 10000 };
    contents(backend, budget); contents(root, budget);
  } catch { block('unsafe-state', 'filesystem'); }
  // One total budget for asynchronous evidence; adapters must remain read-only.
  const deadline = Date.now() + (Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 2000);
  async function observe(read) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw Error();
    let timer;
    try {
      return await Promise.race([Promise.resolve().then(read), new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error()), remaining);
      })]);
    } finally { clearTimeout(timer); }
  }
  for (const service of names) {
    const identity = record.processes[service];
    try {
      if (typeof inspectProcess !== 'function') throw Error();
      if (identity !== undefined && (!identity || !Number.isSafeInteger(identity.pid) || identity.pid <= 0 ||
          typeof identity.startedAt !== 'string' || !identity.startedAt.trim() ||
          identity.stackId !== record.stackId || identity.worktree !== worktree ||
          await observe(() => inspectProcess(identity.pid)) !== null)) throw Error();
    } catch { block('process-not-stopped', service); }
    try {
      if (typeof portAvailable !== 'function') throw Error();
      const available = await observe(() => portAvailable(record.ports[service]));
      if (available === false) block('port-not-free', service);
      else if (available !== true) block('ports-unknown', service);
    } catch { block('ports-unknown', service); }
  }
  // The reviewed #49 semantic contract (PR59, 704deb999003388bae82c040b698966a98ce8f61)
  // requires complete authoritative inventory and coordinated retirement proof.
  // Legacy target/absent tuples cannot establish either. No production evidence
  // implementation is authorized yet; do not freeze a speculative adapter schema
  // or let fixture claims establish readiness. Keep this boundary closed.
  block('routes-unknown', 'routes');
  result.readyForTeardown = blockers.length === 0;
  // Observations are not an atomic authorization. A future teardown must recheck
  // under coordination and release the reservation only after complete teardown.
  return result;
}
module.exports = { preflightDestruction };
