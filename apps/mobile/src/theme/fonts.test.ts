import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
test('startup registers only five bundled faces and gates auth until fonts resolve', () => {
  const fonts = read('./fonts.ts');
  assert.equal((fonts.match(/require\(/g) ?? []).length, 5);
  for (const weight of ['400Regular', '500Medium', '600SemiBold', '700Bold']) assert.ok(fonts.includes(`barlow/${weight}/Barlow_${weight}.ttf`));
  assert.ok(fonts.includes('barlow-condensed/600SemiBold/BarlowCondensed_600SemiBold.ttf'));
  assert.doesNotMatch(fonts, /https?:/);
  const layout = read('../app/_layout.tsx');
  assert.match(layout, /useFonts\(fontAssets\)/);
  assert.match(layout, /if \(!fontsLoaded && !fontError\) return null/);
  assert.match(layout, /if \(fontsLoaded \|\| fontError\) void SplashScreen.hideAsync/);
  assert.ok(layout.indexOf('if (!fontsLoaded') < layout.indexOf('if (convexUrl ==='));
});
test('typography selects actual weight files, suppresses synthesis, and retains scaling', () => {
  const source = read('../components/ui/text.tsx');
  assert.match(source, /allowFontScaling/);
  assert.match(source, /StyleSheet.flatten\(style\)/);
  const policy = read("./font-face.ts");
  assert.ok(policy.includes("fontWeight: 'normal'"));
  for (const face of ['body', 'medium', 'semibold', 'bold', 'heading']) assert.ok(policy.includes(`fonts.${face}`));
  assert.match(read('../components/ui/field.tsx'), /font-body/);
});
test('count readings have explicit condensed numeral metrics rather than inherited body leading', () => {
  const source = read('../features/counts/count-presentation.tsx');
  assert.match(source, /variant="heading"/);
  assert.match(source, /lineHeight: fontSize \* 0\.86/);
  assert.match(source, /letterSpacing: fontSize \* -0\.03/);
});

test('registered local assets are TrueType files from OFL-licensed packages', () => {
  const require = createRequire(import.meta.url);
  const paths = [...read('./fonts.ts').matchAll(/require\('([^']+)'\)/g)].map(match => match[1]);
  assert.equal(paths.length, 5);
  for (const path of paths) {
    const bytes = readFileSync(require.resolve(path));
    assert.equal(bytes.readUInt32BE(0), 0x00010000, path);
    assert.ok(bytes.length > 10000);
  }
  for (const pkg of ['barlow', 'barlow-condensed']) {
    const license = readFileSync(require.resolve(`@expo-google-fonts/${pkg}/LICENSE_FONT`), 'utf8');
    assert.match(license, /SIL OPEN FONT LICENSE Version 1.1/);
    assert.equal(read('../../assets/fonts/LICENSE.txt'), license);
  }
});
