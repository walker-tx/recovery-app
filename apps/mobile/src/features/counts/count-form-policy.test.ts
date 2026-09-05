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
