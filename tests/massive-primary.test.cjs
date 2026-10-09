require('../scripts/register-ts.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { snapshotFromTicker } = require('../src/lib/polygon.ts');
const { fetchPrice, fetchBars } = require('../src/lib/holdings.ts');

const nowMs = () => Date.now() - 15 * 60 * 1000; // Starter data is 15 minutes delayed
const starterTicker = (sym, price = 101) => ({
  ticker: sym, todaysChange: 1, todaysChangePerc: 1,
  day: { o: 100, h: 102, l: 99, c: price, v: 1000, vw: 100 },
  prevDay: { o: 99, h: 101, l: 98, c: 100, v: 900, vw: 99 },
  min: { o: price, h: price, l: price, c: price, v: 10, vw: price, t: nowMs() },
  updated: nowMs() * 1e6,
});

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

test('Starter-plan snapshots (no lastTrade) still carry a timestamp and price', () => {
  const t = starterTicker('AAA', 123.45);
  const s = snapshotFromTicker(t);
  assert.equal(s.price, 123.45);
  assert.ok(s.asOf, 'asOf must come from the minute bar when lastTrade is absent');
  assert.ok(Math.abs(Date.parse(s.asOf) - t.min.t) < 1000);
  assert.equal(s.prevClose, 100);
});

test('lastTrade wins when the plan provides it', () => {
  const t = { ...starterTicker('AAB'), lastTrade: { p: 130, s: 1, t: Date.now() * 1e6 } };
  assert.equal(snapshotFromTicker(t).price, 130);
});

test('Current prices come from Massive without touching Alpaca', async () => {
  const f = stubFetch([['api.polygon.io/v2/snapshot', (u) => ({ body: { status: 'OK', ticker: starterTicker('MSVA', 111) } })]]);
  try {
    const p = await fetchPrice('MSVA');
    assert.equal(p.source, 'Massive');
    assert.equal(p.price, 111);
    assert.equal(f.calls.filter((u) => u.includes('alpaca.markets')).length, 0);
  } finally { f.restore(); }
});

test('Alpaca is the fallback when Massive fails', async () => {
  const t = new Date(nowMs()).toISOString();
  const f = stubFetch([
    ['api.polygon.io/v2/snapshot', () => ({ status: 503 })],
    ['data.alpaca.markets/v2/stocks/MSVB/snapshot', () => ({ body: { latestTrade: { p: 50, t, s: 1 }, prevDailyBar: { c: 49 }, dailyBar: { o: 49, h: 51, l: 48, v: 5 } } })],
  ]);
  try {
    const p = await fetchPrice('MSVB');
    assert.equal(p.source, 'Alpaca');
    assert.equal(p.price, 50);
  } finally { f.restore(); }
});

test('Portfolio chart bars come from Massive, falling back to Alpaca only when Massive is empty', async () => {
  const f = stubFetch([
    ['/v2/aggs/ticker/MSVC/', () => ({ body: { results: [{ o: 1, h: 1, l: 1, c: 1.5, v: 1, t: Date.UTC(2026, 9, 8) }] } })],
    ['/v2/aggs/ticker/MSVD/', () => ({ body: { results: [] } })],
    ['data.alpaca.markets/v2/stocks/bars', () => ({ body: { bars: { MSVD: [{ t: '2026-10-08T00:00:00Z', o: 2, h: 2, l: 2, c: 2.5, v: 1 }] } } })],
  ]);
  try {
    const c = await fetchBars('MSVC', '1Day', '2026-10-01', 20);
    assert.equal(c[0].close, 1.5);
    assert.equal(f.calls.filter((u) => u.includes('alpaca.markets')).length, 0);
    const d = await fetchBars('MSVD', '1Day', '2026-10-01', 20);
    assert.equal(d[0].close, 2.5);
  } finally { f.restore(); }
});
