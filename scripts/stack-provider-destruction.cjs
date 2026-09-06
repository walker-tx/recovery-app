// Stopped-provider filesystem lifecycle only; no provider protocol or route effects.
const fs = require('node:fs/promises');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const retirementName = 'provider-retirement.json';
const markerName = '.recovery-stack-owner.json';
const files = ['state.sqlite-wal', 'state.sqlite-shm', 'state.sqlite'];
async function assertProviderNotRetired(worktree) {
  try { await fs.lstat(path.join(worktree, '.recovery-stack', retirementName)); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  throw Error('Provider retired; deliberate trust re-pairing and ownership reconciliation required');
}
async function inspect(file, directory = false) {
  const st = await fs.lstat(file);
  if (st.isSymbolicLink() || st.uid !== process.getuid() || (st.mode & 0o077) !== 0 ||
      (directory ? !st.isDirectory() : !st.isFile() || st.nlink !== 1)) throw Error('Unsafe provider state');
  return { dev: st.dev, ino: st.ino, mode: st.mode, size: st.size };
}
async function syncDirectory(dir) {
  const handle = await fs.open(dir, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function destroyProvider({ worktree, confirmation, readOwned, status }) {
  await assertProviderNotRetired(worktree);
  const record = await readOwned(confirmation?.stackId);
  const target = { stackId: record.stackId, providerGeneration: record.providerGeneration, worktree };
  if (!confirmation || confirmation.operation !== 'destroy-provider-identity' ||
      !Object.entries(target).every(([key, value]) => confirmation[key] === value) ||
      !Array.isArray(confirmation.affectedDomains) || confirmation.affectedDomains.length !== 2 ||
      !['provider-data', 'provider-signing-identity'].every(domain => confirmation.affectedDomains.includes(domain)))
    throw Error('Provider destruction confirmation mismatch');
  const verify = async () => {
    if (!isDeepStrictEqual(await readOwned(record.stackId), record)) throw Error('Provider ownership changed');
    const current = await status();
    if (!Object.entries(target).every(([key, value]) => current[key] === value) ||
        !isDeepStrictEqual(current.ports, record.ports) || current.state === 'conflict' ||
        current.services.provider !== 'stopped') throw Error('Provider must remain stopped and owned');
  };
  await verify();
  const root = path.join(worktree, '.recovery-stack'), provider = path.join(root, 'provider');
  const marker = JSON.stringify({ stackId: record.stackId, providerGeneration: record.providerGeneration });
  const owned = new Map();
  for (const dir of [root, provider]) {
    owned.set(dir, await inspect(dir, true));
    const file = path.join(dir, markerName), st = await inspect(file);
    if (st.size > 4096 || await fs.readFile(file, 'utf8') !== marker) throw Error('Provider marker mismatch');
    owned.set(file, st);
  }
  const entries = await fs.readdir(provider);
  if (!entries.includes('state.sqlite') || entries.some(file => ![...files, markerName].includes(file)))
    throw Error('Provider storage inventory unknown');
  const selected = files.filter(file => entries.includes(file));
  for (const file of selected) owned.set(path.join(provider, file), await inspect(path.join(provider, file)));
  const checkFiles = async () => {
    const expected = [markerName, ...selected.filter(file => owned.has(path.join(provider, file)))].sort();
    if (!isDeepStrictEqual((await fs.readdir(provider)).sort(), expected)) throw Error('Provider inventory changed');
    for (const [file, original] of owned) {
      const observed = await inspect(file, file === root || file === provider);
      // Directory size changes as our retirement marker/files change; inode/mode do not.
      if (observed.dev !== original.dev || observed.ino !== original.ino || observed.mode !== original.mode ||
          (file !== root && file !== provider && observed.size !== original.size)) throw Error('Provider storage identity changed');
    }
    for (const dir of [root, provider]) if (await fs.readFile(path.join(dir, markerName), 'utf8') !== marker) throw Error('Provider marker changed');
  };
  await checkFiles();
  await verify();
  const report = { operation: 'destroy-provider-identity', ...target, state: 'incomplete',
    reservationRetained: true, trustRepairRequired: true, lifecycleLockRetained: true, retirement: 'uncertain',
    storage: Object.fromEntries(selected.map(file => [file, 'not-attempted'])) };
  // Exclusive durable intent survives crashes/partial unlink. Never remove it here,
  // never retry by inferring success from absence, and never rotate registry trust.
  let intent;
  try {
    intent = await fs.open(path.join(root, retirementName), 'wx', 0o600);
    await intent.writeFile(JSON.stringify({ version: 1, operation: report.operation, ...target }));
    await intent.sync();
    await intent.close(); intent = undefined;
    await syncDirectory(root);
    owned.set(path.join(root, retirementName), await inspect(path.join(root, retirementName)));
    report.retirement = 'recorded';
    for (const file of selected) {
      await verify();
      await checkFiles();
      report.storage[file] = 'uncertain';
      await fs.unlink(path.join(provider, file));
      owned.delete(path.join(provider, file));
      await syncDirectory(provider);
      report.storage[file] = 'removed';
    }
    await verify();
    await checkFiles();
    report.state = 'complete';
    report.lifecycleLockRetained = false;
  } catch {
    // No raw filesystem/provider/adapter errors escape partial-outcome reporting.
    // The intent (including malformed/partial content) continues to block startup.
  } finally {
    // A cleanup failure must not replace the sanitized incomplete report or
    // release exclusion after an uncertain intent write.
    if (intent) { try { await intent.close(); } catch { /* retain incomplete report */ } }
  }
  return report;
}
module.exports = { assertProviderNotRetired, destroyProvider };
