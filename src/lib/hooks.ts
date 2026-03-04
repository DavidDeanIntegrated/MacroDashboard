'use client';

import { useState, useEffect, useCallback } from 'react';

interface UseApiOptions {
  refreshInterval?: number; // ms, 0 = no auto-refresh
  enabled?: boolean;
}

interface UseApiResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

export function useApi<T>(
  url: string | null,
  options: UseApiOptions = {}
): UseApiResult<T> {
  const { refreshInterval = 0, enabled = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!url || !enabled) return;

    try {
      setLoading(true);
      const response = await fetch(url);
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${response.status}`);
      }
      const result = await response.json();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [url, enabled]);

  useEffect(() => {
    fetchData();

    if (refreshInterval > 0 && enabled) {
      const interval = setInterval(fetchData, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [fetchData, refreshInterval, enabled]);

  return { data, error, loading, refresh: fetchData };
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

export function useYieldCurve() {
  return useApi<Array<{ id: string; value: number; date: string }>>(
    '/api/fred?action=yield-curve'
  );
}

export function useMacroRegime() {
  return useApi<{
    regime: string;
    label: string;
    description: string;
    inflationTrend: string;
    growthTrend: string;
    latestInflation: number;
    latestUnemployment: number;
  }>('/api/fred?action=regime');
}

export function usePortfolio() {
  return useApi<{
    equity: number;
    cash: number;
    buyingPower: number;
    portfolioValue: number;
    dayChange: number;
    dayChangePercent: number;
    positions: Array<{
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
    }>;
    totalUnrealizedPL: number;
    totalUnrealizedPLPercent: number;
  }>('/api/alpaca?action=portfolio', { refreshInterval: 60000 });
}

export function useOrders(status: 'open' | 'closed' | 'all' = 'all') {
  return useApi<Array<{
    id: string;
    symbol: string;
    qty: string;
    side: string;
    type: string;
    status: string;
    created_at: string;
    filled_at: string | null;
    filled_avg_price: string | null;
    limit_price: string | null;
  }>>(`/api/alpaca?action=orders&status=${status}`);
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
