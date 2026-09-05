import assert from 'node:assert/strict';
import test from 'node:test';
import { elapsedParts, latestMilestone, type LargestUnit } from './elapsed-policy.ts';

const ms = Date.parse;
const day = 86_400_000;
const start = ms('2024-01-31T15:42:13.456Z');
const units: LargestUnit[] = ['hours', 'days', 'weeks', 'months', 'years'];
const values = (startMs: number, nowMs: number, unit: LargestUnit) =>
  elapsedParts(startMs, nowMs, unit)?.map(part => part.value);

test('all sequences retain leading/intermediate zeros and truncate seconds', () => {
  const sequences = [
    ['hours', 'minutes'], ['days', 'hours', 'minutes'],
    ['weeks', 'days', 'hours', 'minutes'], ['months', 'days', 'hours', 'minutes'],
    ['years', 'months', 'days', 'hours', 'minutes'],
  ];
  for (const [i, unit] of units.entries()) {
    assert.deepEqual(elapsedParts(start, start + 59_999, unit),
      sequences[i].map(unit => ({ unit, value: 0 })));
    assert.equal(values(start, start + 60_000, unit)?.at(-1), 1);
  }
  assert.deepEqual(values(start, start + 8 * day + 61 * 60_000, 'weeks'), [1, 1, 1, 1]);
  assert.deepEqual(values(start, start + 8 * day + 60_000, 'days'), [8, 0, 1]);
  assert.deepEqual(values(start, start + 8 * day, 'hours'), [192, 0]);
});

test('days and weeks are exact durations across DST and UTC midnight', () => {
  for (const date of ['2024-03-10T06:30:00Z', '2024-11-03T05:30:00Z', '2024-12-31T23:59:00Z']) {
    assert.deepEqual(values(ms(date), ms(date) + day, 'days'), [1, 0, 0]);
    assert.deepEqual(values(ms(date), ms(date) + 7 * day, 'weeks'), [1, 0, 0, 0]);
  }
});

test('months clamp at the original UTC time without accumulating drift', () => {
  assert.deepEqual(values(start, ms('2024-02-29T15:42:13.455Z'), 'months'), [0, 28, 23, 59]);
  assert.deepEqual(values(start, ms('2024-02-29T15:42:13.456Z'), 'months'), [1, 0, 0, 0]);
  assert.deepEqual(values(start, ms('2024-03-30T15:42:13.456Z'), 'months'), [1, 30, 0, 0]);
  assert.deepEqual(values(start, ms('2024-03-31T15:42:13.456Z'), 'months'), [2, 0, 0, 0]);
  assert.deepEqual(values(start, ms('2025-03-31T15:42:13.456Z'), 'months'), [14, 0, 0, 0]);
  assert.deepEqual(values(start, ms('2025-03-31T15:42:13.456Z'), 'years'), [1, 2, 0, 0, 0]);
});

test('leap anniversaries anchor to original day, including years 0..99 and centuries', () => {
  for (const year of ['0000', '0096', '2000', '2024']) {
    const from = ms(`${year}-02-29T12:00:00Z`);
    const next = String(Number(year) + 1).padStart(4, '0');
    assert.deepEqual(values(from, ms(`${next}-02-28T12:00:00Z`), 'years'), [1, 0, 0, 0, 0]);
    assert.deepEqual(values(from, ms(`${next}-03-28T12:00:00Z`), 'years'), [1, 0, 28, 0, 0]);
    assert.deepEqual(values(from, ms(`${next}-03-29T12:00:00Z`), 'years'), [1, 1, 0, 0, 0]);
  }
  assert.deepEqual(values(ms('2096-02-29T00:00:00Z'), ms('2100-02-28T00:00:00Z'), 'years'), [4, 0, 0, 0, 0]);
  assert.deepEqual(values(ms('2024-02-29T00:00:00Z'), ms('2028-02-29T00:00:00Z'), 'years'), [4, 0, 0, 0, 0]);
});

test('only latest milestone, immediately before and at each threshold', () => {
  const thresholds = [
    [start + 30 * day, { unit: 'days', value: 30 }],
    [start + 60 * day, { unit: 'days', value: 60 }],
    [start + 90 * day, { unit: 'days', value: 90 }],
    [ms('2024-07-31T15:42:13.456Z'), { unit: 'months', value: 6 }],
    [ms('2025-01-31T15:42:13.456Z'), { unit: 'years', value: 1 }],
    [ms('2026-01-31T15:42:13.456Z'), { unit: 'years', value: 2 }],
  ] as const;
  for (const [i, [at, milestone]] of thresholds.entries()) {
    assert.deepEqual(latestMilestone(start, at - 1), i === 0 ? null : thresholds[i - 1][1]);
    assert.deepEqual(latestMilestone(start, at), milestone);
  }
  assert.deepEqual(latestMilestone(ms('2023-08-31T23:00:00Z'), ms('2024-02-29T23:00:00Z')), { unit: 'months', value: 6 });
  assert.deepEqual(latestMilestone(ms('2024-02-29T23:00:00Z'), ms('2025-02-28T23:00:00Z')), { unit: 'years', value: 1 });
});

test('invalid timestamps return null; future starts render zeros with no milestone', () => {
  for (const invalid of [NaN, Infinity, -Infinity, 8.64e15 + 1, -8.64e15 - 1]) {
    for (const unit of units) {
      assert.equal(elapsedParts(invalid, start, unit), null);
      assert.equal(elapsedParts(start, invalid, unit), null);
    }
    assert.equal(latestMilestone(invalid, start), null);
    assert.equal(latestMilestone(start, invalid), null);
  }
  for (const unit of units) {
    assert.deepEqual(elapsedParts(start, start - day, unit), elapsedParts(start, start, unit));
  }
  assert.equal(latestMilestone(start, start - day), null);
  assert.deepEqual(values(8.64e15, 8.64e15, 'years'), [0, 0, 0, 0, 0]);
});
