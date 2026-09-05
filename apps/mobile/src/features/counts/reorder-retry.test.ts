import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { changedPositions, proposedOrder, reorderReducer, restoringLoadedCounts } from './reorder-policy.ts';
const source = readFileSync(new URL('./counts-screen.tsx', import.meta.url), 'utf8');
for (const extent of [50, 125]) test(`partial retry preserves ${extent} loaded Counts and off-page moves`, () => {
  const ids = Array.from({length:extent}, (_, i) => String(i + 1));
  let draft = reorderReducer(null, {type:'enter', ids})!;
  draft = reorderReducer(draft, {type:'move', id:String(extent), to:25})!;
  let dirty = true;
  const moveBody = source.split('  function move(id:string, to:number) {')[1].split('  async function save()')[0].trim().slice(0, -1);
  const move = new Function('draft', 'submitting', 'orderedIds', 'dispatch', 'id', 'to', 'restoring', moveBody);
  for (const count of [25, 30, 0]) {
    const server = ids.slice(0, count);
    const restoring = restoringLoadedCounts('CanLoadMore', count, extent);
    assert.equal(restoring, true);
    const ordered = proposedOrder(server, draft.ids);
    if (!restoring) dirty = changedPositions(server, ordered).length > 0;
    for (const id of ['2', '3']) move(draft, {current:false}, ordered, (event: Parameters<typeof reorderReducer>[1]) => {draft = reorderReducer(draft, event)!;}, id, 0, restoring);
    assert.equal(draft.ids.length, extent);
    assert.equal(draft.ids[25], String(extent));
    assert.equal(dirty, true);
  }
  assert.equal(restoringLoadedCounts('CanLoadMore', extent, extent), false);
  move(draft, {current:false}, proposedOrder(ids, draft.ids), (event: Parameters<typeof reorderReducer>[1]) => {draft = reorderReducer(draft, event)!;}, '2', 0, false);
  assert.equal(draft.ids[0], '2');
  assert.equal(draft.ids[25], String(extent));
  assert.equal(draft.ids.length, extent);
  assert.equal(restoringLoadedCounts('Exhausted', extent - 1, extent), false);
  const saved = proposedOrder(['new', ...ids.filter(id => id !== '49')], draft.ids);
  assert.equal(saved[0], 'new');
  assert.equal(saved.includes('49'), false);
  assert.equal(saved.includes(String(extent)), true);
});
test('owner survives boundary; incomplete retry cannot save or clear discard protection', async () => {
  for (const contract of ['const loadedExtent = useRef(25)', 'loadedExtent={loadedExtent}', 'initialNumItems: Math.min(25, restoreExtent.current)', 'if (!restoring) dirty.current = changed.length > 0', "countsView(restoring ? 'LoadingFirstPage' : status", "if (restoring && status === 'CanLoadMore') loadMore(Math.min(25, restoreExtent.current - results.length))"]) assert.ok(source.includes(contract), contract);
  const body = source.split('  async function save() {')[1].split("  if (view === 'loading')")[0].trim().slice(0, -1).replace(/ as typeof serverIds/g, '');
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  await new AsyncFunction('draft','submitting','restoring','convex', body)({ids:['2','1']}, {current:false}, true, {connectionState:() => assert.fail('retry must not save partial membership')});
});

for (const extent of [125, 150]) {
  test(`retry initial request stays bounded for ${extent} loaded Counts`, () => {
    const expression = source.match(/initialNumItems: ([^}]+) }/)![1];
    const request = new Function('restoreExtent', `return ${expression}`)({current:extent});
    assert.ok(request >= 1 && request <= 25, `initial request was ${request}`);
  });
  test(`short first page restores all ${extent} Counts in bounded requests`, () => {
    const expression = source.split("if (restoring && status === 'CanLoadMore') loadMore(")[1].split(';')[0].slice(0, -1);
    const requestMore = new Function('restoreExtent', 'results', `return ${expression}`);
    let loaded = 20;
    const requests: number[] = [];
    for (let page = 0; page < extent && restoringLoadedCounts('CanLoadMore', loaded, extent); page++) {
      const request = requestMore({current:extent}, {length:loaded});
      assert.ok(request >= 1 && request <= 25, `continuation request was ${request}`);
      requests.push(request);
      loaded += request;
    }
    assert.equal(loaded, extent);
    assert.equal(restoringLoadedCounts('CanLoadMore', loaded, extent), false);
    assert.ok(requests.length > 1);
  });
}
