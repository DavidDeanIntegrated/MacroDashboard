// Bounds for the public /api/polygon route. It is unauthenticated, and several
// actions fan out to one paid Massive (Polygon) call per symbol.

// Watchlist analytics is the largest caller: every WATCHLIST name plus SPY
// (27 today). 30 stays near a ~25 cap and still accepts that page.
export const MAX_SYMBOLS = 30;

// Equities, class shares (BRK.B), Polygon prefixes (X:BTCUSD), and caret indexes.
// "." and ".." are rejected: encodeURIComponent leaves dots in place, and a URL
// parser treats those segments as directory navigation.
export const TICKER_RE = /^(?!\.)(?!.*\.\.)[A-Za-z0-9.^:=-]{1,15}$/;

export const AGGREGATE_LIMIT = { min: 1, max: 5000, fallback: 500 } as const;
export const DIVIDEND_LIMIT = { min: 1, max: 100, fallback: 12 } as const;
export const INDICATOR_WINDOW = { min: 1, max: 500 } as const;

const TIMEFRAMES = new Set(['1min', '5min', '15min', '1hour', '1day']);
const TIMESPANS = new Set(['day', 'hour', 'minute']);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type PolygonRouteTimeframe = '1min' | '5min' | '15min' | '1hour' | '1day';
export type PolygonRouteTimespan = 'day' | 'hour' | 'minute';

export type FieldParse<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'missing' | 'invalid' };

export function parseTicker(raw: string | null): FieldParse<string> {
  if (raw == null || raw.trim() === '') return { ok: false, reason: 'missing' };
  const symbol = raw.trim();
  if (!TICKER_RE.test(symbol)) return { ok: false, reason: 'invalid' };
  return { ok: true, value: symbol };
}

export function parseTickerList(raw: string | null): FieldParse<string[]> {
  if (raw == null || raw.trim() === '') return { ok: false, reason: 'missing' };
  const symbols = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (symbols.length === 0) return { ok: false, reason: 'missing' };
  if (symbols.length > MAX_SYMBOLS || symbols.some((s) => !TICKER_RE.test(s))) {
    return { ok: false, reason: 'invalid' };
  }
  return { ok: true, value: symbols };
}

// Omitted or empty uses fallback. Anything else must be a base-10 integer in
// [min, max] — parseInt would accept "500abc", "1e9", and leading signs.
export function parseBoundedInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number | null {
  if (raw == null || raw === '') return fallback;
  if (!/^[0-9]{1,6}$/.test(raw)) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

export function parseTimeframe(raw: string | null): PolygonRouteTimeframe | null {
  const value = raw == null || raw === '' ? '1day' : raw;
  return TIMEFRAMES.has(value) ? (value as PolygonRouteTimeframe) : null;
}

export function parseTimespan(raw: string | null): PolygonRouteTimespan | null {
  const value = raw == null || raw === '' ? 'day' : raw;
  return TIMESPANS.has(value) ? (value as PolygonRouteTimespan) : null;
}

// undefined = omitted. null = present but not a calendar day the route will forward.
export function parseIsoDate(raw: string | null): string | undefined | null {
  if (raw == null || raw === '') return undefined;
  return ISO_DATE.test(raw) ? raw : null;
}
