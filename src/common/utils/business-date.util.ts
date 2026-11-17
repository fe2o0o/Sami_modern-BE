/**
 * The business calendar: «today» is the date in EGYPT, whatever timezone the
 * server runs in (production runs on UTC — a document posted at 00:30 Cairo time
 * must not land on the previous day, or on the previous period at month end).
 *
 * Use these for every «today» the system decides by itself (journal entry dates,
 * default document dates, default report ranges). Dates that come FROM a document
 * or the database are already business dates and must not go through here.
 */
export const BUSINESS_TZ = 'Africa/Cairo';

const PARTS = new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** 'YYYY-MM-DD' of the given instant (default: now) in Egypt. */
export function businessToday(at: Date = new Date()): string {
  const p = Object.fromEntries(PARTS.formatToParts(at).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** The calendar year in Egypt right now. */
export function businessYear(at: Date = new Date()): number {
  return Number(businessToday(at).slice(0, 4));
}

/**
 * Egypt's «today» as a LOCAL-midnight Date (its getFullYear/getMonth/getDate are the
 * Egyptian date) — for code that does calendar arithmetic with the local Date API.
 */
export function businessTodayDate(at: Date = new Date()): Date {
  const [y, m, d] = businessToday(at).split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Calendar arithmetic on an ISO date: 'YYYY-MM-DD' ± n days (timezone-free). */
export function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
