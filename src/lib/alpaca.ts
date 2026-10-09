// Alpaca API client — market data only (prices, bars, news).
// No brokerage account, position or order endpoints: this dashboard is public.
// Docs: https://docs.alpaca.markets/

import { config } from './config';
import { fetchJson } from './fetcher';
import { withCache, TTL } from './cache';

function alpacaHeaders() {
  return {
    'APCA-API-KEY-ID': config.alpaca.apiKey,
    'APCA-API-SECRET-KEY': config.alpaca.apiSecret,
    'Content-Type': 'application/json',
  };
}

// NOTE: order endpoints were removed 2026-08-11 and account/position reads on
// 2026-10-09 — the app is a public read-only dashboard (holdings tracked in
// lib/holdings.ts), so brokerage data and actions are unused risk surface.

// ─── Market Data (Alpaca Data API) ───

export interface AlpacaBar {
  t: string; // timestamp
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
}

interface AlpacaBarsResponse {
  bars: Record<string, AlpacaBar[]>;
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

export async function getHistoricalBars(
  symbol: string,
  timeframe: '1Day' | '1Hour' | '15Min' | '5Min' | '1Min' = '1Day',
  start?: string,
  end?: string,
  limit = 252
): Promise<OHLCV[]> {
  const cacheKey = `alpaca:bars:${symbol}:${timeframe}:${start}:${end}:${limit}`;
  const ttl = timeframe === '1Day' ? TTL.MACRO : TTL.QUOTES;

  return withCache(cacheKey, ttl, async () => {
    const params = new URLSearchParams({
      symbols: symbol,
      timeframe,
      limit: limit.toString(),
      feed: 'iex',
      sort: 'asc',
    });

    if (start) params.set('start', start);
    if (end) params.set('end', end);

    const data = await fetchJson<AlpacaBarsResponse>(
      `${config.alpaca.dataUrl}/v2/stocks/bars?${params}`,
      { headers: alpacaHeaders(), provider: 'Alpaca' }
    );

    const bars = data.bars[symbol] || [];
    return bars.map((bar) => ({
      date: bar.t,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
    }));
  });
}

export interface AlpacaSnapshot {
  latestTrade: { t: string; p: number; s: number };
  latestQuote: { ap: number; as: number; bp: number; bs: number; t: string };
  minuteBar: AlpacaBar;
  dailyBar: AlpacaBar;
  prevDailyBar: AlpacaBar;
}

export async function getSnapshot(symbol: string): Promise<AlpacaSnapshot> {
  return withCache(`alpaca:snapshot:${symbol}`, TTL.QUOTES, () =>
    fetchJson<AlpacaSnapshot>(
      `${config.alpaca.dataUrl}/v2/stocks/${symbol}/snapshot?feed=iex`,
      { headers: alpacaHeaders(), provider: 'Alpaca' }
    )
  );
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
