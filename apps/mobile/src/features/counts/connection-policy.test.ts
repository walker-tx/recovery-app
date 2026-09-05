import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { proposedOrder, reorderReducer } from './reorder-policy.ts';
const source = (name: string) => readFileSync(new URL(name, import.meta.url), 'utf8');
test('query replacement leaves reorder state and navigation guard in its stable owner', () => {
  const s = source('./counts-screen.tsx');
  const owner = s.slice(s.indexOf('function CountsOwner'), s.indexOf('function CountsContent'));
  assert.match(owner, /useReducer\(reorderReducer/);
  assert.match(owner, /usePreventRemove/);
  assert.match(owner, /<CountQueryBoundary/);
  assert.doesNotMatch(s.slice(s.indexOf('function CountsContent')), /useReducer|usePreventRemove/);
});
test('Units owner retains selection, pending confirmation and guard outside query recovery', () => {
  const s = source('./count-units-screen.tsx');
  const owner = s.slice(s.indexOf('function UnitsOwner'), s.indexOf('function UnitsContent'));
  assert.match(owner, /useState<LargestUnit/);
  assert.match(owner, /usePreventRemove/);
  assert.match(owner, /<CountQueryBoundary/);
  assert.match(s, /<UnitsOwner key=\{id\}/);
  assert.match(s, /convex.connectionState\(\).isWebSocketConnected/);
  assert.match(s, /await setUnit/);
});
test('pending order survives disconnect, failure retries, reconnect drops deleted membership', () => {
  let draft = reorderReducer(null, {type:'enter', ids:['a','b','c']});
  draft = reorderReducer(draft, {type:'move', id:'b', to:0});
  draft = reorderReducer(draft, {type:'save'});
  assert.equal(reorderReducer(draft, {type:'cancel'}), draft);
  draft = reorderReducer(draft, {type:'failure'});
  assert.deepEqual(draft?.ids, ['b','a','c']);
  assert.deepEqual(proposedOrder(['a','c','new'], draft!.ids), ['a','c','new']);
  draft = reorderReducer(draft, {type:'save'});
  assert.equal(draft?.pending, true);
  assert.equal(reorderReducer(draft, {type:'success'}), null);
  const s = source('./counts-screen.tsx');
  assert.ok(s.indexOf('convex.connectionState().isWebSocketConnected') < s.indexOf('await reorder'));
});

// Wiring contracts supplement reducer behavior; they do not mount native screens.
test('auth route removes local owners and query failure exposes no write controls', () => {
  const auth = source('../auth/workos-root-provider.tsx');
  assert.match(auth, /Stack.Protected guard=\{destination === "app"\}/);
  const units = source('./count-units-screen.tsx');
  assert.match(units, /disabled=\{pending\} onPress/);
  assert.match(units, /disabled=\{state.pending\}/);
  const form = units.slice(units.indexOf('function UnitsForm'));
  assert.ok(form.indexOf('convex.connectionState()') < form.indexOf('await setUnit'));
  assert.ok(form.indexOf('await setUnit') < form.indexOf('setSaved(true)'));
  assert.match(form, /catch \{ setError/);
  const boundary = source('./count-query-boundary.tsx');
  assert.match(boundary, /if \(!this.state.failed\) return this.props.children/);
  assert.match(boundary, /setState\(\{ failed: false \}\)/);
});
