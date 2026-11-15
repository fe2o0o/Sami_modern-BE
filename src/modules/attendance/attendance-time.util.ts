/**
 * Attendance runs on Egypt time (Africa/Cairo, DST-aware) whatever the server's
 * own timezone is: the work date, the clock time shown to people and every
 * late / overtime minute are taken from the Cairo wall clock.
 */
export const ATTENDANCE_TZ = 'Africa/Cairo';

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: ATTENDANCE_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export interface CairoParts {
  /** YYYY-MM-DD */
  date: string;
  /** HH:mm:ss */
  time: string;
  /** Minutes since Cairo midnight. */
  minutes: number;
}

export function cairoParts(at: Date = new Date()): CairoParts {
  const p: Record<string, string> = {};
  for (const x of fmt.formatToParts(at)) p[x.type] = x.value;
  const date = `${p.year}-${p.month}-${p.day}`;
  const time = `${p.hour}:${p.minute}:${p.second}`;
  return { date, time, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** Today's date in Cairo (YYYY-MM-DD). */
export const cairoToday = (): string => cairoParts().date;

/** The UTC instant of a Cairo wall-clock date + time ("HH:mm" or "HH:mm:ss"). */
export function cairoToUtc(date: string, time: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm, ss = 0] = time.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm, ss);
  // Cairo offset at that moment (two passes settle a DST boundary).
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const p = cairoParts(new Date(guess));
    const [py, pm, pd] = p.date.split('-').map(Number);
    const [ph, pmi, ps] = p.time.split(':').map(Number);
    const offset = Date.UTC(py, pm - 1, pd, ph, pmi, ps) - guess;
    guess = wall - offset;
  }
  return new Date(guess);
}

/** "HH:mm[:ss]" → minutes since midnight. */
export function hhmmToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function minutesToHhmm(min: number): string {
  const v = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday for a YYYY-MM-DD date. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** First / last day of a YYYY-MM month. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

/** Great-circle distance in metres. */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
