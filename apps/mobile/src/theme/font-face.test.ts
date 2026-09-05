import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolveFontFace } from './font-face.ts';

test('explicit regular overrides the label default', () => {
  for (const fontWeight of [400, '400', 'normal'] as const) {
    assert.deepEqual(resolveFontFace({ fontWeight }, false, true), {fontFamily:'Barlow_400Regular', fontWeight:'normal'});
  }
});
test('numeric weights and RN aliases select the same real face', () => {
  for (const [weights, family] of [
    [[500, '500', 'medium'], 'Barlow_500Medium'],
    [[600, '600', 'semibold'], 'Barlow_600SemiBold'],
    [[700, '700', 'bold'], 'Barlow_700Bold'],
  ] as const) for (const fontWeight of weights) {
    assert.deepEqual(resolveFontFace({fontWeight}, false), {fontFamily:family, fontWeight:'normal'});
  }
});
test('caller family and weight win even for heading variants', () => {
  assert.deepEqual(resolveFontFace({fontFamily:'Custom', fontWeight:'600'}, true), {fontFamily:'Custom', fontWeight:'600'});
  assert.deepEqual(resolveFontFace({fontFamily:'Custom'}, false), {fontFamily:'Custom', fontWeight:undefined});
});
test('defaults remain body regular, label bold, and condensed heading semibold', () => {
  assert.equal(resolveFontFace({}, false).fontFamily, 'Barlow_400Regular');
  assert.equal(resolveFontFace({}, false, true).fontFamily, 'Barlow_700Bold');
  assert.equal(resolveFontFace({}, true).fontFamily, 'BarlowCondensed_600SemiBold');
});
test('className resolves through standard cssInterop before the face policy', () => {
  const source = readFileSync(new URL('../components/ui/text.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('cssInterop(ResolvedTypography, { className: "style" })'));
  assert.ok(source.includes('resolveFontFace(StyleSheet.flatten(style) ?? {}'));
  assert.ok(source.includes('<InteropTypography'));
});
