import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Structural contracts only: Node does not mount Expo UI or simulate React recovery.
test('Android overflow source controls native expansion, dismissal, selection and pending', async () => {
  const source = await readFile(new URL('./count-overflow.android.tsx', import.meta.url), 'utf8');
  for (const contract of ['useState(false)', 'useEffect(() => { if (disabled) setExpanded(false); }, [disabled])', 'expanded={expanded && !disabled}', 'onDismissRequest={() => setExpanded(false)}', '<Button enabled={!disabled} onClick={() => setExpanded(true)}><Text>More actions</Text></Button>']) {
    assert.ok(source.includes(contract), contract);
  }
  for (const action of ['onEdit', 'onDelete']) {
    assert.ok(source.includes(`onClick={() => { setExpanded(false); if (!disabled) ${action}(); }}`));
  }
});

test('edit source owns initialized draft and guard above replaceable get-query subtree', async () => {
  const source = await readFile(new URL('./edit-count-screen.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('<EditCountForm key={id} id={id} />'));
  const owner = source.slice(source.indexOf('function EditCountForm'));
  assert.ok(owner.indexOf('usePreventRemove(') < owner.indexOf('<CountQueryBoundary'));
  for (const contract of ['setOriginal((previous) => previous ?? count)', 'setDraft((previous) => previous ?? count)', '<LoadedEditCount id={id} onInitialize={initialize}>', 'editCountDraft(next, original)', 'await edit({ id, name: draft.name.trim(), startAt: draft.startAt! })']) {
    assert.ok(owner.includes(contract), contract);
  }
  const query = source.slice(source.indexOf('function LoadedEditCount'), source.indexOf('function EditCountForm'));
  assert.ok(query.includes('useQuery(api.counts.get, { id })'));
  assert.ok(query.includes('count === undefined ?'));
  assert.ok(query.includes(': children'));
  assert.doesNotMatch(query, /catch|useState/);
  assert.ok(source.includes('countDuplicateArgs(name, id)'));
});
