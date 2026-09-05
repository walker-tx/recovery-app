export type LargestUnit = 'hours' | 'days' | 'weeks' | 'months' | 'years';
export type ElapsedPart = { unit: LargestUnit | 'minutes'; value: number };
export type Milestone =
  | { unit: 'days'; value: 30 | 60 | 90 }
  | { unit: 'months'; value: 6 }
  | { unit: 'years'; value: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

function validTimestamp(value: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= 8.64e15;
}

// Always anchor to the original day/time, never to a previously clamped date.
function anniversary(start: Date, months: number): number {
  const monthIndex = start.getUTCMonth() + months;
  const year = start.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = monthIndex % 12;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const date = new Date(start.getTime());
  // setUTCFullYear avoids Date.UTC/new Date's special handling of years 0..99.
  date.setUTCFullYear(year, month, Math.min(start.getUTCDate(), days[month]));
  // A candidate beyond Date's range cannot have been reached by a valid now.
  return Number.isNaN(date.getTime()) ? Infinity : date.getTime();
}

function completeMonths(start: Date, nowMs: number): number {
  const now = new Date(nowMs);
  const months = (now.getUTCFullYear() - start.getUTCFullYear()) * 12
    + now.getUTCMonth() - start.getUTCMonth();
  return months - (anniversary(start, months) > nowMs ? 1 : 0);
}

/** Ordered numeric parts for locale-aware UI. Invalid dates return null;
 * future starts render zero without changing the caller's stored instant.
 */
export function elapsedParts(
  startMs: number,
  nowMs: number,
  largestUnit: LargestUnit,
): ElapsedPart[] | null {
  if (!validTimestamp(startMs) || !validTimestamp(nowMs)) return null;
  const start = new Date(startMs);
  const now = Math.max(start.getTime(), new Date(nowMs).getTime());
  let remainder = now - start.getTime();
  const parts: ElapsedPart[] = [];
  if (largestUnit === 'months' || largestUnit === 'years') {
    const months = completeMonths(start, now);
    if (largestUnit === 'years') {
      parts.push({ unit: 'years', value: Math.floor(months / 12) });
    }
    parts.push({ unit: 'months', value: largestUnit === 'years' ? months % 12 : months });
    remainder = now - anniversary(start, months);
  }
  if (largestUnit === 'weeks') {
    parts.push({ unit: 'weeks', value: Math.floor(remainder / WEEK) });
    remainder %= WEEK;
  }
  if (largestUnit !== 'hours') {
    parts.push({ unit: 'days', value: Math.floor(remainder / DAY) });
    remainder %= DAY;
  }
  parts.push({ unit: 'hours', value: Math.floor(remainder / HOUR) });
  parts.push({ unit: 'minutes', value: Math.floor((remainder % HOUR) / MINUTE) });
  return parts;
}

/** Latest achieved milestone only; no history or locale/calendar side effects. */
export function latestMilestone(startMs: number, nowMs: number): Milestone | null {
  if (!validTimestamp(startMs) || !validTimestamp(nowMs) || nowMs < startMs) return null;
  const start = new Date(startMs);
  const now = new Date(nowMs).getTime();
  const months = completeMonths(start, now);
  if (months >= 12) return { unit: 'years', value: Math.floor(months / 12) };
  if (months >= 6) return { unit: 'months', value: 6 };
  const days = (now - start.getTime()) / DAY;
  for (const value of [90, 60, 30] as const) {
    if (days >= value) return { unit: 'days', value };
  }
  return null;
}
