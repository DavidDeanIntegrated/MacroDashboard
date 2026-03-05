// Static portfolio holdings — manually maintained
// Update quantities here when rebalancing

import { getSnapshot as getAlpacaSnapshot, getHistoricalBars } from './alpaca';
import { getSnapshot as getPolygonSnapshot } from './polygon';
import { fetchJson } from './fetcher';
import { withCache, TTL } from './cache';

export interface Holding {
  symbol: string;
  qty: number;
  category: string;
}

export const HOLDINGS: Holding[] = [
  { symbol: 'BTC',  qty: 0.00716019, category: 'Crypto' },
  { symbol: 'VTI',  qty: 2.385068,   category: 'Broad Market' },
  { symbol: 'SGOV', qty: 6.034963,   category: 'Dry Powder' },
  { symbol: 'GLD',  qty: 0.987421,   category: 'Gold' },
  { symbol: 'VTV',  qty: 1.495409,   category: 'Value' },
  { symbol: 'VXUS', qty: 2.729559,   category: 'International' },
  { symbol: 'NVDA', qty: 1.069294,   category: 'Quality Compounder' },
  { symbol: 'TSM',  qty: 0.493206,   category: 'Quality Compounder' },
  { symbol: 'MSFT', qty: 0.466907,   category: 'Quality Compounder' },
  { symbol: 'BCI',  qty: 7.057182,   category: 'Commodity' },
  { symbol: 'PLTR', qty: 1.041579,   category: 'High Conviction' },
  { symbol: 'RKLB', qty: 1.700972,   category: 'High Conviction' },
];

// Category display order and badge variants
export const CATEGORY_CONFIG: Record<string, { order: number; badge: 'blue' | 'purple' | 'orange' | 'green' | 'yellow' | 'red' | 'neutral' }> = {
  'Broad Market':       { order: 0, badge: 'blue' },
  'Quality Compounder': { order: 1, badge: 'purple' },
  'High Conviction':    { order: 2, badge: 'orange' },
  'Value':              { order: 3, badge: 'green' },
  'International':      { order: 4, badge: 'blue' },
  'Gold':               { order: 5, badge: 'yellow' },
  'Commodity':          { order: 6, badge: 'orange' },
  'Crypto':             { order: 7, badge: 'red' },
  'Dry Powder':         { order: 8, badge: 'neutral' },
};

export interface HoldingPosition {
  symbol: string;
  qty: number;
  currentPrice: number;
  marketValue: number;
  weight: number;
  dayChange: number;
  dayChangePercent: number;
  category: string;
  open: number;
  high: number;
  low: number;
  volume: number;
}

export interface HoldingsPortfolio {
  portfolioValue: number;
  dayChange: number;
  dayChangePercent: number;
  positions: HoldingPosition[];
}

async function fetchBtcPrice(): Promise<{ price: number; prevClose: number }> {
  return withCache('holdings:btc-price', TTL.QUOTES, async () => {
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yStr = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD

      const [spotRes, prevRes] = await Promise.all([
        fetchJson<{ data: { amount: string } }>(
          'https://api.coinbase.com/v2/prices/BTC-USD/spot',
          { provider: 'Coinbase' }
        ),
        fetchJson<{ data: { amount: string } }>(
          `https://api.coinbase.com/v2/prices/BTC-USD/spot?date=${yStr}`,
          { provider: 'Coinbase' }
        ),
      ]);

      return {
        price: parseFloat(spotRes.data.amount),
        prevClose: parseFloat(prevRes.data.amount),
      };
    } catch {
      return { price: 0, prevClose: 0 };
    }
  });
}

interface PriceData {
  price: number;
  prevClose: number;
  open: number;
  high: number;
  low: number;
  volume: number;
}

async function fetchPrice(symbol: string): Promise<PriceData> {
  const empty: PriceData = { price: 0, prevClose: 0, open: 0, high: 0, low: 0, volume: 0 };
  if (symbol === 'BTC') {
    const btc = await fetchBtcPrice();
    return { ...empty, price: btc.price, prevClose: btc.prevClose };
  }
  // Try Alpaca first (reliable for live prices), fall back to Polygon
  try {
    const snap = await getAlpacaSnapshot(symbol);
    return {
      price: snap.latestTrade.p,
      prevClose: snap.prevDailyBar.c,
      open: snap.dailyBar?.o || 0,
      high: snap.dailyBar?.h || 0,
      low: snap.dailyBar?.l || 0,
      volume: snap.dailyBar?.v || 0,
    };
  } catch {
    try {
      const snap = await getPolygonSnapshot(symbol);
      return {
        price: snap.price,
        prevClose: snap.prevClose,
        open: snap.open,
        high: snap.high,
        low: snap.low,
        volume: snap.volume,
      };
    } catch {
      return empty;
    }
  }
}

