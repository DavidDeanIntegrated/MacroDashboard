process.env.ALPACA_API_KEY = 'synthetic-alpaca-key-0123456789';
process.env.ALPACA_API_SECRET = 'synthetic-alpaca-secret-0123456789';
require('../scripts/register-ts.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { invalidatePrefix } = require('../src/lib/cache.ts');
const { getBars, historicalEnd } = require('../src/lib/alpaca.ts');
const { snapshotFromAlpaca, getQuotes, getPortfolioDividends, inferFrequency } = require('../src/lib/market-data.ts');
const { computeSMA, computeEMA, computeRSI, computeMACD } = require('../src/lib/indicators.ts');
const { fetchPrice, getHoldingsPortfolio, HOLDINGS } = require('../src/lib/holdings.ts');
const { marketCapFrom } = require('../src/lib/fundamentals-score.ts');

const reset = () => { invalidatePrefix('alpaca:'); invalidatePrefix('market:'); invalidatePrefix('holdings:'); };
const iso = (ms) => new Date(ms).toISOString();
const minutesAgo = (m) => iso(Date.now() - m * 60000);
// Daily bars are stamped midnight New York time (05:00Z in winter, 04:00Z in summer;
// 05:00Z falls on the same New York date year-round).
const etMidnight = (daysBack) => {
  const d = new Date(Date.now() - daysBack * 86400000);
  return `${d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })}T05:00:00Z`;
};

function stubFetch(routes) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (u) => {
    const url = String(u);
    calls.push(url);
    for (const [match, respond] of routes) {
      if (url.includes(match)) {
        const { status = 200, body = {} } = respond(url);
        return { ok: status < 400, status, statusText: String(status), headers: { get: () => null }, json: async () => body };
      }
    }
    return { ok: false, status: 404, statusText: 'not stubbed', headers: { get: () => null }, json: async () => ({}) };
  };
  return { calls, restore: () => { global.fetch = original; } };
}

const liveSnap = (price, prev) => ({
  latestTrade: { p: price, t: minutesAgo(1), s: 1 },
  dailyBar: { t: etMidnight(0), o: prev, h: price + 1, l: prev - 1, c: price, v: 100 },
  prevDailyBar: { t: etMidnight(1), o: prev, h: prev, l: prev, c: prev, v: 90 },
});

test('IEX snapshot maps to a quote against the previous session close', () => {
  const q = snapshotFromAlpaca(liveSnap(101, 100));
  assert.equal(q.price, 101);
  assert.equal(q.prevClose, 100);
  assert.equal(q.change, 1);
  assert.equal(q.volume, 100);
});

test('a pre-market print measures change from the last completed session, not the one before', () => {
  const s = {
    latestTrade: { p: 105, t: minutesAgo(1), s: 1 },
    dailyBar: { t: etMidnight(1), o: 99, h: 101, l: 98, c: 100, v: 100 },
    prevDailyBar: { t: etMidnight(2), o: 90, h: 90, l: 90, c: 90, v: 100 },
  };
  // Only meaningful when "now" and the bar fall on different New York dates.
  if (etMidnight(0) === etMidnight(1)) return;
  const q = snapshotFromAlpaca(s);
  assert.equal(q.prevClose, 100);
  assert.equal(q.open, 0, 'no session bar yet for today');
});

test('a snapshot without a trade or previous close is not a quote', () => {
  assert.equal(snapshotFromAlpaca({ dailyBar: { t: etMidnight(0), c: 1 } }), null);
  assert.equal(snapshotFromAlpaca({ latestTrade: { p: 5, t: minutesAgo(1), s: 1 } }), null);
});

test('holding prices come from one batched Alpaca request and never call Massive', async () => {
  reset();
  const stocks = HOLDINGS.filter((h) => h.symbol !== 'BTC').map((h) => h.symbol);
  const f = stubFetch([
    ['/v2/stocks/snapshots', () => ({ body: Object.fromEntries(stocks.map((s) => [s, liveSnap(50, 49)])) })],
    ['coinbase.com', () => ({ body: { data: { amount: '60000' } } })],
  ]);
  try {
    const portfolio = await getHoldingsPortfolio();
    assert.ok(portfolio.positions.length > 0);
    for (const p of portfolio.positions.filter((x) => x.symbol !== 'BTC' && x.symbol !== 'CASH')) {
      assert.equal(p.priceSource, 'Alpaca', p.symbol);
      assert.equal(p.currentPrice, 50, p.symbol);
    }
    assert.equal(f.calls.filter((u) => u.includes('/v2/stocks/snapshots')).length, 1);
    assert.equal(f.calls.some((u) => u.includes('polygon.io')), false);
  } finally { f.restore(); }
});

test('a symbol IEX has no print for falls back to full-market daily bars', async () => {
  reset();
  const f = stubFetch([
    ['/v2/stocks/snapshots', () => ({ body: { THIN: { dailyBar: { t: etMidnight(0), c: 1 } } } })],
    ['/v2/stocks/bars', () => ({ body: { bars: { THIN: [
      { t: etMidnight(1), o: 20, h: 20, l: 20, c: 20, v: 5000 },
      { t: etMidnight(0), o: 20, h: 21, l: 19.5, c: 20.5, v: 6000 },
    ] }, next_page_token: null } })],
  ]);
  try {
    const p = await fetchPrice('THIN');
    assert.equal(p.price, 20.5);
    assert.equal(p.prevClose, 20);
    assert.equal(p.source, 'Alpaca');
    assert.ok(f.calls.some((u) => u.includes('feed=sip') && u.includes('adjustment=split')));
  } finally { f.restore(); }
});

