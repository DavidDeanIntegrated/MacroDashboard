// Alpaca API client — market data only (prices, bars, dividends, news).
// No brokerage account, position or order endpoints: this dashboard is public.
// Docs: https://docs.alpaca.markets/

import { config } from './config';
import { fetchJson } from './fetcher';
import { withCache, getCached, setCache, TTL } from './cache';

function alpacaHeaders() {
  return {
    'APCA-API-KEY-ID': config.alpaca.apiKey,
    'APCA-API-SECRET-KEY': config.alpaca.apiSecret,
    'Content-Type': 'application/json',
  };
}

// Snapshot symbols sit in the URL path. Query-string calls already go through
// URLSearchParams, which encodes on its own. "." and ".." stay special after
// encodeURIComponent, so they are refused before the path is built.
function pathSegment(value: string): string {
  if (value === '.' || value === '..') throw new Error('Invalid path segment');
  return encodeURIComponent(value);
}

// NOTE: order endpoints were removed 2026-08-11 and account/position reads on
// 2026-10-09 — the app is a public read-only dashboard (holdings tracked in
// lib/holdings.ts), so brokerage data and actions are unused risk surface.

// ─── Market Data (Alpaca Data API) ───
// The free Basic plan covers everything here: full-market (SIP) history up to
// 15 minutes ago, real-time IEX quotes, crypto bars and corporate actions.

export interface AlpacaBar {
  t: string; // timestamp
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
}

interface AlpacaBarsResponse {
  bars: Record<string, AlpacaBar[]> | null;
  next_page_token: string | null;
}

export interface OHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type AlpacaTimeframe = '1Min' | '5Min' | '15Min' | '1Hour' | '1Day' | '1Week';

// Basic-plan SIP requests are refused when they reach into the latest 15
// minutes, so `end` is always sent: 16 minutes ago, or a caller-supplied date
// read as the whole day (inclusive, like Massive's `to`) and clamped to that.
export function historicalEnd(end?: string, nowMs = Date.now()): string {
  const latest = nowMs - 16 * 60 * 1000;
  if (!end) return new Date(latest).toISOString();
  const asked = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(end) ? `${end}T23:59:59Z` : end);
  return new Date(Math.min(Number.isFinite(asked) ? asked : latest, latest)).toISOString();
}

const MAX_BAR_PAGES = 20;

/**
 * Split-adjusted SIP bars for one or more symbols, following next_page_token
 * (Alpaca's `limit` counts bars across all symbols on a page). `limit` caps the
 * bars kept per symbol, oldest first.
 */
export async function getBars(
  symbols: string[],
  timeframe: AlpacaTimeframe,
  start: string,
  end?: string,
  limit = 10000,
  ttl: number = timeframe === '1Day' || timeframe === '1Week' ? TTL.MACRO : TTL.QUOTES
): Promise<Record<string, OHLCV[]>> {
  const cacheKey = `alpaca:bars:${symbols.join(',')}:${timeframe}:${start}:${end}:${limit}:${ttl}`;

  return withCache(cacheKey, ttl, async () => {
    const out: Record<string, OHLCV[]> = Object.fromEntries(symbols.map((s) => [s, []]));
    const clampedEnd = historicalEnd(end);
    let pageToken: string | null = null;
    for (let page = 0; page < MAX_BAR_PAGES; page++) {
      const params = new URLSearchParams({
        symbols: symbols.join(','),
        timeframe,
        start,
        limit: '10000',
        adjustment: 'split',
        feed: 'sip',
        sort: 'asc',
        end: clampedEnd,
      });
      if (pageToken) params.set('page_token', pageToken);

      const data: AlpacaBarsResponse = await fetchJson<AlpacaBarsResponse>(
        `${config.alpaca.dataUrl}/v2/stocks/bars?${params}`,
        { headers: alpacaHeaders(), provider: 'Alpaca' }
      );
      for (const [symbol, bars] of Object.entries(data.bars ?? {})) {
        const list = out[symbol] ?? (out[symbol] = []);
        for (const bar of bars) {
          if (list.length >= limit) break;
          list.push({ date: bar.t, open: bar.o, high: bar.h, low: bar.l, close: bar.c, volume: bar.v });
        }
      }
      pageToken = data.next_page_token;
      if (!pageToken || symbols.every((s) => out[s].length >= limit)) break;
    }
    return out;
  });
}

export async function getHistoricalBars(
  symbol: string,
  timeframe: AlpacaTimeframe = '1Day',
  start?: string,
  end?: string,
  limit = 252
): Promise<OHLCV[]> {
  // Without a start Alpaca returns only today; default to enough calendar days
  // to hold `limit` bars of the requested size.
  const from = start || defaultStart(timeframe, limit);
  const bars = await getBars([symbol], timeframe, from, end, limit);
  return bars[symbol] ?? [];
}

function defaultStart(timeframe: AlpacaTimeframe, limit: number): string {
  const perDay: Record<AlpacaTimeframe, number> = { '1Min': 390, '5Min': 78, '15Min': 26, '1Hour': 7, '1Day': 1, '1Week': 0.2 };
  const calendarDays = Math.ceil((limit / perDay[timeframe]) * 1.5) + 7;
  return new Date(Date.now() - calendarDays * 86400000).toISOString().slice(0, 10);
}

export interface AlpacaSnapshot {
  latestTrade?: { t: string; p: number; s: number };
  latestQuote?: { ap: number; as: number; bp: number; bs: number; t: string };
  minuteBar?: AlpacaBar;
  dailyBar?: AlpacaBar;
  prevDailyBar?: AlpacaBar;
}

