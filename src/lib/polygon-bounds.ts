// Bounds for the public market-data routes. They are unauthenticated, and several
// actions fan out to one paid upstream call per symbol or series.

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
  if (!ISO_DATE.test(raw)) return null;
  const [year, month, day] = raw.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return raw;
}

export function parseAllowlist<T extends string>(
  raw: string | null,
  allowed: readonly T[],
  fallback: T,
): T | null {
  const value = raw == null || raw === '' ? fallback : raw;
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export const ALPACA_TIMEFRAMES = ['1Day', '1Hour', '15Min', '5Min', '1Min'] as const;
export const ALPACA_PERIODS = ['1D', '1M', '3M', '6M', '1Y'] as const;
export const BARS_LIMIT = { min: 1, max: 5000, fallback: 252 } as const;

export const NEWS_CATEGORIES = ['general', 'forex', 'crypto', 'merger'] as const;
export const CANDLE_RESOLUTIONS = ['1', '5', '15', '30', '60', 'D', 'W', 'M'] as const;
export const NEWS_DAYS = { min: 1, max: 30, fallback: 7 } as const;

// FRED frequency codes the observations endpoint accepts.
export const FRED_FREQUENCIES = ['d', 'w', 'bw', 'm', 'q', 'sa', 'a', 'wef', 'weth', 'wew', 'wetu', 'wem', 'wesu', 'wesa', 'bwew', 'bwem'] as const;

export const FILING_COUNT = { min: 1, max: 50, fallback: 20 } as const;
export const MAX_FORMS = 10;
const FORM_RE = /^[A-Za-z0-9][A-Za-z0-9/-]{0,19}$/;

export function parseFormList(raw: string | null): string[] | null {
  const source = raw == null || raw.trim() === '' ? '10-K,10-Q,8-K' : raw;
  const forms = source.split(',').map((form) => form.trim()).filter(Boolean);
  if (forms.length === 0 || forms.length > MAX_FORMS) return null;
  if (forms.some((form) => !FORM_RE.test(form) || form.includes('..'))) return null;
  return forms;
}

const FRED_ID_RE = /^[A-Z0-9]{1,32}$/;

export function parseFredSeriesId(raw: string | null, known: ReadonlySet<string>): FieldParse<string> {
  if (raw == null || raw.trim() === '') return { ok: false, reason: 'missing' };
  const id = raw.trim();
  if (!FRED_ID_RE.test(id) || !known.has(id)) return { ok: false, reason: 'invalid' };
  return { ok: true, value: id };
}

// Unix seconds. undefined = omitted. null = present but outside a 10-year window.
export function parseUnixSeconds(raw: string | null, nowSeconds = Math.floor(Date.now() / 1000)): number | undefined | null {
  if (raw == null || raw === '') return undefined;
  if (!/^[0-9]{1,10}$/.test(raw)) return null;
  const n = Number(raw);
  const latest = nowSeconds + 86400;
  const earliest = nowSeconds - 10 * 365 * 24 * 60 * 60;
  if (!Number.isInteger(n) || n < earliest || n > latest) return null;
  return n;
}

export function boundedTickers(symbols: string[], max = MAX_SYMBOLS): string[] | null {
  if (symbols.length === 0 || symbols.length > max) return null;
  if (symbols.some((symbol) => !TICKER_RE.test(symbol))) return null;
  return symbols;
}
