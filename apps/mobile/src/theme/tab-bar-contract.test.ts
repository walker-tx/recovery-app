import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../app/(app)/(tabs)/_layout.tsx', import.meta.url), 'utf8');

test('tabs keep their existing order, titles, and initial destination', () => {
  assert.match(source, /initialRouteName="home"/);
  assert.deepEqual([...source.matchAll(/name="(\w+)" options=\{\{ title: '(\w+)'/g)].map(match => match.slice(1)), [
    ['home', 'Counts'], ['today', 'Today'], ['read', 'Read'], ['you', 'You'],
  ]);
});

test('tab icons preserve the four artifact glyphs and are decorative', () => {
  for (const glyph of ['▤', '☰', '◫', '○']) assert.ok(source.includes(glyph));
  assert.match(source, /tabBarIcon:/);
  assert.match(source, /accessible=\{false\}/);
  assert.doesNotMatch(source, /display: 'none'/);
});

test('labels use condensed reference metrics and visual-only uppercase', () => {
  assert.match(source, /tabBarLabelPosition: 'below-icon'/);
  assert.match(source, /fontFamily: fonts.heading/);
  assert.match(source, /fontSize: 9\.5/);
  assert.match(source, /letterSpacing: 1\.14/);
  assert.match(source, /textTransform: 'uppercase'/);
  assert.match(source, /tabBarActiveTintColor: colors.blueprint/);
  assert.match(source, /tabBarInactiveTintColor: colors.inkMuted/);
});

test('native navigation retains scaling, safe-area sizing, and touch targets', () => {
  assert.match(source, /tabBarAllowFontScaling: true/);
  assert.match(source, /minHeight: 48/);
  assert.doesNotMatch(source, /\bheight:|safeAreaInsets|tabBarButton:|tabBar:\s*\(/);
});
