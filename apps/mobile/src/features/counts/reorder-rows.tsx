import type { api } from '@recovery/backend/convex/_generated/api';
import type { FunctionReturnType } from 'convex/server';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AccessibilityInfo, PanResponder, View, type ScrollView } from 'react-native';
import Animated, { LinearTransition, ReduceMotion } from 'react-native-reanimated';
import { colors } from '@/theme/tokens';
import { Typography } from '@/components/ui/text';
import { CountRow } from './count-presentation';
import { handleResponder } from './reorder-gesture';
import { dragTarget, edgeScroll, type RowFrame } from './reorder-policy';

type Count = FunctionReturnType<typeof api.counts.get>;
export type ScrollMetrics = {offset:number; height:number; contentHeight:number};
type Props = {counts:Count[]; now:number; pending:boolean; onMove:(id:string, to:number)=>void; scroll:RefObject<ScrollView | null>; metrics:RefObject<ScrollMetrics>};

// Keep responders mounted by ID so moving a row does not lose its native/a11y focus.
function Handle({name, index, total, pending, start, move, end, accessibleMove}: {
  name:string; index:number; total:number; pending:boolean;
  start:(y:number)=>void; move:(y:number)=>void; end:()=>void; accessibleMove:(to:number)=>void;
}) {
  const latest = useRef({pending,start,move,end});
  latest.current = {pending,start,move,end};
  const responder = useMemo(() => PanResponder.create(handleResponder(() => latest.current)), []);
  return <View {...responder.panHandlers} accessible accessibilityRole="adjustable"
    accessibilityLabel={`Reorder ${name}`} accessibilityHint="Drag to move, or use Move up and Move down actions."
    accessibilityValue={{text:`Position ${index + 1} of ${total}`}} accessibilityState={{disabled:pending}}
    accessibilityActions={pending ? [] : [...(index > 0 ? [{name:'decrement', label:'Move up'}] : []), ...(index < total - 1 ? [{name:'increment', label:'Move down'}] : [])]}
    onAccessibilityAction={event => {
      if (pending) return;
      const direction = event.nativeEvent.actionName === 'decrement' ? -1 : event.nativeEvent.actionName === 'increment' ? 1 : 0;
      if (direction && index + direction >= 0 && index + direction < total) {
        accessibleMove(index + direction);
        AccessibilityInfo.announceForAccessibility(`${name}, position ${index + direction + 1} of ${total}`);
      }
    }} style={{minWidth:48, minHeight:48, alignItems:'center', justifyContent:'center'}}>
    <Typography accessibilityElementsHidden importantForAccessibility="no">☰</Typography>
  </View>;
}

export function ReorderRows(props:Props) {
  const latest = useRef(props); latest.current = props;
  const list = useRef<View>(null);
  const frames = useRef(new Map<string, RowFrame>());
  const drag = useRef<{id:string; finger:number; listTop:number; initialOffset:number; viewportTop:number; rows:RowFrame[]} | null>(null);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [active, setActive] = useState<{id:string; y:number} | null>(null);
  function end() {
    generation.current++;
    if (timer.current) clearInterval(timer.current);
    timer.current = null; drag.current = null; setActive(null);
  }
  useEffect(() => () => { generation.current++; if (timer.current) clearInterval(timer.current); }, []);
  useEffect(() => { if (props.pending || (active && !props.counts.some(c => c._id === active.id))) end(); }, [props.pending, props.counts, active?.id]);
  function update(y:number) {
    const d = drag.current;
    if (!d || latest.current.pending) return;
    d.finger = y;
    const contentY = y - d.listTop + latest.current.metrics.current.offset - d.initialOffset;
    const to = dragTarget(d.rows, contentY);
    latest.current.onMove(d.id, to);
    setActive(previous => previous?.id === d.id && previous.y === contentY ? previous : {id:d.id, y:contentY});
  }
  function start(id:string, y:number) {
    if (props.pending) return;
    const token = ++generation.current;
    list.current?.measureInWindow((_x, listTop) => {
      props.scroll.current?.getNativeScrollRef()?.measureInWindow((_sx, viewportTop) => {
        if (token !== generation.current || latest.current.pending) return;
        // Freeze insertion slots: reordered layout must not move the hit-test boundaries.
        const rows = latest.current.counts.flatMap(count => {const frame = frames.current.get(count._id); return frame ? [frame] : [];});
        if (rows.length !== latest.current.counts.length) return;
        drag.current = {id, finger:y, listTop, initialOffset:props.metrics.current.offset, viewportTop, rows};
        update(y);
        timer.current = setInterval(() => {
          const d = drag.current; if (!d) return;
          const m = latest.current.metrics.current;
          const step = edgeScroll(d.finger, d.viewportTop, m.height);
          const offset = Math.max(0, Math.min(m.contentHeight - m.height, m.offset + step));
          if (step && offset !== m.offset) latest.current.scroll.current?.scrollTo({y:offset, animated:false});
          update(d.finger);
        }, 32);
      });
    });
  }
  return <View ref={list} collapsable={false}>{props.counts.map((count, index) => {
    const frame = frames.current.get(count._id);
    const held = active?.id === count._id;
    return <Animated.View key={count._id}
      layout={held ? undefined : LinearTransition.duration(150).reduceMotion(ReduceMotion.System)}
      onLayout={event => {
        const next = {id:count._id, ...event.nativeEvent.layout};
        const previous = frames.current.get(count._id);
        frames.current.set(count._id, next);
        // A stationary pointer still needs a new transform after the held slot moves.
        if (previous?.y !== next.y || previous?.height !== next.height) {
          setActive(current => current?.id === count._id ? {...current} : current);
        }
      }}
      style={{flexDirection:'row', alignItems:'center', backgroundColor:colors.canvas, zIndex:held ? 1 : 0, transform:[{translateY:held && frame ? active.y - frame.y - frame.height / 2 : 0}]}}>
      <View style={{flex:1}}><CountRow count={count} now={props.now} /></View>
      <Handle name={count.name} index={index} total={props.counts.length} pending={props.pending}
        start={y => start(count._id,y)} move={update} end={end} accessibleMove={to => props.onMove(count._id,to)} />
    </Animated.View>;
  })}</View>;
}
