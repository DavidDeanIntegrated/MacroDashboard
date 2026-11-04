// Market data for charts, indicators and dividends, served from Alpaca's free
// plan (replaces the Massive / Polygon.io client). Shapes match what the pages
// already consume: OHLCV bars, indicator points with ISO timestamps, dividends.

import {
  getBars,
  getCryptoBars,
  getCashDividends,
  getSnapshots,
  type AlpacaSnapshot,
  type AlpacaTimeframe,
  type AlpacaCashDividend,
  type OHLCV,
} from './alpaca';
import { computeSMA, computeEMA, computeRSI, computeMACD, type IndicatorBar } from './indicators';
import { withCache, TTL } from './cache';

export type { OHLCV } from './alpaca';

export type MarketTimeframe = '1min' | '5min' | '15min' | '1hour' | '1day';
export type IndicatorTimespan = 'day' | 'hour' | 'minute';

const ALPACA_TIMEFRAME: Record<MarketTimeframe, AlpacaTimeframe> = {
  '1min': '1Min',
  '5min': '5Min',
  '15min': '15Min',
  '1hour': '1Hour',
  '1day': '1Day',
};

// Default lookback in days for each timeframe
const LOOKBACK_DAYS: Record<MarketTimeframe, number> = {
  '1min': 1,
  '5min': 5,
  '15min': 10,
  '1hour': 30,
  '1day': 365,
};

const BTC_PAIR = 'BTC/USD';
const isBtc = (symbol: string) => symbol === 'BTC' || symbol === 'X:BTCUSD';

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

// Daily bars are keyed by trading date; intraday bars keep a full timestamp.
function normalize(bars: OHLCV[], timeframe: MarketTimeframe): OHLCV[] {
  return bars.map((b) => ({
    ...b,
    date: timeframe === '1day' ? b.date.slice(0, 10) : new Date(b.date).toISOString(),
  }));
}

// ─── Aggregates (Bars) ───

export async function getAggregates(
  symbol: string,
  timeframe: MarketTimeframe = '1day',
  from?: string,
  to?: string,
  limit = 500
): Promise<OHLCV[]> {
  const start = from || daysAgo(LOOKBACK_DAYS[timeframe]);
  const tf = ALPACA_TIMEFRAME[timeframe];
  const bars = isBtc(symbol)
    ? await getCryptoBars(BTC_PAIR, tf, start, to, limit)
    : (await getBars([symbol], tf, start, to, limit))[symbol] ?? [];
  return normalize(bars, timeframe);
}

/** Bars for many symbols with one paginated request (BTC fetched separately). */
export async function getMultiAggregates(
  symbols: string[],
  timeframe: MarketTimeframe = '1day',
  from?: string,
  to?: string,
  limit = 500
): Promise<Array<{ symbol: string; data: OHLCV[] }>> {
  const start = from || daysAgo(LOOKBACK_DAYS[timeframe]);
  const stocks = symbols.filter((s) => !isBtc(s));
  const [stockBars, btcBars] = await Promise.all([
    stocks.length > 0
      ? getBars(stocks, ALPACA_TIMEFRAME[timeframe], start, to, limit)
      : Promise.resolve({} as Record<string, OHLCV[]>),
    symbols.some(isBtc)
      ? getCryptoBars(BTC_PAIR, ALPACA_TIMEFRAME[timeframe], start, to, limit).catch(() => [])
      : Promise.resolve([] as OHLCV[]),
  ]);
  return symbols.map((symbol) => ({
    symbol,
    data: normalize(isBtc(symbol) ? btcBars : stockBars[symbol] ?? [], timeframe),
  }));
}

// ─── Snapshot ───

export interface MarketSnapshot {
  price: number;
  asOf: string | null;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  volume: number;
}

function etDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}

/**
 * Map an IEX snapshot to a quote. Before the open, `dailyBar` is still the last
 * session while `latestTrade` may be a pre-market print, so the previous close
 * is whichever completed session precedes the trade. Returns null when the
 * snapshot lacks a trade or a previous close (thinly traded on IEX).
 */
