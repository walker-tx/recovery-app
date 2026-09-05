import type { ElapsedPart, LargestUnit } from './elapsed-policy.ts';

export function formatPart(part: ElapsedPart, locale?: string) {
  return `${new Intl.NumberFormat(locale).format(part.value)} ${part.value === 1 ? part.unit.slice(0, -1) : part.unit}`;
}
export function formatStarted(startAt: number, full = false, locale?: string, timeZone?: string) {
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: full ? 'long' : 'short', year: 'numeric', ...(full ? { weekday: 'long' as const } : {}), timeZone }).format(startAt);
}
export function canSaveUnit(saved: LargestUnit, selected: LargestUnit, connected: boolean, pending: boolean) {
  return saved !== selected && connected && !pending;
}
// One clock per Counts route stack; callbacks always sample wall time, never accumulate ticks.
export function startMinuteClock<T>(publish: (now: number) => void, timer: {
  now: () => number; schedule: (callback: () => void, delay: number) => T; cancel: (handle: T) => void;
}) {
  let handle: T | undefined;
  let stopped = false;
  function refresh() {
    if (stopped) return;
    if (handle !== undefined) timer.cancel(handle);
    const now = timer.now();
    publish(now);
    handle = timer.schedule(refresh, 60_000 - now % 60_000);
  }
  refresh();
  return { refresh, stop() { stopped = true; if (handle !== undefined) timer.cancel(handle); } };
}
