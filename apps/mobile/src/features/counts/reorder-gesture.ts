// The native responder delegates through current callbacks, never a stale render.
export function handleResponder(current: () => {
  pending:boolean; start:(y:number)=>void; move:(y:number)=>void; end:()=>void;
}) {
  return {
    onStartShouldSetPanResponder: () => !current().pending,
    onPanResponderGrant: (event:{nativeEvent:{pageY:number}}) => {if (!current().pending) current().start(event.nativeEvent.pageY);},
    onPanResponderMove: (_event:unknown, gesture:{moveY:number}) => {if (!current().pending) current().move(gesture.moveY);},
    onPanResponderRelease: () => current().end(),
    onPanResponderTerminate: () => current().end(),
    onPanResponderTerminationRequest: () => false,
  };
}
