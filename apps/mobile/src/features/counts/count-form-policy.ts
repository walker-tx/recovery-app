import { graphemeSegments } from 'unicode-segmenter/grapheme';

export type CountDraft = { name: string; startAt: number | null };
export const EMPTY_COUNT_DRAFT: CountDraft = { name: '', startAt: null };

export function countNameError(input: string): string | null {
  const name = input.trim();
  if (!name) return 'Enter a name.';
  let length = 0;
  for (const _ of graphemeSegments(name)) {
    if (++length > 100) return 'Use 100 characters or fewer.';
  }
  return null;
}
export function toLocalMidnight(date: Date): number {
  const midnight = new Date(date);
  midnight.setHours(0, 0, 0, 0);
  return midnight.getTime();
}
export function isCountDraftDirty(draft: CountDraft, original: CountDraft): boolean {
  return draft.name !== original.name || draft.startAt !== original.startAt;
}
export function canSaveCount(draft: CountDraft, connected: boolean, pending: boolean): boolean {
  return connected && !pending && countNameError(draft.name) === null && draft.startAt !== null && Number.isFinite(draft.startAt);
}
export function duplicateNotice(count: { name: string; startAt: number } | null | undefined): string | null {
  return count ? `You already have “${count.name}”, started ${new Date(count.startAt).toLocaleDateString()}. You can still save this Count.` : null;
}
export function countsView(status: string, length: number): 'loading' | 'empty' | 'populated' {
  return status === 'LoadingFirstPage' ? 'loading' : length === 0 ? 'empty' : 'populated';
}

// Material value/output use UTC calendar days; its maximumDate already converts
// local calendar components natively. Keep bounds as local Dates (no UTC shift).
export function countPickerValue(date: Date, platform: string): Date {
  if (platform !== 'android') return new Date(date);
  const value = new Date(0);
  value.setUTCFullYear(date.getFullYear(), date.getMonth(), date.getDate());
  value.setUTCHours(0, 0, 0, 0);
  return value;
}

export function countPickerStartAt(date: Date, platform: string, original: number | null): number {
  const local = new Date(date);
  if (platform === 'android') {
    local.setFullYear(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }
  const midnight = toLocalMidnight(local);
  // Confirming the same displayed day must not rewrite an Edit instant after travel.
  return original !== null && toLocalMidnight(new Date(original)) === midnight ? original : midnight;
}

export function countsOfflineNotice(status: string, connected: boolean): string | null {
  return !connected && status !== 'LoadingFirstPage' ? 'Offline. Showing last synced Counts.' : null;
}

export function editCountDraft(draft: CountDraft, original: CountDraft): CountDraft {
  return draft.startAt !== null && original.startAt !== null &&
    toLocalMidnight(new Date(draft.startAt)) === toLocalMidnight(new Date(original.startAt))
    ? { ...draft, startAt: original.startAt } : draft;
}
export function canSaveCountEdit(draft: CountDraft, original: CountDraft, connected: boolean, pending: boolean): boolean {
  return canSaveCount(draft, connected, pending) && isCountDraftDirty(editCountDraft(draft, original), original);
}
export function countDuplicateArgs<T extends string>(name: string, excludeId: T): { name: string; excludeId: T } | 'skip' {
  return countNameError(name) === null ? { name: name.trim(), excludeId } : 'skip';
}
export async function deleteCountOnce(lock: { current: boolean }, connected: boolean, remove: () => Promise<unknown>): Promise<'ignored' | 'deleted' | 'failed'> {
  if (lock.current || !connected) return 'ignored';
  lock.current = true;
  try { await remove(); return 'deleted'; }
  catch { return 'failed'; }
  finally { lock.current = false; }
}
