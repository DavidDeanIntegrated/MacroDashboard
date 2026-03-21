// Yahoo Finance API client for market indices not available on FRED
// Used for: MOVE Index (bond volatility)

import { withCache, TTL } from './cache';

interface YahooChartResult {
  chart: {
    result: Array<{
      timestamp: number[];
      indicators: {
        quote: Array<{
          close: (number | null)[];
        }>;
      };
    }>;
    error: { code: string; description: string } | null;
  };
}

export interface TimeSeriesPoint {
  date: string;
  value: number;
}

/**
 * Fetch historical daily data for a Yahoo Finance ticker.
 * Returns array of { date, value } using closing prices.
 */
export async function getYahooSeries(
  ticker: string,
  range = '5y',
  interval = '1d'
): Promise<TimeSeriesPoint[]> {
  const cacheKey = `yahoo:${ticker}:${range}:${interval}`;

  return withCache(cacheKey, TTL.MACRO, async () => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=${interval}&includePrePost=false`;

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MacroDashboard/1.0)',
      },
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      throw new Error(`Yahoo Finance API error: ${response.status} ${response.statusText}`);
    }

    const data: YahooChartResult = await response.json();

    if (data.chart.error) {
      throw new Error(`Yahoo Finance: ${data.chart.error.description}`);
    }

    const result = data.chart.result?.[0];
    if (!result || !result.timestamp || !result.indicators?.quote?.[0]?.close) {
      return [];
    }

    const timestamps = result.timestamp;
    const closes = result.indicators.quote[0].close;

    const points: TimeSeriesPoint[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i];
      if (close != null && isFinite(close)) {
        const date = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
        points.push({ date, value: close });
      }
    }

    return points;
  });
}
