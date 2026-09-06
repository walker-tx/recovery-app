import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Evaluate only input helpers; never start the credential-gated runner.
const source=readFileSync(new URL('./native-fixture-run.mjs',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('function bounds('),source.indexOf('\nfunction ',source.indexOf('function paste(')));
function harness(field,viewport='[0,0][1000,1000]'){
 const flows=[],clips=[];
 const context={hierarchy:()=>[{bounds:viewport},{accessibilityText:'Email',value:'',bounds:field}],clipboard:value=>clips.push(value),flow:(name,body)=>flows.push(body),fail:()=>{throw Error('NATIVE_FIXTURE_REFUSED');}};
 runInNewContext(helpers,context);
 return {paste:()=>context.paste('Email','benign','test'),flows,clips};
}
test('tap and long press serialize integer percentages from fresh field bounds',()=>{
 const h=harness('[100,308][900,348]');
 h.paste();
 assert.ok(h.flows[0].startsWith('- tapOn:\n    point: "50%,33%"\n- longPressOn:\n    point: "50%,33%"\n'));
 assert.deepEqual(h.clips,['benign','']);
});
test('refuses rounding outside a narrow field before clipboard or flow',()=>{
 const h=harness('[100,3260][900,3295]','[0,0][1000,10000]');
 assert.throws(h.paste,/NATIVE_FIXTURE_REFUSED/);
 assert.deepEqual(h.clips,[]);
 assert.deepEqual(h.flows,[]);
});
test('integer pixel truncation must remain strictly inside field bounds',()=>{
 const h=harness('[100,3300][900,3335]','[0,0][1000,10001]');
 assert.throws(h.paste,/NATIVE_FIXTURE_REFUSED/);
 assert.deepEqual(h.flows,[]);
});
