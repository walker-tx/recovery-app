import assert from 'node:assert/strict';
import test from 'node:test';
import { countNameError, toLocalMidnight, isCountDraftDirty, canSaveCount, duplicateNotice, countsView } from './count-form-policy.ts';

test('names use trimmed Unicode graphemes without truncation', () => {
  assert.equal(countNameError('  '), 'Enter a name.');
  for (const cluster of ['👨‍👩‍👧‍👦', 'e\u0301', '🇺🇸', 'क्‍ष']) {
    assert.equal(countNameError(` ${cluster.repeat(100)} `), null);
    assert.equal(countNameError(cluster.repeat(101)), 'Use 100 characters or fewer.');
  }
});
test('date selection stores local midnight', () => {
  const date = new Date(2026, 3, 12, 14, 42);
  assert.equal(toLocalMidnight(date), new Date(2026, 3, 12).getTime());
});
test('restoring original values removes discard confirmation', () => {
  const initial = { name: '', startAt: null };
  assert.equal(isCountDraftDirty(initial, initial), false);
  assert.equal(isCountDraftDirty({ name: 'a', startAt: null }, initial), true);
  assert.equal(isCountDraftDirty({ name: '', startAt: 0 }, initial), true);
  assert.equal(isCountDraftDirty({ ...initial }, initial), false);
});
test('save requires valid draft, connection and no pending mutation', () => {
  const draft = { name: ' A  B ', startAt: 0 };
  assert.equal(canSaveCount(draft, true, false), true);
  assert.equal(canSaveCount(draft, false, false), false);
  assert.equal(canSaveCount(draft, true, true), false);
  assert.equal(canSaveCount({ ...draft, name: '' }, true, false), false);
  assert.equal(canSaveCount({ ...draft, startAt: null }, true, false), false);
  assert.equal(canSaveCount({ ...draft, startAt: NaN }, true, false), false);
});
test('duplicate notice identifies existing name and date without blocking save', () => {
  assert.equal(duplicateNotice(null), null);
  assert.match(duplicateNotice({ name: 'Coffee', startAt: 0 })!, /Coffee/);
  assert.ok(duplicateNotice({ name: 'Coffee', startAt: 0 })!.includes(new Date(0).toLocaleDateString()));
  assert.equal(canSaveCount({ name: 'Coffee', startAt: 0 }, true, false), true);
});
test('loading never masquerades as empty', () => {
  assert.equal(countsView('LoadingFirstPage', 0), 'loading');
  assert.equal(countsView('Exhausted', 0), 'empty');
  assert.equal(countsView('CanLoadMore', 1), 'populated');
});

test('picker dates preserve chosen calendar days across zones, DST and small years', async () => {
  const { countPickerValue, countPickerStartAt } = await import('./count-form-policy.ts');
  const previousTZ = process.env.TZ;
  try {
    for (const zone of ['America/Chicago', 'Asia/Tokyo', 'Europe/Berlin']) {
      process.env.TZ = zone;
      for (const [year, month, day] of [[2026, 8, 5], [2026, 2, 8], [2026, 10, 1], ...Array.from({ length: 100 }, (_, year) => [year, 8, 5])]) {
        const local = new Date(0);
        local.setFullYear(year, month, day);
        local.setHours(0, 0, 0, 0);
        const utc = new Date(0);
        utc.setUTCFullYear(year, month, day);
        utc.setUTCHours(0, 0, 0, 0);
        assert.equal(countPickerStartAt(utc, 'android', null), local.getTime(), zone);
        assert.equal(countPickerValue(local, 'android').getTime(), utc.getTime(), zone);
        assert.equal(countPickerValue(local, 'ios').getTime(), local.getTime());
        assert.equal(countPickerStartAt(local, 'ios', null), local.getTime());
        const differentDay = new Date(local);
        differentDay.setDate(differentDay.getDate() - 1);
        assert.equal(countPickerStartAt(utc, 'android', differentDay.getTime()), local.getTime());
        assert.equal(countPickerStartAt(local, 'ios', differentDay.getTime()), local.getTime());
        const original = new Date(local);
        original.setHours(15, 37, 42, 123);
        assert.equal(countPickerStartAt(utc, 'android', original.getTime()), original.getTime());
        assert.equal(countPickerStartAt(local, 'ios', original.getTime()), original.getTime());
      }
      assert.equal(countPickerStartAt(new Date(Date.UTC(2026, 8, 5)), 'android', null), new Date(2026, 8, 5).getTime());
    }
  } finally { if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ; }
});

test('offline disclosure follows loaded query state without replacing results', async () => {
  const { countsOfflineNotice } = await import('./count-form-policy.ts');
  assert.equal(countsOfflineNotice('LoadingFirstPage', false), null);
  for (const status of ['Exhausted', 'CanLoadMore', 'LoadingMore']) {
    assert.equal(countsOfflineNotice(status, false), 'Offline. Showing last synced Counts.');
    assert.equal(countsOfflineNotice(status, true), null);
    assert.equal(countsView(status, 2), 'populated');
    assert.equal(countsView(status, 0), 'empty');
  }
});

test('Edit Save requires valid changed values and live connectivity', async () => {
  const { canSaveCountEdit, editCountDraft } = await import('./count-form-policy.ts');
  const original = { name: 'Count', startAt: Date.parse('2026-01-02T05:37:42.123Z') };
  assert.equal(canSaveCountEdit(original, original, true, false), false);
  assert.equal(canSaveCountEdit({ ...original, name: 'Changed' }, original, true, false), true);
  assert.equal(canSaveCountEdit({ ...original, name: '' }, original, true, false), false);
  assert.equal(canSaveCountEdit({ ...original, name: 'Changed' }, original, false, false), false);
  assert.equal(canSaveCountEdit({ ...original, name: 'Changed' }, original, true, true), false);
  const previous = process.env.TZ;
  try {
    process.env.TZ = 'America/Los_Angeles';
    const reverted = editCountDraft({ name: 'Changed', startAt: toLocalMidnight(new Date(original.startAt)) }, original);
    assert.equal(reverted.startAt, original.startAt);
    assert.equal(editCountDraft({ name: 'Changed', startAt: original.startAt + 86400000 }, original).startAt, original.startAt + 86400000);
  } finally { if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous; }
});
test('Edit duplicate lookup excludes itself and skips invalid names', async () => {
  const { countDuplicateArgs } = await import('./count-form-policy.ts');
  assert.deepEqual(countDuplicateArgs(' Count ', 'self'), { name: 'Count', excludeId: 'self' });
  assert.equal(countDuplicateArgs('', 'self'), 'skip');
});
test('Delete holds pending until settlement, prevents repeats and permits failure retry', async () => {
  const { deleteCountOnce } = await import('./count-form-policy.ts');
  const lock = { current: false };
  let resolve!: () => void;
  let calls = 0;
  const remove = () => { calls++; return new Promise<void>(r => { resolve = r; }); };
  assert.equal(await deleteCountOnce(lock, false, remove), 'ignored');
  const first = deleteCountOnce(lock, true, remove);
  assert.equal(lock.current, true);
  assert.equal(await deleteCountOnce(lock, true, remove), 'ignored');
  assert.equal(calls, 1);
  resolve();
  assert.equal(await first, 'deleted');
  assert.equal(lock.current, false);
  assert.equal(await deleteCountOnce(lock, true, async () => { throw Error('failed'); }), 'failed');
  assert.equal(lock.current, false);
  assert.equal(await deleteCountOnce(lock, true, async () => {}), 'deleted');
});