export async function getHoldingsPortfolio(): Promise<HoldingsPortfolio> {
  // Fetch all prices in parallel
  const prices = await Promise.all(
    HOLDINGS.map((h) => fetchPrice(h.symbol))
  );

  const positions: HoldingPosition[] = HOLDINGS.map((h, i) => {
    const { price, prevClose, open, high, low, volume } = prices[i];
    const marketValue = h.qty * price;
    const prevValue = h.qty * prevClose;
    const dayChange = marketValue - prevValue;
    const dayChangePercent = prevValue > 0 ? (dayChange / prevValue) * 100 : 0;

    return {
      symbol: h.symbol,
      qty: h.qty,
      currentPrice: price,
      marketValue,
      weight: 0, // computed below
      dayChange,
      dayChangePercent,
      category: h.category,
      open,
      high,
      low,
      volume,
    };
  });

  const portfolioValue = positions.reduce((sum, p) => sum + p.marketValue, 0);
  const dayChange = positions.reduce((sum, p) => sum + p.dayChange, 0);
  const prevTotal = portfolioValue - dayChange;

  // Compute weights
  for (const pos of positions) {
    pos.weight = portfolioValue > 0 ? (pos.marketValue / portfolioValue) * 100 : 0;
  }

  // Sort by market value descending
  positions.sort((a, b) => b.marketValue - a.marketValue);

  return {
    portfolioValue,
    dayChange,
    dayChangePercent: prevTotal > 0 ? (dayChange / prevTotal) * 100 : 0,
    positions,
  };
}

// ─── Portfolio Historical Chart ───

export type PortfolioChartPeriod = '1M' | '3M' | '6M' | '1Y';

const PERIOD_DAYS: Record<PortfolioChartPeriod, number> = {
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
};

async function fetchBtcDailyBars(days: number): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const end = Math.floor(Date.now() / 1000);
    const start = end - days * 86400;
    const granularity = 86400; // daily
    const data = await fetchJson<number[][]>(
      `https://api.exchange.coinbase.com/products/BTC-USD/candles?start=${start}&end=${end}&granularity=${granularity}`,
      { provider: 'Coinbase' }
    );
    // Coinbase returns [time, low, high, open, close, volume] newest-first
    for (const candle of data) {
      const date = new Date(candle[0] * 1000).toISOString().split('T')[0];
      map.set(date, candle[4]); // close price
    }
  } catch {
    // BTC bars unavailable — will be omitted from totals
  }
  return map;
}

export async function getPortfolioChart(
  period: PortfolioChartPeriod = '1Y'
): Promise<Array<{ date: string; value: number }>> {
  const days = PERIOD_DAYS[period];
  const start = new Date();
  start.setDate(start.getDate() - days);
  const startStr = start.toISOString().split('T')[0];

  const stockSymbols = HOLDINGS.filter((h) => h.symbol !== 'BTC');
  const btcHolding = HOLDINGS.find((h) => h.symbol === 'BTC');

  // Fetch all bars in parallel
  const [stockBars, btcBars] = await Promise.all([
    Promise.all(
      stockSymbols.map((h) =>
        getHistoricalBars(h.symbol, '1Day', startStr, undefined, days + 10)
          .then((bars) => ({ symbol: h.symbol, bars }))
          .catch(() => ({ symbol: h.symbol, bars: [] as Array<{ date: string; close: number }> }))
      )
    ),
    btcHolding ? fetchBtcDailyBars(days + 10) : Promise.resolve(new Map<string, number>()),
  ]);

  // Build a map: date → { symbol → close }
  const dateMap = new Map<string, Map<string, number>>();

  for (const { symbol, bars } of stockBars) {
    for (const bar of bars) {
      const date = bar.date.split('T')[0];
      if (!dateMap.has(date)) dateMap.set(date, new Map());
      dateMap.get(date)!.set(symbol, bar.close);
    }
  }

  // Merge BTC
  if (btcHolding) {
    Array.from(btcBars.entries()).forEach(([date, close]) => {
      if (!dateMap.has(date)) dateMap.set(date, new Map());
      dateMap.get(date)!.set('BTC', close);
    });
  }

  // Sort dates and compute portfolio value per day,
  // carrying forward the last known price for each symbol (handles weekends/holidays)
  const sortedDates = Array.from(dateMap.keys()).sort();
  const lastKnown = new Map<string, number>();

  const result: Array<{ date: string; value: number }> = [];
  for (const date of sortedDates) {
    const prices = dateMap.get(date)!;
    // Update last-known prices for symbols that have data today
    prices.forEach((price, symbol) => lastKnown.set(symbol, price));

    let total = 0;
    let hasData = false;
    for (const h of HOLDINGS) {
      const price = lastKnown.get(h.symbol);
      if (price !== undefined) {
        total += h.qty * price;
        hasData = true;
      }
    }
    if (hasData) {
      result.push({ date, value: Math.round(total * 100) / 100 });
    }
  }

  return result;
}
