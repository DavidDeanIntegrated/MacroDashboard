// Finnhub API client — Quotes, News, Company Info
// Docs: https://finnhub.io/docs/api

import { config } from './config';
import { fetchJson } from './fetcher';
import { withCache, TTL } from './cache';

function finnhubUrl(path: string, params: Record<string, string> = {}) {
  const searchParams = new URLSearchParams({
    ...params,
    token: config.finnhub.apiKey,
  });
  return `${config.finnhub.baseUrl}${path}?${searchParams}`;
}

// ─── Quote ───

export interface FinnhubQuote {
  c: number;  // current price
  d: number;  // change
  dp: number; // percent change
  h: number;  // high of day
  l: number;  // low of day
  o: number;  // open
  pc: number; // previous close
  t: number;  // timestamp
}

export interface Quote {
  price: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  open: number;
  prevClose: number;
  timestamp: number;
}

export async function getQuote(symbol: string): Promise<Quote> {
  return withCache(`finnhub:quote:${symbol}`, TTL.QUOTES, async () => {
    const data = await fetchJson<FinnhubQuote>(
      finnhubUrl('/quote', { symbol }),
      { provider: 'Finnhub' }
    );

    return {
      price: data.c,
      change: data.d,
      changePercent: data.dp,
      high: data.h,
      low: data.l,
      open: data.o,
      prevClose: data.pc,
      timestamp: data.t,
    };
  });
}

// ─── Company Profile ───

export interface CompanyProfile {
  country: string;
  currency: string;
  exchange: string;
  finnhubIndustry: string;
  ipo: string;
  logo: string;
  marketCapitalization: number;
  name: string;
  phone: string;
  shareOutstanding: number;
  ticker: string;
  weburl: string;
}

export async function getCompanyProfile(
  symbol: string
): Promise<CompanyProfile> {
  return withCache(`finnhub:profile:${symbol}`, TTL.FUNDAMENTALS, () =>
    fetchJson<CompanyProfile>(
      finnhubUrl('/stock/profile2', { symbol }),
      { provider: 'Finnhub' }
    )
  );
}

// ─── News ───

export interface NewsItem {
  category: string;
  datetime: number;
  headline: string;
  id: number;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

export async function getCompanyNews(
  symbol: string,
  daysBack = 7
): Promise<NewsItem[]> {
  return withCache(`finnhub:news:${symbol}:${daysBack}`, TTL.NEWS, async () => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - daysBack);

    const formatDate = (d: Date) => d.toISOString().split('T')[0];

    return fetchJson<NewsItem[]>(
      finnhubUrl('/company-news', {
        symbol,
        from: formatDate(from),
        to: formatDate(to),
      }),
      { provider: 'Finnhub' }
    );
  });
}

export async function getMarketNews(
  category: 'general' | 'forex' | 'crypto' | 'merger' = 'general'
): Promise<NewsItem[]> {
  return withCache(`finnhub:marketnews:${category}`, TTL.NEWS, () =>
    fetchJson<NewsItem[]>(
      finnhubUrl('/news', { category }),
      { provider: 'Finnhub' }
    )
  );
}

// ─── Candles (OHLCV) ───

interface CandleResponse {
  c: number[];
  h: number[];
  l: number[];
  o: number[];
  s: string;
  t: number[];
  v: number[];
}

export interface CandleData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function getCandles(
  symbol: string,
  resolution: '1' | '5' | '15' | '30' | '60' | 'D' | 'W' | 'M' = 'D',
  from?: number,
  to?: number
): Promise<CandleData[]> {
  const now = Math.floor(Date.now() / 1000);
  const defaultFrom = now - 365 * 24 * 60 * 60; // 1 year back

  return withCache(
    `finnhub:candles:${symbol}:${resolution}:${from}:${to}`,
    resolution === 'D' || resolution === 'W' || resolution === 'M'
      ? TTL.MACRO
      : TTL.QUOTES,
    async () => {
      const data = await fetchJson<CandleResponse>(
        finnhubUrl('/stock/candle', {
          symbol,
          resolution,
          from: String(from || defaultFrom),
          to: String(to || now),
        }),
        { provider: 'Finnhub' }
      );

      if (data.s !== 'ok' || !data.t) return [];

      return data.t.map((timestamp, i) => ({
        date: new Date(timestamp * 1000).toISOString().split('T')[0],
        open: data.o[i],
        high: data.h[i],
        low: data.l[i],
        close: data.c[i],
        volume: data.v[i],
      }));
    }
  );
}

// ─── Insider Transactions ───

export interface InsiderTransaction {
  name: string;
  share: number;
  change: number;
  filingDate: string;
  transactionDate: string;
  transactionCode: string;
  transactionPrice: number;
}

export async function getInsiderTransactions(
  symbol: string
): Promise<InsiderTransaction[]> {
  return withCache(`finnhub:insider:${symbol}`, TTL.NEWS, async () => {
    const data = await fetchJson<{ data: InsiderTransaction[] }>(
      finnhubUrl('/stock/insider-transactions', { symbol }),
      { provider: 'Finnhub' }
    );
    return data.data || [];
  });
}

// ─── Earnings ───

export interface EarningsEstimate {
  actual: number | null;
  estimate: number | null;
  period: string;
  quarter: number;
  surprise: number | null;
  surprisePercent: number | null;
  symbol: string;
  year: number;
}

export async function getEarnings(
  symbol: string
): Promise<EarningsEstimate[]> {
  return withCache(`finnhub:earnings:${symbol}`, TTL.FUNDAMENTALS, () =>
    fetchJson<EarningsEstimate[]>(
      finnhubUrl('/stock/earnings', { symbol }),
      { provider: 'Finnhub' }
    )
  );
}
