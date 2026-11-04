require('../scripts/register-ts.cjs');
const Module = require('node:module');
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/')) request = require('node:path').join(__dirname, '../src', request.slice(2));
  return resolve.call(this, request, ...rest);
};

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { NextRequest } = require('next/server');
const { invalidatePrefix } = require('../src/lib/cache.ts');
const { HOLDINGS, WATCHLIST } = require('../src/lib/holdings.ts');
const {
  MAX_SYMBOLS,
  TICKER_RE,
  AGGREGATE_LIMIT,
  DIVIDEND_LIMIT,
  INDICATOR_WINDOW,
} = require('../src/lib/polygon-bounds.ts');
const route = require('../src/app/api/polygon/route.ts');
const { getAggregates, getSnapshot } = require('../src/lib/market-data.ts');
const { getSnapshot: getAlpacaSnapshot } = require('../src/lib/alpaca.ts');

const resetCaches = () => { invalidatePrefix('alpaca:'); invalidatePrefix('market:'); };

const get = (qs) => route.GET(new NextRequest(`https://example.test/api/polygon${qs}`));

function ok(body) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    json: async () => body,
  };
}

function withFetch(fn) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (u) => {
    const url = String(u);
    calls.push(url);
    if (url.includes('coinbase.com')) return ok([]);
    if (url.includes('/v1/corporate-actions')) return ok({ corporate_actions: {}, next_page_token: null });
    if (url.includes('/bars')) return ok({ bars: {}, next_page_token: null });
    return ok({});
  };
  return Promise.resolve(fn(calls)).finally(() => { global.fetch = original; });
}

function tickers(n) {
  return Array.from({ length: n }, (_, i) => `S${String(i).padStart(2, '0')}`);
}

async function expectInvalid(qs, calls) {
  const before = calls.length;
  const res = await get(qs);
  const body = await res.json();
  assert.equal(res.status, 400, qs);
  assert.deepEqual(body, { error: 'Invalid request' });
  assert.equal(calls.length, before, qs);
}

