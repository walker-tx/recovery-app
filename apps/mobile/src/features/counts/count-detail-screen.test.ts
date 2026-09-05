import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { countsOfflineNotice } from './count-form-policy.ts';

test('detail notice policy distinguishes loading, cached offline, and reconnected', () => {
  assert.equal(countsOfflineNotice('LoadingFirstPage', false), null);
  assert.equal(countsOfflineNotice('LoadingFirstPage', true), null);
  for (const connected of [true, false, true]) {
    assert.equal(countsOfflineNotice('loaded', connected), connected ? null : 'Offline. Showing last synced Counts.');
  }
});

// Artifact HTML 927–931: font shorthand resets label line-height to normal.
test('detail metadata uses condensed muted labels and a 14px started date', async () => {
  const source = await readFile(new URL('./count-detail-screen.tsx', import.meta.url), 'utf8');
  for (const [label, size, tracking] of [['UNITS', 11, 1.54], ['LATEST MILESTONE', 10, 1.6], ['STARTED', 10, 1.6]]) {
    assert.ok(source.includes(`<Typography variant="overline" className="text-ink-muted" style={{ fontSize: ${size}, fontWeight: '600', letterSpacing: ${tracking}, lineHeight: undefined }}>${label}</Typography>`), String(label));
  }
  assert.ok(source.includes('<Typography style={{ fontSize: 14, lineHeight: 21.7 }}>{formatStarted(count.startAt, true)}</Typography>'));
});

// Source contract only: the native component is not mounted by this Node suite.
test('detail source subscribes before loading return and adds notice alongside cached reading', async () => {
  const source = await readFile(new URL('./count-detail-screen.tsx', import.meta.url), 'utf8');
  const content = source.slice(source.indexOf('function CountDetailContent'));
  const loading = content.indexOf('if (count === undefined) return');
  assert.ok(loading > 0);
  const connection = content.indexOf('const connection = useConvexConnectionState();');
  assert.ok(connection >= 0 && connection < loading, 'connection hook must run on loading and loaded renders');
  const clock = content.indexOf('const now = useCountNow();');
  assert.ok(clock >= 0 && clock < loading);
  assert.ok(content.slice(loading).includes("const offlineNotice = countsOfflineNotice('loaded', connection.isWebSocketConnected);"));
  assert.ok(content.includes('{offlineNotice ? <Typography accessibilityRole="alert">{offlineNotice}</Typography> : null}'));
  assert.ok(content.includes('<CountReading count={count} now={now} size="detail" />'));
  assert.doesNotMatch(content, /if \([^\n]*(?:offlineNotice|isWebSocketConnected)[^\n]*\) return/);
  assert.ok(source.includes('<CountQueryBoundary key={id}'));
});
