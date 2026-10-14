import { EN } from '../../i18n/en';

/**
 * API message translation (Arabic ⇄ English).
 *
 * Messages stay written in Arabic in the code (they ARE the keys). The client
 * sends `Accept-Language: en|ar`; the exception filter and the response
 * interceptor translate the outgoing `message` through {@link translateMessage}.
 * Messages built with values match `{placeholder}` patterns in the dictionary:
 *   'المنتج "{name}" ليس صنفاً مخزنياً'  →  'Product "{name}" is not a stock item'
 * A missing entry returns the Arabic text unchanged (never blank).
 */
export type Lang = 'ar' | 'en';

export function langFromHeader(header: string | string[] | undefined): Lang {
  const v = (Array.isArray(header) ? header[0] : header ?? '').toLowerCase();
  return v.startsWith('en') ? 'en' : 'ar';
}

const PATTERNS: { re: RegExp; names: string[]; en: string }[] = Object.entries(EN)
  .filter(([k]) => /\{\w+\}/.test(k))
  .map(([k, en]) => {
    const names: string[] = [];
    const src = k
      .split(/(\{\w+\})/)
      .map((part) => {
        const m = /^\{(\w+)\}$/.exec(part);
        if (m) {
          names.push(m[1]);
          return '([\\s\\S]+?)';
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('');
    return { re: new RegExp(`^${src}$`), names, en };
  })
  // Longer (more specific) patterns first.
  .sort((a, b) => b.re.source.length - a.re.source.length);

export function translateMessage(message: string, lang: Lang): string {
  if (lang !== 'en' || !message) return message;
  const exact = EN[message];
  if (exact !== undefined) return exact;
  for (const p of PATTERNS) {
    const m = p.re.exec(message);
    if (m) {
      return p.en.replace(/\{(\w+)\}/g, (_x, k: string) => {
        const i = p.names.indexOf(k);
        return i >= 0 ? translateMessage(m[i + 1], lang) : _x;
      });
    }
  }
  // Multi-sentence messages (e.g. "… — …" or joined validation errors): translate the parts.
  for (const sep of [' — ', '. ', '، ', ', ']) {
    if (message.includes(sep)) {
      const parts = message.split(sep);
      const out = parts.map((p) => translateMessage(p, lang));
      if (out.some((o, i) => o !== parts[i])) return out.join(sep === '، ' ? ', ' : sep);
    }
  }
  return message;
}
