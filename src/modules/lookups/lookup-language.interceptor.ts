import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request } from 'express';
import { Observable, map } from 'rxjs';
import { langFromHeader, translateMessage } from '../../common/i18n/i18n';

/**
 * Lookup items carry `name` (Arabic, as entered) and optional `nameEn`.
 * English UI: show `nameEn` when filled, else the name (fixed labels such as
 * warehouse types go through the message dictionary). `nameEn` is then dropped
 * so the response shape stays `{ id, name, … }`.
 */
@Injectable()
export class LookupLanguageInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const lang = langFromHeader(req.headers['accept-language']);
    const fix = (item: unknown): unknown => {
      if (!item || typeof item !== 'object' || !('name' in item)) return item;
      const { nameEn, ...rest } = item as { name: string; nameEn?: string | null } & Record<string, unknown>;
      if (lang !== 'en') return rest;
      return { ...rest, name: nameEn?.trim() ? nameEn : translateMessage(String(rest.name ?? ''), lang) };
    };
    return next.handle().pipe(
      map((payload) => {
        if (Array.isArray(payload)) return payload.map(fix);
        if (payload && typeof payload === 'object') {
          // e.g. subledger accounts: { treasuries: [...], bankAccounts: [...] }
          const out: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(payload)) out[k] = Array.isArray(v) ? v.map(fix) : v;
          return out;
        }
        return payload;
      }),
    );
  }
}
