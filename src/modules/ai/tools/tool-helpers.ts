import { BadRequestException } from '@nestjs/common';

/** Validate/normalize a YYYY-MM-DD date arg from the model (never trust blindly). */
export function normalizeDate(value: unknown, field = 'date'): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new BadRequestException(`تاريخ غير صالح (${field}): استخدم صيغة YYYY-MM-DD`);
  }
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`تاريخ غير صالح (${field})`);
  return s;
}

/** Optional trimmed string. */
export function optStr(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s.length ? s : undefined;
}

/** Optional uuid arg (soft check — the service validates too). */
export function optUuid(value: unknown, field = 'id'): string | undefined {
  const s = optStr(value);
  if (!s) return undefined;
  if (!/^[0-9a-fA-F-]{36}$/.test(s)) {
    throw new BadRequestException(`معرّف غير صالح (${field})`);
  }
  return s;
}

/** Clamp pagination the model asks for so it never pulls huge result sets. */
export function pageArgs(args: Record<string, unknown>, defaultPerPage = 20, maxPerPage = 100): {
  page: number;
  perPage: number;
} {
  const page = Math.max(1, Number(args.page) || 1);
  const perPage = Math.min(maxPerPage, Math.max(1, Number(args.perPage) || defaultPerPage));
  return { page, perPage };
}

/** A JSON-schema property for a YYYY-MM-DD date. */
export const dateProp = (desc: string) => ({
  type: 'string',
  description: `${desc} (YYYY-MM-DD)`,
});

/** Build a pagination/list query object (with the `skip` the DTOs expose as a getter). */
export function listQuery(
  page: number,
  perPage: number,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { page, perPage, skip: (page - 1) * perPage, order: 'DESC', ...extra };
}

/** System currency label used when presenting monetary figures. */
export const CURRENCY = 'EGP';

