import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('./counts-screen.tsx', import.meta.url), 'utf8');
const empty = source.slice(source.indexOf("if (view === 'empty'"), source.indexOf('return <ScrollView ref={scroll}'));

test('empty Counts uses the shared landing header without vertically centering the page', () => {
  assert.match(empty, /<CountsHeader \/>/);
  assert.doesNotMatch(empty, /justifyContent/);
  assert.match(source, /fontSize:30, lineHeight:31\.5, fontWeight:'600'/);
});
test('empty plate has four decorative registration marks and reference spacing', () => {
  assert.match(empty, /paddingVertical:22, paddingHorizontal:18, gap:11/);
  assert.match(empty, /\['top', 'bottom'\]/);
  assert.match(empty, /\['left', 'right'\]/);
  assert.match(empty, /pointerEvents="none" accessible=\{false\}/);
  assert.match(empty, /fontSize:26, lineHeight:28\.6/);
  assert.match(empty, /fontSize:13\.5, lineHeight:20\.925/);
});
test('private multiplicity note stays outside the plate and does not promise sharing', () => {
  assert.match(empty, /<\/View>\s*<Typography[^>]+>Your Counts are private to you\. Create as many as you like\.<\/Typography>/);
  assert.doesNotMatch(empty, /unless you share|text-center/);
  assert.equal((empty.match(/<Button /g) ?? []).length, 1);
  assert.match(empty, /router\.push\('\/\(app\)\/counts\/new'\)/);
});
