import assert from 'node:assert/strict';
import test from 'node:test';
import { moveCount, proposedOrder, changedPositions, reorderReducer, dragTarget, edgeScroll } from './reorder-policy.ts';
test('moves first, middle and last; boundaries and pending are inert', () => {
  assert.deepEqual(moveCount(['a','b','c'], 'a', 2), ['b','c','a']);
  assert.deepEqual(moveCount(['a','b','c'], 'b', 0), ['b','a','c']);
  assert.deepEqual(moveCount(['a','b','c'], 'c', 0), ['c','a','b']);
  assert.deepEqual(moveCount(['a','b'], 'a', -1), ['a','b']);
  assert.deepEqual(moveCount(['a','b'], 'b', 2), ['a','b']);
  assert.deepEqual(moveCount(['a','b'], 'a', 1, true), ['a','b']);
});
test('cancel, reverted order, pending repeats, and failure retention', () => {
  const draft = { ids: ['b','a'], pending: false, error: false };
  assert.equal(reorderReducer(draft, {type:'cancel'}), null);
  assert.deepEqual(changedPositions(['a','b'], moveCount(draft.ids, 'a', 0)), []);
  const saving = reorderReducer(draft, {type:'save'})!;
  assert.deepEqual(reorderReducer(saving, {type:'move', id:'b', to:1}), saving);
  assert.deepEqual(reorderReducer(saving, {type:'save'}), saving);
  assert.deepEqual(reorderReducer(saving, {type:'cancel'}), saving);
  assert.deepEqual(reorderReducer(saving, {type:'failure'}), {...draft, error:true});
  assert.equal(reorderReducer(saving, {type:'success'}), null);
});
test('new and loaded IDs retain server positions; deleted IDs never return', () => {
  assert.deepEqual(proposedOrder(['new','a','c','more'], ['c','deleted','a']), ['new','c','a','more']);
  assert.deepEqual(changedPositions(['new','a','b','more'], ['new','b','a','more']), ['b','a']);
  const ids = Array.from({length:600}, (_,i) => String(i));
  assert.equal(proposedOrder(ids, ids).length, 600);
  assert.equal(changedPositions(ids, [...ids].reverse()).length, 600);
});
test('drag hit testing and autoscroll use measured variable-height rows', () => {
  const rows = [{id:'a',y:0,height:80}, {id:'b',y:80,height:140}, {id:'c',y:220,height:90}];
  assert.equal(dragTarget(rows, 150), 1);
  assert.equal(dragTarget(rows, -30), 0);
  assert.equal(dragTarget(rows, 900), 2);
  assert.equal(edgeScroll(10, 0, 500), -12);
  assert.equal(edgeScroll(490, 0, 500), 12);
  assert.equal(edgeScroll(250, 0, 500), 0);
});

// Execute the actual screen save handler with captured dependencies; no native mount.
test('Done submits full displayed order, unchanged and above 256, retaining failed drafts', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./counts-screen.tsx', import.meta.url), 'utf8');
  const marker = '  async function save() {';
  const body = source.slice(source.indexOf(marker) + marker.length, source.indexOf("  if (view === 'loading')"));
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const save = new AsyncFunction('draft', 'submitting', 'changed', 'orderedIds', 'convex', 'dispatch', 'reorder', 'AccessibilityInfo', 'cancel', body.trim().slice(0, -1).replace(/ as typeof serverIds/g, ''));
  const baseline = ['a','b','c','d'];
  const desired = ['b','a','c','d'];
  assert.deepEqual(proposedOrder(['c','a','b','d'], changedPositions(baseline, desired)), ['c','b','a','d']);
  for (const ids of [desired, baseline, Array.from({length:600}, (_,i) => String(i))]) {
    const events: {type:string}[] = [];
    let payload: string[] | undefined;
    await save({ids}, {current:false}, changedPositions(baseline, ids), ids, {connectionState:() => ({isWebSocketConnected:true})}, (event: {type:string}) => events.push(event), async ({ids}: {ids:string[]}) => {payload = ids;}, {announceForAccessibility:() => {}}, () => {});
    assert.deepEqual(payload, ids);
    assert.deepEqual(events, [{type:'save'}, {type:'success'}]);
    if (ids === desired) assert.deepEqual(proposedOrder(['c','a','b','d'], payload!), desired);
  }
  for (const [pending, connected] of [[true, true], [false, false]]) {
    await save({ids:desired}, {current:pending}, ['b','a'], desired, {connectionState:() => ({isWebSocketConnected:connected})}, () => assert.fail('guard must not dispatch'), () => assert.fail('guard must not write'), {}, () => {});
  }
  let state = {ids:desired, pending:false, error:false};
  const submitting = {current:false};
  await save(state, submitting, ['b','a'], desired, {connectionState:() => ({isWebSocketConnected:true})}, (event: Parameters<typeof reorderReducer>[1]) => {state = reorderReducer(state, event)!;}, async () => {throw new Error('save failed');}, {}, () => {});
  assert.deepEqual(state, {ids:desired, pending:false, error:true});
  assert.equal(submitting.current, false);
  assert.doesNotMatch(source, /256|ids:changed/);
});
