import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as policy from './reorder-policy.ts';

// Drive the real component's callbacks with deterministic hooks and layout frames.
function fixture(heights: number[]) {
  const slots: any[] = [];
  let cursor = 0, dirty = true, tick = () => {}, running = false;
  let effects: (() => void)[] = [];
  const jsx = (type: any, props: any) => ({type, props});
  const react = {
    useRef(value: any) { const i = cursor++; return slots[i] ??= {current:value}; },
    useState(value: any) {
      const i = cursor++; if (!(i in slots)) slots[i] = value;
      return [slots[i], (next: any) => {
        const result = typeof next === 'function' ? next(slots[i]) : next;
        if (result !== slots[i]) { slots[i] = result; dirty = true; }
      }];
    },
    useEffect(fn: () => void, deps: any[]) {
      const i = cursor++, previous = slots[i];
      if (!previous || deps.some((value, j) => value !== previous[j])) effects.push(fn);
      slots[i] = deps;
    }, useMemo: (fn: any) => fn(),
  };
  const exports: any = {};
  const source = ts.transpileModule(readFileSync(new URL('./reorder-rows.tsx', import.meta.url), 'utf8'), {
    compilerOptions: {module:ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.ReactJSX},
  }).outputText;
  runInNewContext(source, {exports, require: (name: string) => {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return {jsx, jsxs:jsx};
    if (name === './reorder-policy') return policy;
    if (name === 'react-native-reanimated') return {default:{View:'row'}, LinearTransition:{duration:()=>({reduceMotion:()=>null})}, ReduceMotion:{System:0}};
    return {View:'view', colors:{}, Typography:'text', CountRow:'count'};
  }, setInterval: (fn: any) => {tick = fn; running = true; return 1;}, clearInterval() {running = false; tick = () => {};}});
  const props: any = {
    counts: heights.map((height, i) => ({_id:String(i), name:String(i), height})), now:0, pending:false,
    metrics:{current:{offset:0, height:500, contentHeight:500}},
    scroll:{current:{getNativeScrollRef:()=>({measureInWindow:(fn:any)=>fn(0,0)})}},
    onMove(id:string, to:number) {
      const ids = props.counts.map((c:any)=>c._id);
      const next = policy.moveCount(ids,id,to);
      if (next !== ids) { props.counts = next.map(id=>props.counts.find((c:any)=>c._id===id)); dirty = true; }
    },
  };
  let tree: any;
  function render() {
    while (dirty) { cursor=0; dirty=false; effects=[]; tree=exports.ReorderRows(props); tree.props.ref.current={measureInWindow:(fn:any)=>fn(0,0)}; effects.forEach(fn=>fn()); }
  }
  function layout() {
    render(); let y=0;
    tree.props.children.forEach((row:any, i:number)=> {
      const height=props.counts[i].height;
      row.props.onLayout({nativeEvent:{layout:{y,height}}}); y+=height;
    });
    render();
  }
  layout();
  return {
    start(id:string, y:number) { tree.props.children[props.counts.findIndex((c:any)=>c._id===id)].props.children[1].props.start(y); render(); },
    move(y:number) { tree.props.children[0].props.children[1].props.move(y); render(); },
    frame() { layout(); tick(); render(); return props.counts.map((c:any)=>c._id); },
    layout,
    replace(rows: {id:string; height:number}[]) { props.counts=rows.map(({id,height})=>({_id:id,name:id,height})); dirty=true; layout(); },
    running() { return running; },
    accessibleMove(id:string, to:number) { tree.props.children[props.counts.findIndex((c:any)=>c._id===id)].props.children[1].props.accessibleMove(to); render(); },
    translation(id:string) { return tree.props.children[props.counts.findIndex((c:any)=>c._id===id)].props.style.transform[0].translateY; },
  };
}

test('stationary short-row drag stays inserted through successive unequal-height layouts', () => {
  const f=fixture([200,50]); f.start('1',225); f.move(190);
  for (let i=0;i<5;i++) assert.deepEqual(f.frame(), ['1','0']);
});

test('held translation invalidates immediately after layout with a stationary pointer', () => {
  const f=fixture([100,100]); f.start('1',150); f.move(90);
  assert.equal(f.translation('1'), -60);
  f.layout();
  assert.equal(f.translation('1'), 40);
  for (let i=0;i<5;i++) { assert.deepEqual(f.frame(), ['1','0']); assert.equal(f.translation('1'),40); }
});

test('stable slots still allow reversing direction and dragging a tall row downward', () => {
  const short=fixture([200,50]); short.start('1',225); short.move(190);
  for (let i=0;i<3;i++) assert.deepEqual(short.frame(), ['1','0']);
  short.move(225);
  for (let i=0;i<3;i++) assert.deepEqual(short.frame(), ['0','1']);
  const tall=fixture([200,50]); tall.start('0',100); tall.move(225);
  for (let i=0;i<3;i++) assert.deepEqual(tall.frame(), ['1','0']);
});

for (const change of ['insert', 'delete', 'height'] as const) {
  test(`${change} cancels an active drag without discarding proposed order`, () => {
    const f=fixture([200,50]); f.start('1',225); f.move(190); f.layout();
    assert.equal(f.running(), true);
    const rows = change === 'insert' ? [{id:'1',height:50},{id:'0',height:200},{id:'2',height:100}]
      : change === 'delete' ? [{id:'1',height:50}]
      : [{id:'1',height:50},{id:'0',height:50}];
    f.replace(rows);
    assert.equal(f.running(), false);
    assert.equal(f.translation('1'), 0);
    f.move(500);
    assert.deepEqual(f.frame(), rows.map(row=>row.id));
    if (change !== 'delete') {
      f.accessibleMove('1',1);
      assert.equal(f.frame()[1], '1');
    }
  });
}

test('position-only layout keeps the drag and timer active', () => {
  const f=fixture([200,50]); f.start('1',225); f.move(190); f.layout();
  assert.equal(f.running(), true);
  assert.notEqual(f.translation('1'), 0);
  f.move(225);
  assert.deepEqual(f.frame(), ['0','1']);
});
