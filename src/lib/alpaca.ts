// Alpaca API client — Brokerage + Market Data
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

// ─── Account & Positions ───

export interface AlpacaAccount {
  id: string;
  account_number: string;
  status: string;
  currency: string;
  buying_power: string;
  cash: string;
  portfolio_value: string;
  equity: string;
  last_equity: string;
  long_market_value: string;
  short_market_value: string;
  initial_margin: string;
  maintenance_margin: string;
  daytrade_count: number;
  pattern_day_trader: boolean;
}

export interface AlpacaPosition {
  asset_id: string;
  symbol: string;
  exchange: string;
  asset_class: string;
  qty: string;
  avg_entry_price: string;
  side: string;
  market_value: string;
  cost_basis: string;
  unrealized_pl: string;
  unrealized_plpc: string;
  unrealized_intraday_pl: string;
  unrealized_intraday_plpc: string;
  current_price: string;
  lastday_price: string;
  change_today: string;
}

export async function getAccount(): Promise<AlpacaAccount> {
  return withCache('alpaca:account', TTL.PORTFOLIO, () =>
    fetchJson<AlpacaAccount>(`${config.alpaca.baseUrl}/v2/account`, {
      headers: alpacaHeaders(),
      provider: 'Alpaca',
    })
  );
}

export async function getPositions(): Promise<AlpacaPosition[]> {
  return withCache('alpaca:positions', TTL.PORTFOLIO, () =>
    fetchJson<AlpacaPosition[]>(`${config.alpaca.baseUrl}/v2/positions`, {
      headers: alpacaHeaders(),
      provider: 'Alpaca',
    })
  );
}

// NOTE: order submission/cancel/list endpoints were removed 2026-08-11 — the app
// is a read-only dashboard (holdings tracked in lib/holdings.ts), and exposing
// live trading through a public API route was unused risk surface.

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

// ─── Portfolio Analytics ───

export interface PortfolioSummary {
  equity: number;
  cash: number;
  buyingPower: number;
  portfolioValue: number;
  dayChange: number;
  dayChangePercent: number;
  positions: PositionSummary[];
  totalUnrealizedPL: number;
  totalUnrealizedPLPercent: number;
}

export interface PositionSummary {
  symbol: string;
  qty: number;
  avgEntry: number;
  currentPrice: number;
  marketValue: number;
  costBasis: number;
  unrealizedPL: number;
  unrealizedPLPercent: number;
  intradayPL: number;
  intradayPLPercent: number;
  weight: number;
  side: string;
}

export async function getPortfolioSummary(): Promise<PortfolioSummary> {
  const [account, positions] = await Promise.all([
    getAccount(),
    getPositions(),
  ]);

  const equity = parseFloat(account.equity);
  const portfolioValue = parseFloat(account.portfolio_value);

  const positionSummaries: PositionSummary[] = positions.map((p) => ({
    symbol: p.symbol,
    qty: parseFloat(p.qty),
    avgEntry: parseFloat(p.avg_entry_price),
    currentPrice: parseFloat(p.current_price),
    marketValue: parseFloat(p.market_value),
    costBasis: parseFloat(p.cost_basis),
    unrealizedPL: parseFloat(p.unrealized_pl),
    unrealizedPLPercent: parseFloat(p.unrealized_plpc) * 100,
    intradayPL: parseFloat(p.unrealized_intraday_pl),
    intradayPLPercent: parseFloat(p.unrealized_intraday_plpc) * 100,
    weight: portfolioValue > 0 ? (parseFloat(p.market_value) / portfolioValue) * 100 : 0,
    side: p.side,
  }));

  const totalUnrealizedPL = positionSummaries.reduce((sum, p) => sum + p.unrealizedPL, 0);
  const totalCostBasis = positionSummaries.reduce((sum, p) => sum + p.costBasis, 0);

  return {
    equity,
    cash: parseFloat(account.cash),
    buyingPower: parseFloat(account.buying_power),
    portfolioValue,
    dayChange: equity - parseFloat(account.last_equity),
    dayChangePercent:
      parseFloat(account.last_equity) > 0
        ? ((equity - parseFloat(account.last_equity)) / parseFloat(account.last_equity)) * 100
        : 0,
    positions: positionSummaries.sort((a, b) => b.marketValue - a.marketValue),
    totalUnrealizedPL,
    totalUnrealizedPLPercent:
      totalCostBasis > 0 ? (totalUnrealizedPL / totalCostBasis) * 100 : 0,
  };
}
