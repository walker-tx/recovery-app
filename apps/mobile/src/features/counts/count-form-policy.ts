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