export function snapshotFromAlpaca(s: AlpacaSnapshot | undefined): MarketSnapshot | null {
  const trade = s?.latestTrade;
  if (!trade?.p || !trade.t) return null;
  const tradeDay = etDate(trade.t);
  const daily = s?.dailyBar && etDate(s.dailyBar.t) === tradeDay ? s.dailyBar : null;
  const prev = daily ? s?.prevDailyBar : s?.dailyBar && etDate(s.dailyBar.t) < tradeDay ? s.dailyBar : s?.prevDailyBar;
  const prevClose = prev?.c ?? 0;
  if (!prevClose) return null;
  return {
    price: trade.p,
    asOf: new Date(trade.t).toISOString(),
    change: trade.p - prevClose,
    changePercent: ((trade.p - prevClose) / prevClose) * 100,
    open: daily?.o ?? 0,
    high: daily?.h ?? 0,
    low: daily?.l ?? 0,
    prevClose,
    volume: daily?.v ?? 0,
  };
}

// Fallback when IEX has no usable print: the last two full-market daily bars
// (Basic-plan SIP data, at most ~15 minutes behind).
async function snapshotFromDailyBars(symbol: string): Promise<MarketSnapshot | null> {
  // Quote-length cache: this stands in for a live price.
  const bars = (await getBars([symbol], '1Day', daysAgo(14), undefined, 30, TTL.QUOTES))[symbol] ?? [];
  if (bars.length < 2) return null;
  const last = bars[bars.length - 1];
  const prevClose = bars[bars.length - 2].close;
  return {
    price: last.close,
    asOf: new Date(last.date).toISOString(),
    change: last.close - prevClose,
    changePercent: ((last.close - prevClose) / prevClose) * 100,
    open: last.open,
    high: last.high,
    low: last.low,
    prevClose,
    volume: last.volume,
  };
}

/** Quotes for many symbols: one batched IEX request, daily-bar fallback per gap. */
export async function getQuotes(symbols: string[]): Promise<Record<string, MarketSnapshot>> {
  const snaps = await getSnapshots(symbols);
  const out: Record<string, MarketSnapshot> = {};
  await Promise.all(symbols.map(async (symbol) => {
    const quote = snapshotFromAlpaca(snaps[symbol]) ?? await snapshotFromDailyBars(symbol).catch(() => null);
    if (quote) out[symbol] = quote;
  }));
  return out;
}

export async function getSnapshot(symbol: string): Promise<MarketSnapshot> {
  const quote = (await getQuotes([symbol]))[symbol];
  if (!quote) throw new Error(`No Alpaca quote for ${symbol}`);
  return quote;
}

// ─── Technical Indicators ───
// Computed from bars. A full year of extra history ahead of the returned
// window lets the exponential averages settle (checked against Massive's
// server-side values: identical once warmed up).

export interface TechnicalIndicatorPoint {
  date: string;
  value: number;
}

export interface MACDPoint {
  date: string;
  macd: number;
  signal: number;
  histogram: number;
}

const WARMUP_BARS = 250;
const BARS_PER_DAY: Record<IndicatorTimespan, number> = { day: 1, hour: 7, minute: 390 };
const TIMESPAN_TIMEFRAME: Record<IndicatorTimespan, AlpacaTimeframe> = { day: '1Day', hour: '1Hour', minute: '1Min' };

async function indicatorBars(symbol: string, timespan: IndicatorTimespan, needed: number): Promise<IndicatorBar[]> {
  // Trading days → calendar days (weekends/holidays) with a small buffer.
  // Daily requests share one floor so RSI, MACD and both SMAs reuse a single cached fetch.
  const calendarDays = Math.max(Math.ceil((needed / BARS_PER_DAY[timespan]) * 1.5) + 7, timespan === 'day' ? 800 : 0);
  const start = daysAgo(calendarDays);
  const tf = TIMESPAN_TIMEFRAME[timespan];
  const bars = isBtc(symbol)
    ? await getCryptoBars(BTC_PAIR, tf, start)
    : (await getBars([symbol], tf, start))[symbol] ?? [];
  return bars.map((b) => ({ date: new Date(b.date).toISOString(), close: b.close }));
}

function lastN<T>(points: T[], limit: number): T[] {
  return points.slice(Math.max(0, points.length - limit));
}

export async function getSMA(symbol: string, window = 50, timespan: IndicatorTimespan = 'day', limit = 120): Promise<TechnicalIndicatorPoint[]> {
  const bars = await indicatorBars(symbol, timespan, window + limit);
  return lastN(computeSMA(bars, window), limit);
}

export async function getEMA(symbol: string, window = 20, timespan: IndicatorTimespan = 'day', limit = 120): Promise<TechnicalIndicatorPoint[]> {
  const bars = await indicatorBars(symbol, timespan, window + limit + WARMUP_BARS);
  return lastN(computeEMA(bars, window), limit);
}

