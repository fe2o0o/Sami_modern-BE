/**
 * Tiny per-row cell coercers shared by every entity importer. Each throws an
 * Arabic Error (caught by the import runner → becomes that row's error) when a
 * value is missing/invalid, so import handlers stay declarative.
 */

/** Required non-empty string. */
export function str(value: unknown, label: string): string {
  const s = value === null || value === undefined ? '' : String(value).trim();
  if (!s) throw new Error(`العمود «${label}» مطلوب`);
  return s;
}

/** Optional string → trimmed value or null. */
export function optStr(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s === '' ? null : s;
}

/** Required finite number. */
export function num(value: unknown, label: string): number {
  if (value === null || value === undefined || value === '') {
    throw new Error(`العمود «${label}» مطلوب`);
  }
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  if (!Number.isFinite(n)) throw new Error(`العمود «${label}» يجب أن يكون رقماً`);
  return n;
}

/** Optional number → value or the given fallback (default 0). */
export function optNum(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === '') return fallback;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(n) ? n : fallback;
}

/** Boolean cell (already coerced to boolean/null by the parser) with a default. */
export function bool(value: unknown, fallback = true): boolean {
  if (value === null || value === undefined || value === '') return fallback;
  return Boolean(value);
}

/**
 * Resolve one of an enum's values from an Arabic label OR the raw enum value.
 * `labels` maps enumValue → Arabic label. Throws when nothing matches.
 */
export function enumFromLabel<T extends string>(
  value: unknown,
  labels: Record<T, string>,
  label: string,
  fallback?: T,
): T {
  const s = value === null || value === undefined ? '' : String(value).trim();
  if (!s) {
    if (fallback !== undefined) return fallback;
    throw new Error(`العمود «${label}» مطلوب`);
  }
  const lower = s.toLowerCase();
  for (const [key, arabic] of Object.entries(labels) as [T, string][]) {
    if (key.toLowerCase() === lower || arabic === s) return key;
  }
  const allowed = Object.values(labels).join('، ');
  throw new Error(`قيمة «${s}» غير صحيحة للعمود «${label}» — القيم المسموحة: ${allowed}`);
}
