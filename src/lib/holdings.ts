// Static portfolio holdings — manually maintained
// Update quantities here when rebalancing

import { getSnapshot } from './alpaca';
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

async function fetchPrice(symbol: string): Promise<{ price: number; prevClose: number }> {
  if (symbol === 'BTC') {
    return fetchBtcPrice();
  }
  // Try Alpaca first, fall back to Polygon
  try {
    const snapshot = await getSnapshot(symbol);
    return {
      price: snapshot.latestTrade.p,
      prevClose: snapshot.prevDailyBar.c,
    };
  } catch {
    try {
      const pgSnapshot = await getPolygonSnapshot(symbol);
      return {
        price: pgSnapshot.price,
        prevClose: pgSnapshot.prevClose,
      };
    } catch {
      return { price: 0, prevClose: 0 };
    }
  }
}

export async function getHoldingsPortfolio(): Promise<HoldingsPortfolio> {
  // Fetch all prices in parallel
  const prices = await Promise.all(
    HOLDINGS.map((h) => fetchPrice(h.symbol))
  );

  const positions: HoldingPosition[] = HOLDINGS.map((h, i) => {
    const { price, prevClose } = prices[i];
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