test.describe('market data request bounds', { concurrency: 1 }, () => {
  test('symbols the pages request are legal tickers and fit the batch cap', () => {
    const sectors = fs.readFileSync(path.join(__dirname, '../src/app/sectors/page.tsx'), 'utf8');
    const sectorSymbols = [...sectors.matchAll(/symbol:\s*'([^']+)'/g)].map((m) => m[1]);
    const batches = [
      HOLDINGS.map((h) => h.symbol),
      [...WATCHLIST.map((w) => w.symbol), 'SPY'],
      sectorSymbols,
      ['SPY', 'QQQ'],
    ];
    assert.ok(sectorSymbols.length > 0);
    for (const batch of batches) {
      assert.ok(batch.length <= MAX_SYMBOLS, `batch of ${batch.length} exceeds cap ${MAX_SYMBOLS}`);
      for (const symbol of batch) assert.match(symbol, TICKER_RE, symbol);
    }
    // The cap stays above the real watchlist page, which is the largest caller.
    const watchlistBatch = WATCHLIST.length + 1;
    assert.ok(watchlistBatch <= MAX_SYMBOLS);
    assert.ok(watchlistBatch > 25);
  });

  test('oversized symbol lists are rejected before any upstream call', () => withFetch(async (calls) => {
    const symbols = tickers(MAX_SYMBOLS + 1).join(',');
    await expectInvalid(`?action=multi-aggregates&symbols=${symbols}`, calls);
    await expectInvalid(`?action=wma200&symbols=${symbols}`, calls);
    await expectInvalid(`?action=portfolio-dividends&symbols=${symbols}`, calls);
  }));

  test('implausible symbols are rejected before any upstream call', () => withFetch(async (calls) => {
    const samples = [
      '?action=aggregates&symbol=AAA/BBB',
      '?action=snapshot&symbol=..',
      '?action=snapshot&symbol=.',
      '?action=sma&symbol=NOT%20A%20TICKER&window=50',
      '?action=rsi&symbol=' + 'A'.repeat(16),
      '?action=multi-aggregates&symbols=AAPL,AAA/BBB',
      '?action=portfolio-dividends&symbols=BRK.B,../etc',
      '?action=wma200&symbols=SPY,BAD%20TICKER',
    ];
    for (const qs of samples) await expectInvalid(qs, calls);
  }));

  test('out-of-range numbers are rejected before any upstream call', () => withFetch(async (calls) => {
    const samples = [
      `?action=aggregates&symbol=SPY&limit=0`,
      `?action=aggregates&symbol=SPY&limit=${AGGREGATE_LIMIT.max + 1}`,
      '?action=aggregates&symbol=SPY&limit=-5',
      '?action=aggregates&symbol=SPY&limit=500abc',
      '?action=multi-aggregates&symbols=SPY,QQQ&limit=999999',
      '?action=sma&symbol=SPY&window=0',
      `?action=sma&symbol=SPY&window=${INDICATOR_WINDOW.max + 1}`,
      '?action=rsi&symbol=SPY&window=100000',
      '?action=ema&symbol=SPY&window=-1',
      `?action=dividends&symbol=SPY&limit=${DIVIDEND_LIMIT.max + 1}`,
      '?action=dividends&symbol=SPY&limit=1e3',
    ];
    for (const qs of samples) await expectInvalid(qs, calls);
  }));

  test('a watchlist-sized multi-aggregates request is accepted', () => withFetch(async (calls) => {
    resetCaches();
    const symbols = [...WATCHLIST.map((w) => w.symbol), 'SPY'];
    assert.ok(symbols.length <= MAX_SYMBOLS);
    const res = await get(
      `?action=multi-aggregates&symbols=${symbols.join(',')}&timeframe=1day&from=2026-01-01`
    );
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.length, symbols.length);
    assert.deepEqual(body.map((row) => row.symbol), symbols);
    // One batched Alpaca bars request covers every symbol.
    const upstream = calls.filter((u) => u.includes('/v2/stocks/bars'));
    assert.equal(upstream.length, 1);
    assert.ok(upstream[0].includes(`symbols=${encodeURIComponent(symbols.join(','))}`));
  }));

  test('a single-symbol request the ticker page makes is accepted', () => withFetch(async (calls) => {
    resetCaches();
    const res = await get('?action=aggregates&symbol=BTC&timeframe=1day');
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(body));
    assert.equal(calls.length, 1);
    assert.ok(calls[0].includes('/v1beta3/crypto/us/bars?symbols=BTC%2FUSD'));

    resetCaches();
    const sma = await get('?action=sma&symbol=SPY&window=200');
    assert.equal(sma.status, 200);
    assert.ok(calls.some((u) => u.includes('/v2/stocks/bars?symbols=SPY') && u.includes('timeframe=1Day')));
  }));

  test('class shares and Polygon-style crypto prefixes pass and are encoded', () => withFetch(async (calls) => {
    resetCaches();
    await get('?action=snapshot&symbol=BRK.B');
    assert.ok(calls.some((u) => u.includes('/v2/stocks/snapshots?symbols=BRK.B')));

    resetCaches();
    calls.length = 0;
    const crypto = await get('?action=aggregates&symbol=X:BTCUSD&timeframe=1day&limit=10');
    assert.equal(crypto.status, 200);
    assert.ok(calls.some((u) => u.includes('/v1beta3/crypto/us/bars?symbols=BTC%2FUSD')));
  }));

  test('library path builders encode symbols even when the route is bypassed', () => withFetch(async (calls) => {
    resetCaches();
    await getAggregates('X:BTCUSD', '1day', '2026-01-01', '2026-01-02', 5);
    await getSnapshot('AAA/BBB').catch(() => undefined);
    await getAlpacaSnapshot('AAA/BBB');
    const joined = calls.join('\n');
    assert.ok(joined.includes('symbols=BTC%2FUSD'));
    assert.ok(joined.includes('/v2/stocks/snapshots?symbols=AAA%2FBBB'));
    assert.equal(joined.includes('symbols=AAA/BBB'), false);
    assert.ok(joined.includes('/v2/stocks/AAA%2FBBB/snapshot'));
    assert.equal(joined.includes('/v2/stocks/AAA/BBB/'), false);
  }));
});
