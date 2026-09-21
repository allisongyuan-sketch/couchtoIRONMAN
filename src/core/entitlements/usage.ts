/**
 * Counting AI imports against a monthly allowance (PRD §34).
 *
 * Pure, so the month-rollover edge cases are tests rather than something discovered
 * on the first of the month.
 */

export interface ImportUsage {
  /** Calendar month the count belongs to, as `YYYY-MM`. */
  month: string;
  count: number;
}

export const EMPTY_USAGE: ImportUsage = { month: '', count: 0 };

/**
 * UTC rather than device-local.
 *
 * A device-local month means the allowance resets at a different instant per user,
 * and travelling across a date line could roll it back or forward. UTC is the same
 * boundary for everyone, which is what an allowance needs to be defensible.
 */
export function monthKey(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * How many imports count against *this* month.
 *
 * A stored count from a previous month is not decremented or migrated — it simply
 * stops applying, which is the whole point of storing the month alongside it.
 */
export function usageThisMonth(stored: ImportUsage | null, now: Date): number {
  if (!stored) return 0;
  return stored.month === monthKey(now) ? stored.count : 0;
}

/** Record one import, rolling the bucket over if the month has changed. */
export function recordImport(stored: ImportUsage | null, now: Date): ImportUsage {
  const month = monthKey(now);
  const count = stored?.month === month ? stored.count : 0;
  return { month, count: count + 1 };
}
