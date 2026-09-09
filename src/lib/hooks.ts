'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import type { HoldingsPortfolio } from './holdings';
import type { FundamentalsScore } from './fundamentals-score';
import type { EconomicAssessment } from './economy';

interface UseApiOptions {
  refreshInterval?: number; // ms, 0 = no auto-refresh
  enabled?: boolean;
  timeoutMs?: number; // client-side request timeout (default: 60s)
}

interface UseApiResult<T> {
  data: T | null;
  error: string | null;
  /** Set when a background refresh fails after data was already loaded; `data` keeps the last good value. */
  refreshError: string | null;
  loading: boolean;
  refresh: () => void;
}

export function useApi<T>(
  url: string | null,
  options: UseApiOptions = {}
): UseApiResult<T> {
  const { refreshInterval = 0, enabled = true, timeoutMs = 60000 } = options;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const hasDataRef = useRef(false);
  const requestId = useRef(0);

  const fetchData = useCallback(async () => {
    if (!url || !enabled) { setLoading(false); return; }
    const id = ++requestId.current;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Only show loading skeleton on initial fetch, not background refreshes
      // This prevents the page from jumping to the top when data silently refreshes
      if (!hasDataRef.current) setLoading(true);
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${response.status}`);
      }
      const result = await response.json();
      if (id !== requestId.current) return;
      setData(result);
      hasDataRef.current = true;
      setError(null);
      setRefreshError(null);
    } catch (err) {
      if (id !== requestId.current) return;
      const message = err instanceof DOMException && err.name === 'AbortError'
        ? 'Request timed out'
        : err instanceof Error ? err.message : 'An error occurred';
      // Preserve the last successful value on a failed background refresh, but
      // expose the failure separately so pages can warn without unmounting.
      if (hasDataRef.current) setRefreshError(message);
      else setError(message);
    } finally {
      clearTimeout(timeout);
      if (id === requestId.current) setLoading(false);
    }
  }, [url, enabled, timeoutMs]);

  // Reset when URL changes (new data source)
  useEffect(() => {
    requestId.current++;
    hasDataRef.current = false;
    setData(null);
    setLoading(true);
    setError(null);
    setRefreshError(null);
  }, [url]);

  useEffect(() => {
    fetchData();

    if (refreshInterval > 0 && enabled) {
      const interval = setInterval(fetchData, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [fetchData, refreshInterval, enabled]);

  return { data, error, refreshError, loading, refresh: fetchData };
}

// Typed hooks for each API
export function useFredDashboard() {
  return useApi<Record<string, unknown>>('/api/fred?action=dashboard');
}

export function useFredSeries(seriesId: string, start?: string) {
  const url = start
    ? `/api/fred?action=series&id=${seriesId}&start=${start}`
    : `/api/fred?action=series&id=${seriesId}`;
  return useApi<Array<{ date: string; value: number }>>(url);
}

export function useReleaseCalendar() {
  return useApi<Array<{
    seriesId: string;
    name: string;
    releaseDate: string;
    frequency: string;
    source: string;
  }>>('/api/fred?action=release-calendar', { refreshInterval: 3600000 }); // re-check every hour
}

export function useYieldCurve() {
  return useApi<Array<{ id: string; value: number; date: string }>>(
    '/api/fred?action=yield-curve'
  );
}

// The regime action returns the full economic assessment (today's regime + the outlook).
export function useMacroRegime() {
  return useApi<EconomicAssessment>('/api/fred?action=regime');
}

export function usePortfolio() {
  return useApi<HoldingsPortfolio>('/api/alpaca?action=portfolio', { refreshInterval: 60000 });
}

export function useWatchlist() {
  return useApi<Array<{
    symbol: string;
    currentPrice: number;
    dayChange: number;
    dayChangePercent: number;
    category: string;
    open: number;
    high: number;
    low: number;
    volume: number;
  }>>('/api/alpaca?action=watchlist', { refreshInterval: 60000 });
}

export function useStockBars(symbol: string | null, timeframe = '1Day') {
  return useApi<Array<{ date: string; close: number; open: number; high: number; low: number; volume: number }>>(
    symbol ? `/api/alpaca?action=bars&symbol=${symbol}&timeframe=${timeframe}` : null
  );
}

export function useFinnhubQuote(symbol: string | null) {
  return useApi<{
    price: number;
    change: number;
    changePercent: number;
    high: number;
    low: number;
    open: number;
    prevClose: number;
  }>(symbol ? `/api/finnhub?action=quote&symbol=${symbol}` : null, {
    refreshInterval: 30000,
  });
}

export function useCompanyProfile(symbol: string | null) {
  return useApi<{
    name: string;
    ticker: string;
    exchange: string;
    finnhubIndustry: string;
    marketCapitalization: number;
    logo: string;
    weburl: string;
    country: string;
    ipo: string;
    shareOutstanding: number;
  }>(symbol ? `/api/finnhub?action=profile&symbol=${symbol}` : null);
}

export function useCompanyNews(symbol: string | null) {
  return useApi<Array<{
    headline: string;
    source: string;
    url: string;
    datetime: number;
    summary: string;
    image: string;
  }>>(symbol ? `/api/finnhub?action=news&symbol=${symbol}` : null);
}

export function useMarketNews() {
  return useApi<Array<{
    headline: string;
    source: string;
    url: string;
    datetime: number;
    summary: string;
    image: string;
  }>>('/api/finnhub?action=news&category=general');
}

export function useCompanyFundamentals(ticker: string | null) {
  return useApi<{
    fundamentals: {
      entityName: string;
      revenue: Array<{ period: string; endDate: string; value: number }>;
      netIncome: Array<{ period: string; endDate: string; value: number }>;
      eps: Array<{ period: string; endDate: string; value: number }>;
      grossProfit: Array<{ period: string; endDate: string; value: number }>;
      operatingIncome: Array<{ period: string; endDate: string; value: number }>;
      totalAssets: Array<{ period: string; endDate: string; value: number }>;
      totalLiabilities: Array<{ period: string; endDate: string; value: number }>;
      stockholdersEquity: Array<{ period: string; endDate: string; value: number }>;
      cash: Array<{ period: string; endDate: string; value: number }>;
      longTermDebt: Array<{ period: string; endDate: string; value: number }>;
    };
    metrics: {
      ttmRevenue: number | null;
      ttmNetIncome: number | null;
      ttmEPS: number | null;
      grossMargin: number | null;
      operatingMargin: number | null;
      netMargin: number | null;
      debtToEquity: number | null;
    };
  }>(ticker ? `/api/edgar?action=fundamentals&ticker=${ticker}` : null);
}

export function useCompanyFilings(ticker: string | null) {
  return useApi<Array<{
    accessionNumber: string;
    form: string;
    filingDate: string;
    reportDate: string;
    primaryDocDescription: string;
    fileUrl: string;
  }>>(ticker ? `/api/edgar?action=filings&ticker=${ticker}` : null);
}

export function useEarnings(symbol: string | null) {
  return useApi<Array<{
    actual: number | null;
    estimate: number | null;
    period: string;
    surprise: number | null;
    surprisePercent: number | null;
  }>>(symbol ? `/api/finnhub?action=earnings&symbol=${symbol}` : null);
}

export function usePortfolioChart(period: string = '1Y') {
  return useApi<Array<{ date: string; value: number }>>(
    `/api/alpaca?action=portfolio-chart&period=${period}`
  );
}

// ─── Polygon Hooks ───

export function usePolygonAggregates(
  symbol: string | null,
  timeframe: string = '1day'
) {
  return useApi<Array<{
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>>(
    symbol
      ? `/api/polygon?action=aggregates&symbol=${symbol}&timeframe=${timeframe}`
      : null,
    { refreshInterval: timeframe === '1day' ? 0 : 60000 }
  );
}

export function usePolygonRSI(symbol: string | null) {
  return useApi<Array<{ date: string; value: number }>>(
    symbol ? `/api/polygon?action=rsi&symbol=${symbol}` : null
  );
}

export function usePolygonMACD(symbol: string | null) {
  return useApi<Array<{
    date: string;
    macd: number;
    signal: number;
    histogram: number;
  }>>(symbol ? `/api/polygon?action=macd&symbol=${symbol}` : null);
}

export function useWma200(symbols: string[]) {
  const syms = symbols.length > 0 ? symbols.join(',') : null;
  return useApi<Array<{ symbol: string; wma200: number | null }>>(
    syms ? `/api/polygon?action=wma200&symbols=${syms}` : null
  );
}

export function usePolygonSMA(symbol: string | null, window = 50) {
  return useApi<Array<{ date: string; value: number }>>(
    symbol ? `/api/polygon?action=sma&symbol=${symbol}&window=${window}` : null
  );
}

export function useMultiAggregates(
  symbols: string[],
  timeframe: string = '1day',
  from?: string,
  to?: string
) {
  const syms = symbols.join(',');
  const params = new URLSearchParams({ action: 'multi-aggregates', symbols: syms, timeframe });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  return useApi<Array<{
    symbol: string;
    data: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>;
  }>>(syms ? `/api/polygon?${params.toString()}` : null);
}

export function usePortfolioDividends(symbols: string[]) {
  const syms = symbols.filter((s) => s !== 'BTC').join(',');
  return useApi<Array<{
    ticker: string;
    amount: number;
    exDate: string;
    payDate: string;
    declarationDate: string;
    frequency: number;
    type: string;
  }>>(syms ? `/api/polygon?action=portfolio-dividends&symbols=${syms}` : null);
}

// ─── Fundamentals Score ───

export function useFundamentalsScores(symbols: string[]) {
  const syms = symbols.join(',');
  // Type lives with the scoring engine — type-only import, erased at build
  return useApi<FundamentalsScore[]>(syms ? `/api/finnhub?action=fundamentals-score&symbols=${syms}` : null);
}
