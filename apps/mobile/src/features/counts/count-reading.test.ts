import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPart, formatStarted, canSaveUnit, startMinuteClock } from './count-reading.ts';
test('localized numbers, English singulars and zero units', () => {
  assert.equal(formatPart({value: 1234, unit: 'days'}, 'de-DE'), '1.234 days');
  assert.equal(formatPart({value: 1, unit: 'years'}, 'en-US'), '1 year');
  assert.equal(formatPart({value: 0, unit: 'minutes'}, 'en-US'), '0 minutes');
});
test('dates follow requested locale and viewing zone', () => {
  const instant = Date.parse('2024-01-01T01:00:00Z');
  assert.equal(formatStarted(instant, true, 'en-US', 'America/Los_Angeles'), 'Sunday, December 31, 2023');
  assert.equal(formatStarted(instant, false, 'en-GB', 'UTC'), '1 Jan 2024');
});
test('unit saves require changed selection, live connection and no pending save', () => {
  assert.equal(canSaveUnit('days', 'weeks', true, false), true);
  assert.equal(canSaveUnit('days', 'days', true, false), false);
  assert.equal(canSaveUnit('days', 'weeks', false, false), false);
  assert.equal(canSaveUnit('days', 'weeks', true, true), false);
});
test('clock reads actual time on tick and foreground, realigns and cleans up', () => {
  let now = 120010; let callback = () => {}; let delay = 0; let cleared = 0;
  const readings: number[] = [];
  const clock = startMinuteClock((value) => readings.push(value), {
    now: () => now,
    schedule: (fn, ms) => { callback = fn; delay = ms; return 1; },
    cancel: () => { cleared++; },
  });
  assert.deepEqual(readings, [120010]); assert.equal(delay, 59990);
  now = 245012; callback(); assert.equal(readings.at(-1), now); assert.equal(delay, 54988);
  now = 901000; clock.refresh(); assert.equal(readings.at(-1), now); assert.equal(delay, 59000);
  clock.stop(); assert.ok(cleared >= 2);
  const count = readings.length; callback(); assert.equal(readings.length, count);
});

test('route contracts retain pagination, shared clock, retry and persisted-unit guards', async () => {
  const { readFile } = await import('node:fs/promises');
  const read = (name: string) => readFile(new URL(name, import.meta.url), 'utf8');
  const list = await read('./counts-screen.tsx');
  assert.match(list, /usePaginatedQuery\(api.counts.list/);
  assert.match(list, /loadMore\(25\)/);
  assert.match(list, /CountRow/);
  const units = await read('./count-units-screen.tsx');
  assert.match(units, /convex.connectionState\(\).isWebSocketConnected/);
  assert.match(units, /await setUnit\(\{ id: count._id, unit: selected \}\)/);
  assert.match(units, /usePreventRemove\(pending/);
  assert.doesNotMatch(units, /setTimeout|Promise.race|optimistic/i);
  const detail = await read('./count-detail-screen.tsx');
  assert.match(detail, /milestone \? <View/);
  assert.match(detail, /formatStarted\(count.startAt, true\)/);
  const clock = await read('./count-clock.tsx');
  assert.match(clock, /state === 'active'\) clock.refresh/);
  assert.match(clock, /subscription.remove\(\); clock.stop\(\)/);
});