export async function getSnapshot(symbol: string): Promise<AlpacaSnapshot> {
  return withCache(`alpaca:snapshot:${symbol}`, TTL.QUOTES, () =>
    fetchJson<AlpacaSnapshot>(
      `${config.alpaca.dataUrl}/v2/stocks/${pathSegment(symbol)}/snapshot?feed=iex`,
      { headers: alpacaHeaders(), provider: 'Alpaca' }
    )
  );
}

/** Real-time IEX snapshots for many symbols in one request; each is cached individually. */
export async function getSnapshots(symbols: string[]): Promise<Record<string, AlpacaSnapshot>> {
  const missing = symbols.filter((s) => getCached(`alpaca:snapshot:${s}`) === null);
  if (missing.length > 0) {
    const params = new URLSearchParams({ symbols: missing.join(','), feed: 'iex' });
    const data = await fetchJson<Record<string, AlpacaSnapshot | null>>(
      `${config.alpaca.dataUrl}/v2/stocks/snapshots?${params}`,
      { headers: alpacaHeaders(), provider: 'Alpaca' }
    );
    for (const [symbol, snap] of Object.entries(data)) {
      if (snap) setCache(`alpaca:snapshot:${symbol}`, snap, TTL.QUOTES);
    }
  }
  const out: Record<string, AlpacaSnapshot> = {};
  for (const s of symbols) {
    const snap = getCached<AlpacaSnapshot>(`alpaca:snapshot:${s}`);
    if (snap) out[s] = snap;
  }
  return out;
}

// ─── Crypto (no plan restrictions) ───

export async function getCryptoBars(
  pair: string,
  timeframe: AlpacaTimeframe,
  start: string,
  end?: string,
  limit = 10000
): Promise<OHLCV[]> {
  return withCache(`alpaca:crypto:${pair}:${timeframe}:${start}:${end}:${limit}`, timeframe === '1Day' ? TTL.MACRO : TTL.QUOTES, async () => {
    const out: OHLCV[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < MAX_BAR_PAGES && out.length < limit; page++) {
      const params = new URLSearchParams({ symbols: pair, timeframe, start, limit: '10000', sort: 'asc' });
      if (end) params.set('end', /^\d{4}-\d{2}-\d{2}$/.test(end) ? `${end}T23:59:59Z` : end);
      if (pageToken) params.set('page_token', pageToken);
      const data: AlpacaBarsResponse = await fetchJson<AlpacaBarsResponse>(
        `${config.alpaca.dataUrl}/v1beta3/crypto/us/bars?${params}`,
        { provider: 'Alpaca' }
      );
      for (const bar of data.bars?.[pair] ?? []) {
        if (out.length >= limit) break;
        out.push({ date: bar.t, open: bar.o, high: bar.h, low: bar.l, close: bar.c, volume: bar.v });
      }
      pageToken = data.next_page_token;
      if (!pageToken) break;
    }
    return out;
  });
}

// ─── Corporate actions ───

export interface AlpacaCashDividend {
  symbol: string;
  rate: number;
  special: boolean;
  foreign: boolean;
  ex_date: string;
  record_date?: string;
  payable_date?: string;
  process_date: string;
}

interface AlpacaCorporateActionsResponse {
  corporate_actions: { cash_dividends?: AlpacaCashDividend[] };
  next_page_token: string | null;
}

export async function getCashDividends(symbols: string[], start: string, end: string): Promise<AlpacaCashDividend[]> {
  return withCache(`alpaca:dividends:${symbols.join(',')}:${start}:${end}`, TTL.FILINGS, async () => {
    const out: AlpacaCashDividend[] = [];
    let pageToken: string | null = null;
    for (let page = 0; page < MAX_BAR_PAGES; page++) {
      const params = new URLSearchParams({ symbols: symbols.join(','), types: 'cash_dividend', start, end, limit: '1000', sort: 'desc' });
      if (pageToken) params.set('page_token', pageToken);
      const data: AlpacaCorporateActionsResponse = await fetchJson<AlpacaCorporateActionsResponse>(
        `${config.alpaca.dataUrl}/v1/corporate-actions?${params}`,
        { headers: alpacaHeaders(), provider: 'Alpaca' }
      );
      out.push(...(data.corporate_actions?.cash_dividends ?? []));
      pageToken = data.next_page_token;
      if (!pageToken) break;
    }
    return out;
  });
}

// ─── News (Alpaca Data API) ───

export interface AlpacaNewsItem {
  id: number;
  headline: string;
  summary: string;
  author: string;
  created_at: string;
  updated_at: string;
  url: string;
  source: string;
  symbols: string[];
  images: Array<{ size: string; url: string }>;
}

export async function getNews(
  symbols?: string[],
  limit = 20
): Promise<AlpacaNewsItem[]> {
  const params = new URLSearchParams({ limit: limit.toString(), sort: 'desc' });
  if (symbols && symbols.length > 0) {
    params.set('symbols', symbols.join(','));
  }
  const cacheKey = `alpaca:news:${symbols?.join(',') || 'general'}:${limit}`;
  return withCache(cacheKey, TTL.NEWS, () =>
    fetchJson<{ news: AlpacaNewsItem[] }>(
      `${config.alpaca.dataUrl}/v1beta1/news?${params}`,
      { headers: alpacaHeaders(), provider: 'Alpaca' }
    ).then((res) => res.news)
  );
}
