const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { runCli } = require('./stack-runtime.cjs');
const wrappers = [
  ['zero.sh', 'start', '\n./scripts/migrate-convex-dotenv.sh\n'],
  ['status.sh', 'status', 'STATE_DIR=$ROOT/.recovery-tailnet'],
  ['stop.sh', 'stop', '\n./scripts/check-no-dotenv.sh || exit 1\n'],
  ['zero-tailnet.sh', null, '\n./scripts/migrate-convex-dotenv.sh\n'],
];
async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'isolated dispatch-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'scripts')); await fs.mkdir(path.join(root, 'bin'));
  for (const [file, , boundary] of wrappers) {
    const source = await fs.readFile(path.join(__dirname, file), 'utf8');
    assert.ok(source.includes(boundary), 'legacy boundary required');
    // Execute the real dispatch prefix only. Never execute legacy service/config
    // operations or create dotenv fixtures, even while these tests are red.
    await fs.writeFile(path.join(root, 'scripts', file), source.split(boundary)[0] + "\nprintf 'legacy-boundary\\n'\nexit 23\n", { mode: 0o755 });
  }
  await fs.writeFile(path.join(root, 'bin/node'), `#!${process.execPath}\nprocess.stdout.write(JSON.stringify(process.argv.slice(2))); process.exit(Number(process.env.FIXTURE_EXIT || 0));\n`, { mode: 0o755 });
  const env = { HOME: root, PATH: `${root}/bin:/usr/bin:/bin` };
  const run = (file, args, extra = {}) => spawnSync(path.join(root, 'scripts', file), args, { cwd: root, env, encoding: 'utf8', timeout: 5000, ...extra });
  return { root, env, run };
}
test('existing local entrypoints forward isolated arguments exactly before any legacy work', async t => {
  const f = await fixture(t);
  for (const [file, command] of wrappers.filter(([, command]) => command)) {
    const argument = command === 'start' ? "/tmp/Convex binary 'quoted' $literal;never-execute" : '6c64e416-fd56-4afd-917b-bcebc51d169f';
    const result = f.run(file, ['--isolated', argument]);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [path.join(f.root, 'scripts/stack-runtime.cjs'), command, argument]);
    assert.equal(f.run(file, ['--isolated', argument], { env: { ...f.env, FIXTURE_EXIT: '19' } }).status, 19);
  }
});
test('no-argument entrypoints still reach the unchanged legacy boundary', async t => {
  const f = await fixture(t);
  for (const [file] of wrappers) {
    const result = f.run(file, []);
    assert.equal(result.status, 23, result.stderr);
    assert.equal(result.stdout, 'legacy-boundary\n');
  }
});
test('isolated remote mode is refused without falling through to legacy routes', async t => {
  const f = await fixture(t), result = f.run('zero-tailnet.sh', ['--isolated']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /unavailable/);
  assert.equal(result.stdout, '');
});
test('isolated status requires the selected checkout root, without changing legacy status', async t => {
  const f = await fixture(t), result = f.run('status.sh', ['--isolated', '6c64e416-fd56-4afd-917b-bcebc51d169f'], { cwd: path.dirname(f.root) });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /repository root/);
  assert.equal(f.run('status.sh', [], { cwd: path.dirname(f.root) }).status, 23);
});
test('existing runtime validation rejects unsupported isolated arguments before opening anything', async () => {
  let opened = false;
  for (const args of [['start'], ['start', '--tailnet'], ['start', '/synthetic', '--tailnet'], ['status'], ['stop', 'wrong'], ['stop', '6c64e416-fd56-4afd-917b-bcebc51d169f', 'extra']]) {
    const result = await runCli(args, { open: async () => { opened = true; throw Error('must not open'); }, write: () => {} });
    assert.equal(result, 1);
  }
  assert.equal(opened, false);
});
test('installed Mise forwards isolated flags through the existing task declarations', async t => {
  const f = await fixture(t), config = await fs.readFile(path.join(__dirname, '../mise.toml'), 'utf8');
  const tasks = ['zero', 'status', 'stop', '"zero:tailnet"'].map(task => {
    const header = `[tasks.${task}]`;
    assert.ok(config.includes(header));
    return header + config.split(header)[1].split('\n[')[0];
  });
  await fs.writeFile(path.join(f.root, 'mise.toml'), tasks.join('\n'));
  const mise = execFileSync('which', ['mise'], { encoding: 'utf8' }).trim();
  const env = { ...f.env, XDG_CONFIG_HOME: f.root, XDG_DATA_HOME: f.root, XDG_CACHE_HOME: f.root,
    MISE_TRUSTED_CONFIG_PATHS: f.root, MISE_AUTO_INSTALL: 'false', MISE_NO_ENV: '1', MISE_NO_HOOKS: '1' };
  for (const [task, command, arg] of [['zero', 'start', '/tmp/synthetic backend'], ['status', 'status', '6c64e416-fd56-4afd-917b-bcebc51d169f'], ['stop', 'stop', '6c64e416-fd56-4afd-917b-bcebc51d169f']]) {
    const result = spawnSync(mise, ['run', '--quiet', task, '--', '--isolated', arg], { cwd: f.root, env, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), [path.join(f.root, 'scripts/stack-runtime.cjs'), command, arg]);
  }
  const rejected = spawnSync(mise, ['run', '--quiet', 'zero:tailnet', '--', '--isolated'], { cwd: f.root, env, encoding: 'utf8', timeout: 15000 });
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /unavailable/);
});
