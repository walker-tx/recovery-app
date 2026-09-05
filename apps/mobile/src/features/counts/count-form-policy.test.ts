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