export async function getRSI(symbol: string, window = 14, timespan: IndicatorTimespan = 'day', limit = 120): Promise<TechnicalIndicatorPoint[]> {
  const bars = await indicatorBars(symbol, timespan, window + limit + WARMUP_BARS);
  return lastN(computeRSI(bars, window), limit);
}

export async function getMACD(
  symbol: string,
  shortWindow = 12,
  longWindow = 26,
  signalWindow = 9,
  timespan: IndicatorTimespan = 'day',
  limit = 120
): Promise<MACDPoint[]> {
  const bars = await indicatorBars(symbol, timespan, longWindow + signalWindow + limit + WARMUP_BARS);
  return lastN(computeMACD(bars, shortWindow, longWindow, signalWindow), limit);
}

// Latest 200-week simple moving average — the ~4-year full-cycle price anchor —
// from weekly bars, batched for all symbols. null when a symbol has fewer than
// 200 weeks of history (recent IPOs) or the request fails, so callers render
// "n/a" instead of breaking.
export async function getWeeklySMA200s(symbols: string[]): Promise<Record<string, number | null>> {
  const out: Record<string, number | null> = Object.fromEntries(symbols.map((s) => [s, null]));
  if (symbols.length === 0) return out;
  return withCache(`market:wma200:${symbols.join(',')}`, TTL.MACRO, async () => {
    try {
      const weekly = await getBars(symbols, '1Week', daysAgo(210 * 7));
      for (const symbol of symbols) {
        const closes = (weekly[symbol] ?? []).map((b) => b.close);
        if (closes.length < 200) continue;
        const last200 = closes.slice(-200);
        const v = last200.reduce((s, c) => s + c, 0) / 200;
        out[symbol] = Number.isFinite(v) && v > 0 ? v : null;
      }
    } catch {
      // leave every symbol null
    }
    return out;
  });
}

// ─── Dividends ───

export interface Dividend {
  ticker: string;
  amount: number;
  exDate: string;
  payDate: string;
  declarationDate: string;
  frequency: number; // 1=annual, 2=semi, 4=quarterly, 12=monthly
  type: string;
}

// Alpaca's corporate actions carry no payout frequency; infer it from the
// median gap between regular ex-dates.
export function inferFrequency(exDates: string[]): number {
  const times = exDates.map((d) => Date.parse(d)).filter(Number.isFinite).sort((a, b) => a - b);
  if (times.length < 2) return 0;
  const gaps = times.slice(1).map((t, i) => (t - times[i]) / 86400000).sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  if (median < 45) return 12;
  if (median < 135) return 4;
  if (median < 270) return 2;
  return 1;
}

function toDividends(rows: AlpacaCashDividend[]): Dividend[] {
  const regularDates = new Map<string, string[]>();
  for (const r of rows) {
    if (r.special) continue;
    const list = regularDates.get(r.symbol) ?? [];
    list.push(r.ex_date);
    regularDates.set(r.symbol, list);
  }
  return rows
    .map((r) => ({
      ticker: r.symbol,
      amount: r.rate,
      exDate: r.ex_date,
      payDate: r.payable_date ?? '',
      declarationDate: '',
      frequency: r.special ? 0 : inferFrequency(regularDates.get(r.symbol) ?? []),
      type: r.special ? 'SC' : 'CD',
    }))
    .sort((a, b) => b.exDate.localeCompare(a.exDate));
}

// Three years back covers 12 monthly payouts with room to infer frequency;
// announced ex-dates can sit a few months ahead.
function dividendWindow(): { start: string; end: string } {
  return { start: daysAgo(3 * 365), end: daysAgo(-120) };
}

export async function getDividends(symbol: string, limit = 12): Promise<Dividend[]> {
  const { start, end } = dividendWindow();
  return toDividends(await getCashDividends([symbol], start, end)).slice(0, limit);
}

/** Most recent `perSymbol` dividends for each symbol, newest first, in one request. */
export async function getPortfolioDividends(symbols: string[], perSymbol = 4): Promise<Dividend[]> {
  if (symbols.length === 0) return [];
  const { start, end } = dividendWindow();
  const all = toDividends(await getCashDividends(symbols, start, end));
  const counts = new Map<string, number>();
  return all.filter((d) => {
    const n = counts.get(d.ticker) ?? 0;
    counts.set(d.ticker, n + 1);
    return n < perSymbol;
  });
}
