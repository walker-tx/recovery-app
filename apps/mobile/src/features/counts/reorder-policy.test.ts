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

test('selected-position payload reproduces draft without sending unchanged membership', () => {
  const server = ['new','a','b','c','d','more'];
  const wanted = ['new','c','b','d','a','more'];
  const payload = changedPositions(server, wanted);
  assert.deepEqual(payload, ['c','d','a']);
  assert.deepEqual(proposedOrder(server, payload), wanted);
  // A new record arriving after submission stays at the top, and deletion wins.
  assert.deepEqual(proposedOrder(['newer','new','a','b','c','more'], payload), ['newer','new','c','b','a','more']);
});