test('batched bars follow next_page_token and keep each symbol oldest-first', async () => {
  reset();
  const pages = {
    first: { bars: { AAA: [{ t: '2026-01-02T05:00:00Z', o: 1, h: 1, l: 1, c: 1, v: 1 }] }, next_page_token: 'p2' },
    p2: { bars: { AAA: [{ t: '2026-01-03T05:00:00Z', o: 2, h: 2, l: 2, c: 2, v: 1 }], BBB: [{ t: '2026-01-02T05:00:00Z', o: 3, h: 3, l: 3, c: 3, v: 1 }] }, next_page_token: null },
  };
  const f = stubFetch([['/v2/stocks/bars', (u) => ({ body: u.includes('page_token=p2') ? pages.p2 : pages.first })]]);
  try {
    const bars = await getBars(['AAA', 'BBB'], '1Day', '2026-01-01');
    assert.deepEqual(bars.AAA.map((b) => b.close), [1, 2]);
    assert.deepEqual(bars.BBB.map((b) => b.close), [3]);
    assert.equal(f.calls.length, 2);
  } finally { f.restore(); }
});

test('historical SIP requests never reach into the latest 15 minutes', () => {
  const now = Date.parse('2026-11-04T18:00:00Z');
  assert.equal(historicalEnd(undefined, now), undefined);
  assert.equal(historicalEnd('2026-11-04', now), '2026-11-04T17:44:00.000Z');
  assert.equal(historicalEnd('2026-11-01', now), '2026-11-01T23:59:59.000Z');
});

test('indicator math: SMA exact, RSI bounds, EMA and MACD settle on a trend', () => {
  const bars = Array.from({ length: 300 }, (_, i) => ({ date: `d${i}`, close: 100 + i }));
  const sma = computeSMA(bars, 50);
  assert.equal(sma.length, 251);
  assert.equal(sma.at(-1).value, 100 + (250 + 299) / 2);
  assert.equal(computeRSI(bars, 14).at(-1).value, 100, 'only gains → RSI 100');
  const zigzag = bars.map((b, i) => ({ ...b, close: 100 + (i % 2) }));
  assert.ok(Math.abs(computeRSI(zigzag, 14).at(-1).value - 50) < 2, 'equal gains and losses → RSI ≈ 50');
  // On a straight line the EMA lags the price by a constant, so MACD is flat.
  const ema = computeEMA(bars, 20);
  assert.ok(Math.abs(bars.at(-1).close - ema.at(-1).value - 9.5) < 1e-6);
  const macd = computeMACD(bars);
  assert.ok(Math.abs(macd.at(-1).macd - 7) < 1e-6);
  assert.ok(Math.abs(macd.at(-1).histogram) < 1e-6);
});

test('dividends: frequency is inferred from ex-date spacing; latest four per symbol', async () => {
  reset();
  assert.equal(inferFrequency(['2026-01-01', '2026-02-01', '2026-03-03']), 12);
  assert.equal(inferFrequency(['2025-03-20', '2025-06-19', '2025-09-18', '2025-12-18']), 4);
  assert.equal(inferFrequency(['2026-01-01']), 0);
  const months = Array.from({ length: 6 }, (_, i) => `2026-0${i + 1}-02`);
  const f = stubFetch([['/v1/corporate-actions', () => ({ body: { corporate_actions: { cash_dividends: [
    ...months.map((d) => ({ symbol: 'MMM', rate: 0.3, special: false, foreign: false, ex_date: d, payable_date: d, process_date: d })),
    { symbol: 'QQQ', rate: 0.7, special: false, foreign: false, ex_date: '2026-03-20', payable_date: '2026-04-30', process_date: '2026-04-30' },
  ] }, next_page_token: null } })]]);
  try {
    const rows = await getPortfolioDividends(['MMM', 'QQQ'], 4);
    assert.equal(rows.filter((r) => r.ticker === 'MMM').length, 4);
    assert.equal(rows.find((r) => r.ticker === 'MMM').frequency, 12);
    assert.equal(rows[0].exDate, '2026-06-02', 'newest first');
    assert.equal(f.calls.length, 1, 'one request for every symbol');
  } finally { f.restore(); }
});

test('market cap: SEC shares × price, ADR ratio for foreign filers, unknown otherwise', () => {
  assert.equal(marketCapFrom('MSFT', 500, { sharesOutstanding: 7e9, sharesForm: '10-Q' }), 3.5e12);
  assert.equal(marketCapFrom('TSM', 400, { sharesOutstanding: 25e9, sharesForm: '20-F' }), 2e12);
  assert.equal(marketCapFrom('ASML', 900, { sharesOutstanding: 4e8, sharesForm: '20-F' }), 0);
  assert.equal(marketCapFrom('MSFT', 0, { sharesOutstanding: 7e9, sharesForm: '10-Q' }), 0);
  assert.equal(marketCapFrom('MSFT', 500, null), 0);
});
