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
  { symbol: 'VTI',  qty: 2.700877,   category: 'Broad Market' },
  { symbol: 'SGOV', qty: 7.691974,   category: 'Dry Powder' },
  { symbol: 'GLD',  qty: 1.309365,   category: 'Gold' },
  { symbol: 'VTV',  qty: 1.503593,   category: 'Value' },
  { symbol: 'VXUS', qty: 2.732413,   category: 'International' },
  { symbol: 'NVDA', qty: 1.069351,   category: 'Quality Compounder' },
  { symbol: 'TSM',  qty: 0.494163,   category: 'Quality Compounder' },
  { symbol: 'MSFT', qty: 0.604955,   category: 'Quality Compounder' },
  { symbol: 'BCI',  qty: 7.057182,   category: 'Commodity' },
  { symbol: 'PLTR', qty: 1.041579,   category: 'High Conviction' },
  { symbol: 'RKLB', qty: 1.700972,   category: 'High Conviction' },
  { symbol: 'RVI',  qty: 2,          category: 'High Conviction' },
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
    // Try Coinbase first
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yStr = yesterday.toISOString().split('T')[0];

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

      const price = parseFloat(spotRes.data.amount);
      const prevClose = parseFloat(prevRes.data.amount);
      if (price > 0) return { price, prevClose };
    } catch (err) {
      console.warn('Coinbase BTC price failed, trying Polygon:', err instanceof Error ? err.message : err);
    }

    // Fallback: Polygon crypto aggregates (X:BTCUSD)
    try {
      const now = new Date();
      const to = now.toISOString().split('T')[0];
      const from = new Date(now);
      from.setDate(from.getDate() - 5); // Get last 5 days to ensure we have 2 trading days
      const fromStr = from.toISOString().split('T')[0];

      const { getAggregates } = await import('./polygon');
      const bars = await getAggregates('X:BTCUSD', '1day', fromStr, to);
      if (bars.length >= 2) {
        return {
          price: bars[bars.length - 1].close,
          prevClose: bars[bars.length - 2].close,
        };
      } else if (bars.length === 1) {
        return {
          price: bars[0].close,
          prevClose: bars[0].open,
        };
      }
    } catch (err) {
      console.warn('Polygon BTC price also failed:', err instanceof Error ? err.message : err);
    }

    return { price: 0, prevClose: 0 };
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

// ─── Watchlist ───
// Stocks to track without owning

export interface WatchlistStock {
  symbol: string;
  category: string;
}

export const WATCHLIST: WatchlistStock[] = [
  { symbol: 'AVAV',  category: 'Defense' },
  { symbol: 'DRS',   category: 'Defense' },
  { symbol: 'GD',    category: 'Defense' },
  { symbol: 'LMT',   category: 'Defense' },
  { symbol: 'BAH',   category: 'Defense' },
  { symbol: 'XOM',   category: 'Energy' },
  { symbol: 'DVN',   category: 'Energy' },
  { symbol: 'OXY',   category: 'Energy' },
  { symbol: 'CEG',   category: 'Nuclear / Energy' },
  { symbol: 'OKLO',  category: 'Nuclear / Energy' },
  { symbol: 'VST',   category: 'Power / Utilities' },
  { symbol: 'TLN',   category: 'Power / Utilities' },
  { symbol: 'FLNC',  category: 'Energy Storage' },
  { symbol: 'CLSK',  category: 'Crypto Mining' },
  { symbol: 'IONQ',  category: 'Quantum Computing' },
  { symbol: 'ACHR',  category: 'eVTOL / Aviation' },
  { symbol: 'HIMS',  category: 'Telehealth' },
  { symbol: 'TMO',   category: 'Life Sciences' },
  { symbol: 'NEM',   category: 'Gold / Mining' },
  { symbol: 'ABCL',  category: 'Biotech' },
  { symbol: 'CATX',  category: 'Biotech' },
  { symbol: 'KULR',  category: 'Battery Tech' },
  { symbol: 'SES',   category: 'Battery Tech' },
  { symbol: 'ONDS',  category: 'IoT / Connectivity' },
  { symbol: 'LTRX',  category: 'IoT / Connectivity' },
  { symbol: 'OPTT',  category: 'Renewables' },
  { symbol: 'OPEN',  category: 'Real Estate Tech' },
];

