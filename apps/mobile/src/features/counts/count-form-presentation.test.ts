import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
const read = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
for (const [file, title, policy] of [ ['new-count-screen.tsx', 'New Count', 'canSaveCount'], ['edit-count-screen.tsx', 'Edit Count', 'canSaveCountEdit'] ]) {
  test(`${title} reuses inline header with screen-owned save and guarded back`, () => {
    const source = read(file!);
    assert.ok(source.includes(`<CountFormHeader title="${title}"`));
    for (const contract of ['cancelDisabled={pending || saved}', `saveDisabled={saved || !${policy}(`, 'onCancel={() => router.back()} onSave={() => void save()}', 'usePreventRemove(!saved', 'navigation.dispatch(data.action)', 'contentContainerStyle={{ paddingHorizontal: 20 }}']) assert.ok(source.includes(contract), contract);
    assert.ok(!source.includes('variant="display"'));
  });
}
test('inline header has flexible centered title and accessible text actions', () => {
  const source = read('count-form-header.tsx');
  for (const contract of ["fontSize: 12, fontWeight: '600', letterSpacing: 1.68, textTransform: 'uppercase', textAlign: 'center'", 'accessibilityState={{ disabled: saveDisabled, busy: pending }}', 'accessibilityState={{ disabled: cancelDisabled }}']) assert.ok(source.includes(contract), contract);
  assert.equal(source.split('flex: 1, minWidth: 48, minHeight: 48').length - 1, 2);
  assert.doesNotMatch(source, /numberOfLines|\bheight:/);
});
test('date field has left alignment and decorative disclosure while retaining native picker policy', () => {
  const source = read('count-form.tsx');
  for (const contract of ['<Pressable accessibilityRole="button" disabled={disabled}', 'minHeight: 48', "textAlign: 'left'", 'accessibilityElementsHidden importantForAccessibility="no">›', 'maximumDate={new Date()}', "countPickerStartAt(pickerDate, 'ios', draft.startAt)", 'countPickerStartAt(date, Platform.OS, draft.startAt)']) assert.ok(source.includes(contract), contract);
});
