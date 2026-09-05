export function moveCount<T extends string>(ids: T[], id: T, to: number, pending = false): T[] {
  const from = ids.indexOf(id);
  if (pending || from < 0 || to < 0 || to >= ids.length || from === to) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}
// Only permute positions belonging to the draft. Subscription membership wins.
export function proposedOrder<T extends string>(server: T[], draft: T[]): T[] {
  const live = new Set(server);
  const selected = draft.filter(id => live.has(id));
  const selectedSet = new Set(selected);
  let i = 0;
  return server.map(id => selectedSet.has(id) ? selected[i++] : id);
}
export function changedPositions<T extends string>(server: T[], proposed: T[]): T[] {
  return proposed.filter((id, i) => id !== server[i]);
}
export type ReorderDraft = { ids: string[]; pending: boolean; error: boolean } | null;
type Event = {type:'enter'; ids:string[]} | {type:'move'; id:string; to:number} | {type:'save'|'cancel'|'failure'|'success'};
export function reorderReducer(state: ReorderDraft, event: Event): ReorderDraft {
  if (event.type === 'success') return null;
  if (event.type === 'failure') return state && {...state, pending:false, error:true};
  if (state?.pending) return state;
  if (event.type === 'enter') return {ids:event.ids, pending:false, error:false};
  if (!state || event.type === 'cancel') return null;
  if (event.type === 'save') return {...state, pending:true, error:false};
  return event.type === 'move' ? {...state, ids:moveCount(state.ids, event.id, event.to), error:false} : state;
}
export type RowFrame = {id:string; y:number; height:number};
export function dragTarget(rows: RowFrame[], y: number): number {
  const index = rows.findIndex(row => y < row.y + row.height);
  return index < 0 ? rows.length - 1 : index;
}
export function edgeScroll(y: number, top: number, height: number): number {
  return y < top + 56 ? -12 : y > top + height - 56 ? 12 : 0;
}