export const WATCHLIST_CATEGORY_CONFIG: Record<string, { order: number; badge: 'blue' | 'purple' | 'orange' | 'green' | 'yellow' | 'red' | 'neutral' }> = {
  'Defense':            { order: 0, badge: 'blue' },
  'Energy':             { order: 1, badge: 'orange' },
  'Nuclear / Energy':   { order: 2, badge: 'orange' },
  'Power / Utilities':  { order: 3, badge: 'yellow' },
  'Energy Storage':     { order: 4, badge: 'yellow' },
  'Crypto Mining':      { order: 5, badge: 'red' },
  'Quantum Computing':  { order: 6, badge: 'purple' },
  'eVTOL / Aviation':   { order: 7, badge: 'blue' },
  'Telehealth':         { order: 8, badge: 'green' },
  'Life Sciences':      { order: 9, badge: 'green' },
  'Gold / Mining':      { order: 10, badge: 'yellow' },
  'Biotech':            { order: 11, badge: 'green' },
  'Battery Tech':       { order: 12, badge: 'yellow' },
  'IoT / Connectivity': { order: 13, badge: 'neutral' },
  'Renewables':         { order: 14, badge: 'green' },
  'Real Estate Tech':   { order: 15, badge: 'neutral' },
};

export interface WatchlistPosition {
  symbol: string;
  currentPrice: number;
  dayChange: number;
  dayChangePercent: number;
  category: string;
  open: number;
  high: number;
  low: number;
  volume: number;
}

export async function getWatchlistData(): Promise<WatchlistPosition[]> {
  const prices = await Promise.all(
    WATCHLIST.map((w) => fetchPrice(w.symbol))
  );

  const positions: WatchlistPosition[] = WATCHLIST.map((w, i) => {
    const { price, prevClose, open, high, low, volume } = prices[i];
    const dayChange = price - prevClose;
    const dayChangePercent = prevClose > 0 ? (dayChange / prevClose) * 100 : 0;

    return {
      symbol: w.symbol,
      currentPrice: price,
      dayChange,
      dayChangePercent,
      category: w.category,
      open,
      high,
      low,
      volume,
    };
  });

  // Sort by category order
  positions.sort((a, b) => {
    const orderA = WATCHLIST_CATEGORY_CONFIG[a.category]?.order ?? 99;
    const orderB = WATCHLIST_CATEGORY_CONFIG[b.category]?.order ?? 99;
    return orderA - orderB;
  });

  return positions;
}

// ─── Portfolio Historical Chart ───

export type PortfolioChartPeriod = '1D' | '1M' | '3M' | '6M' | '1Y';

const PERIOD_DAYS: Record<PortfolioChartPeriod, number> = {
  '1D': 1,
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
};

async function fetchBtcDailyBars(days: number): Promise<Map<string, number>> {
  const map = new Map<string, number>();

  // Try Coinbase exchange API first
  try {
    const granularity = 86400;
    const maxCandles = 290;
    const now = Math.floor(Date.now() / 1000);
    const earliest = now - days * 86400;
    const fetches: Promise<void>[] = [];

    for (let chunkEnd = now; chunkEnd > earliest; chunkEnd -= maxCandles * granularity) {
      const chunkStart = Math.max(earliest, chunkEnd - maxCandles * granularity);
      const url = `https://api.exchange.coinbase.com/products/BTC-USD/candles?start=${chunkStart}&end=${chunkEnd}&granularity=${granularity}`;
      fetches.push(
        fetchJson<number[][]>(url, { provider: 'Coinbase' }).then((data) => {
          for (const candle of data) {
            const date = new Date(candle[0] * 1000).toISOString().split('T')[0];
            map.set(date, candle[4]);
          }
        })
      );
    }

    await Promise.all(fetches);
    if (map.size > 0) return map;
  } catch (err) {
    console.warn('Coinbase BTC bars failed, trying Polygon:', err instanceof Error ? err.message : err);
  }

  // Fallback: Polygon crypto aggregates
  try {
    const { getAggregates } = await import('./polygon');
    const from = new Date();
    from.setDate(from.getDate() - days);
    const fromStr = from.toISOString().split('T')[0];
    const toStr = new Date().toISOString().split('T')[0];

    const bars = await getAggregates('X:BTCUSD', '1day', fromStr, toStr, days + 10);
    for (const bar of bars) {
      const date = bar.date.split('T')[0];
      map.set(date, bar.close);
    }
  } catch (err) {
    console.warn('Polygon BTC bars also failed:', err instanceof Error ? err.message : err);
  }

  return map;
}

async function fetchBtcIntradayBars(): Promise<Map<string, number>> {
  const map = new Map<string, number>();

  // Try Coinbase exchange API first
  try {
    const now = Math.floor(Date.now() / 1000);
    const start = now - 86400;
    const url = `https://api.exchange.coinbase.com/products/BTC-USD/candles?start=${start}&end=${now}&granularity=300`;
    const data = await fetchJson<number[][]>(url, { provider: 'Coinbase' });
    for (const candle of data) {
      const ts = new Date(candle[0] * 1000).toISOString();
      map.set(ts, candle[4]);
    }
    if (map.size > 0) return map;
  } catch (err) {
    console.warn('Coinbase BTC intraday failed, trying Polygon:', err instanceof Error ? err.message : err);
  }

  // Fallback: Polygon crypto 5-min bars
  try {
    const { getAggregates } = await import('./polygon');
    const now = new Date();
    const from = new Date(now);
    from.setDate(from.getDate() - 1);
    const fromStr = from.toISOString().split('T')[0];
    const toStr = now.toISOString().split('T')[0];

    const bars = await getAggregates('X:BTCUSD', '5min', fromStr, toStr, 300);
    for (const bar of bars) {
      map.set(bar.date, bar.close);
    }
  } catch (err) {
    console.warn('Polygon BTC intraday also failed:', err instanceof Error ? err.message : err);
  }

  return map;
}

export async function getPortfolioChart(
  period: PortfolioChartPeriod = '1Y'
): Promise<Array<{ date: string; value: number }>> {
  const days = PERIOD_DAYS[period];
  const isIntraday = period === '1D';

  const stockSymbols = HOLDINGS.filter((h) => h.symbol !== 'BTC');
  const btcHolding = HOLDINGS.find((h) => h.symbol === 'BTC');

  if (isIntraday) {
    // On weekends/holidays, fetch the most recent trading day's bars instead of today
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0=Sun, 6=Sat
    const barDate = new Date(now);
    if (dayOfWeek === 0) barDate.setDate(barDate.getDate() - 2); // Sun → Fri
    else if (dayOfWeek === 6) barDate.setDate(barDate.getDate() - 1); // Sat → Fri
    const barDateStr = barDate.toISOString().split('T')[0];

    // Use 5-minute bars for intraday
    const [stockBars, btcBars, prevCloses] = await Promise.all([
      Promise.all(
        stockSymbols.map((h) =>
          getHistoricalBars(h.symbol, '5Min', barDateStr, undefined, 200)
            .then((bars) => ({ symbol: h.symbol, bars }))
            .catch(() => ({ symbol: h.symbol, bars: [] as Array<{ date: string; close: number }> }))
        )
      ),
      btcHolding ? fetchBtcIntradayBars() : Promise.resolve(new Map<string, number>()),
      // Fetch previous close for each holding so chart baseline matches day change
      Promise.all(
        HOLDINGS.map((h) =>
          fetchPrice(h.symbol)
            .then((pd) => ({ symbol: h.symbol, prevClose: pd.prevClose }))
            .catch(() => ({ symbol: h.symbol, prevClose: 0 }))
        )
      ),
    ]);

    // Build a map: timestamp → { symbol → close }
    const dateMap = new Map<string, Map<string, number>>();
    const intradaySymbolsWithData = new Set<string>();

    for (const { symbol, bars } of stockBars) {
      if (bars.length > 0) intradaySymbolsWithData.add(symbol);
      for (const bar of bars) {
        // Round to 5-min bucket
        const d = new Date(bar.date);
        d.setMinutes(Math.floor(d.getMinutes() / 5) * 5, 0, 0);
        const key = d.toISOString();
        if (!dateMap.has(key)) dateMap.set(key, new Map());
        dateMap.get(key)!.set(symbol, bar.close);
      }
    }

    if (btcHolding) {
      if (btcBars.size > 0) intradaySymbolsWithData.add('BTC');
      btcBars.forEach((close, ts) => {
        const d = new Date(ts);
        d.setMinutes(Math.floor(d.getMinutes() / 5) * 5, 0, 0);
        const key = d.toISOString();
        if (!dateMap.has(key)) dateMap.set(key, new Map());
        dateMap.get(key)!.set('BTC', close);
      });
    }

    // Compute previous-close portfolio value as baseline — only for symbols with intraday data
    // so the baseline matches what the chart will actually show
    let prevCloseTotal = 0;
    for (const { symbol, prevClose } of prevCloses) {
      if (!intradaySymbolsWithData.has(symbol)) continue;
      const holding = HOLDINGS.find((h) => h.symbol === symbol);
      if (holding) prevCloseTotal += holding.qty * prevClose;
    }

    const sortedDates = Array.from(dateMap.keys()).sort();
    const lastKnown = new Map<string, number>();

    const result: Array<{ date: string; value: number }> = [];

    // Prepend previous close as the starting point so chart % matches day change
    if (prevCloseTotal > 0 && sortedDates.length > 0) {
      const firstTs = new Date(sortedDates[0]);
      firstTs.setMinutes(firstTs.getMinutes() - 5);
      result.push({ date: firstTs.toISOString(), value: Math.round(prevCloseTotal * 100) / 100 });
    }

    for (const ts of sortedDates) {
      const prices = dateMap.get(ts)!;
      prices.forEach((price, symbol) => lastKnown.set(symbol, price));
      // Only sum holdings that have intraday data to match the baseline
      let total = 0;
      for (const h of HOLDINGS) {
        if (!intradaySymbolsWithData.has(h.symbol)) continue;
        total += h.qty * (lastKnown.get(h.symbol) || 0);
      }
      if (total > 0) result.push({ date: ts, value: Math.round(total * 100) / 100 });
    }

    // If no intraday bars (weekend/holiday), show a flat line at prev close
    if (result.length === 0 && prevCloseTotal > 0) {
      const baseTime = new Date(barDateStr + 'T14:30:00.000Z'); // 9:30 AM ET
      const endTime = new Date(barDateStr + 'T21:00:00.000Z');  // 4:00 PM ET
      result.push(
        { date: baseTime.toISOString(), value: Math.round(prevCloseTotal * 100) / 100 },
        { date: endTime.toISOString(), value: Math.round(prevCloseTotal * 100) / 100 },
      );
    }

    return result;
  }

  // Daily bars for longer periods
  const start = new Date();
  start.setDate(start.getDate() - days);
  const startStr = start.toISOString().split('T')[0];

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

  // Track earliest bar date per symbol to identify which symbols have data
  // covering the full period vs. those that only appear very recently
  const symbolEarliestDate = new Map<string, string>();

  for (const { symbol, bars } of stockBars) {
    for (const bar of bars) {
      const date = bar.date.split('T')[0];
      if (!dateMap.has(date)) dateMap.set(date, new Map());
      dateMap.get(date)!.set(symbol, bar.close);
      if (!symbolEarliestDate.has(symbol) || date < symbolEarliestDate.get(symbol)!) {
        symbolEarliestDate.set(symbol, date);
      }
    }
  }

  // Merge BTC
  if (btcHolding) {
    Array.from(btcBars.entries()).forEach(([date, close]) => {
      if (!dateMap.has(date)) dateMap.set(date, new Map());
      dateMap.get(date)!.set('BTC', close);
      if (!symbolEarliestDate.has('BTC') || date < symbolEarliestDate.get('BTC')!) {
        symbolEarliestDate.set('BTC', date);
      }
    });
  }

  // Determine which symbols have data early enough to be included from the start.
  // Symbols whose data starts more than halfway through the period are "late starters"
  // and shouldn't block the chart from rendering.
  const sortedDates = Array.from(dateMap.keys()).sort();
  if (sortedDates.length === 0) return [];

  const midpointDate = sortedDates[Math.floor(sortedDates.length / 2)];
  const earlySymbols = new Set<string>();
  Array.from(symbolEarliestDate.entries()).forEach(([symbol, earliest]) => {
    if (earliest <= midpointDate) earlySymbols.add(symbol);
  });
  // Need at least 1 early symbol to start the chart
  const requiredSymbols = Math.max(1, earlySymbols.size);

  const lastKnown = new Map<string, number>();
  const result: Array<{ date: string; value: number }> = [];

  for (const date of sortedDates) {
    const prices = dateMap.get(date)!;
    prices.forEach((price, symbol) => lastKnown.set(symbol, price));

    // Count how many early symbols we've seen so far
    let earlySeen = 0;
    Array.from(earlySymbols).forEach((s) => {
      if (lastKnown.has(s)) earlySeen++;
    });
    if (earlySeen < requiredSymbols) continue;

    let total = 0;
    for (const h of HOLDINGS) {
      total += h.qty * (lastKnown.get(h.symbol) || 0);
    }
    result.push({ date, value: Math.round(total * 100) / 100 });
  }

  return result;
}
