process.env.POLYGON_API_KEY = 'synthetic-polygon-key-0123456789';
process.env.FRED_API_KEY = 'synthetic-fred-key-0123456789';
process.env.FINNHUB_API_KEY = 'synthetic-finnhub-key-0123456789';
process.env.ALPACA_API_KEY = 'synthetic-alpaca-key-0123456789';
process.env.ALPACA_API_SECRET = 'synthetic-alpaca-secret-0123456789';

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
  ALPACA_PERIODS,
  MAX_SYMBOLS,
  TICKER_RE,
  boundedTickers,
} = require('../src/lib/polygon-bounds.ts');
const { fetchJson, encodeUpstreamPath, encodeUpstreamRelative, redactSecrets } = require('../src/lib/fetcher.ts');
const { logUpstreamError } = require('../src/lib/api-errors.ts');
const { getQuote } = require('../src/lib/finnhub.ts');
const finnhub = require('../src/app/api/finnhub/route.ts');
const fred = require('../src/app/api/fred/route.ts');
const alpaca = require('../src/app/api/alpaca/route.ts');
const edgar = require('../src/app/api/edgar/route.ts');
const polygon = require('../src/app/api/polygon/route.ts');
const risk = require('../src/app/api/risk/route.ts');

const SECRETS = [
  'synthetic-polygon-key-0123456789',
  'synthetic-fred-key-0123456789',
  'synthetic-finnhub-key-0123456789',
  'synthetic-alpaca-key-0123456789',
  'synthetic-alpaca-secret-0123456789',
];

function assertClientSafe(body, label) {
  const text = JSON.stringify(body);
  if (SECRETS.some((secret) => text.includes(secret))) {
    throw new Error(`${label} response included a synthetic credential`);
  }
  if (/https?:\/\//i.test(text) || /api[_-]?key=/i.test(text) || /token=/i.test(text)) {
    throw new Error(`${label} response included a URL or credential query`);
  }
}

function assertLogSafe(lines, label) {
  const text = lines.join('\n');
  if (SECRETS.some((secret) => text.includes(secret))) {
    throw new Error(`${label} log included a synthetic credential`);
  }
}

function get(route, pathname, qs = '') {
  return route.GET(new NextRequest(`https://example.test${pathname}${qs}`));
}

function ok(body) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    json: async () => body,
  };
}

// statusText is copied into ApiError. A route that returns error.message would
// echo the URL and the synthetic key; the client body must not.
function upstreamFailure() {
  return {
    ok: false,
    status: 500,
    statusText: 'ERR https://api.polygon.io/v2?apiKey=synthetic-polygon-key-0123456789&api_key=synthetic-fred-key-0123456789 token=synthetic-finnhub-key-0123456789 synthetic-alpaca-secret-0123456789',
    headers: { get: () => null },
    json: async () => ({}),
  };
}

function quoteBody() {
  return { c: 10, d: 1, dp: 1, h: 11, l: 9, o: 9.5, pc: 9, t: 1_700_000_000 };
}

function fredObservations() {
  return { observations: [{ date: '2024-01-02', value: '4.5' }] };
}

function alpacaBars(symbol) {
  return {
    bars: { [symbol]: [{ t: '2024-01-02T00:00:00Z', o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }] },
    next_page_token: null,
  };
}

function edgarTickers() {
  return { 0: { cik_str: 320193, ticker: 'AAPL', title: 'Apple' } };
}

function edgarSubmissions() {
  return {
    cik: '0000320193',
    entityType: 'operating',
    name: 'Apple',
    filings: {
      recent: {
        accessionNumber: ['0000320193-24-000123', '0000320193-24-000124', '0000320193-24-000125'],
        form: ['10-K', '8-K', '10-Q'],
        filingDate: ['2024-11-01', '2024-11-02', '2024-11-03'],
        reportDate: ['2024-09-28', '2024-11-01', '2024-09-28'],
        primaryDocument: ['aapl-10k.htm', 'xslF345X05/form4.xml', '../../x'],
        primaryDocDescription: ['10-K', '4', 'bad'],
      },
    },
  };
}

function dispatch(url, mode) {
  if (mode === 'fail') return upstreamFailure();
  if (url.includes('company_tickers.json')) return ok(edgarTickers());
  if (url.includes('/submissions/CIK')) return ok(edgarSubmissions());
  if (url.includes('/api/xbrl/companyfacts/')) return ok({ entityName: 'Apple', cik: 320193, facts: {} });
  if (url.includes('api.stlouisfed.org')) return ok(fredObservations());
  if (url.includes('finnhub.io') && url.includes('/quote')) return ok(quoteBody());
  if (url.includes('finnhub.io') && url.includes('/news')) return ok([]);
  if (url.includes('finnhub.io')) return ok({});
  if (url.includes('/v2/stocks/bars')) return ok(alpacaBars('SPY'));
  if (url.includes('/v1beta1/news')) return ok({ news: [] });
  if (url.includes('alpaca.markets')) return ok({});
  if (url.includes('polygon.io') || url.includes('/v2/aggs/') || url.includes('/v2/snapshot/')) return ok({ results: [] });
  if (url.includes('query1.finance.yahoo.com')) return upstreamFailure();
  if (url.includes('coinbase.com')) return upstreamFailure();
  if (url.includes('sec.gov')) return ok({});
  return ok({});
}

function withFetch(mode, fn) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (u) => {
    const url = String(u);
    calls.push(url);
    return dispatch(url, mode);
  };
  return Promise.resolve(fn(calls)).finally(() => { global.fetch = original; });
}

function captureConsole(fn) {
  const lines = [];
  const original = { error: console.error, warn: console.warn, log: console.log };
  const record = (...args) => {
    lines.push(args.map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return arg.message;
      return '';
    }).join(' '));
  };
  console.error = record;
  console.warn = record;
  console.log = record;
  return Promise.resolve()
    .then(fn)
    .then((result) => ({ result, lines }))
    .finally(() => {
      console.error = original.error;
      console.warn = original.warn;
      console.log = original.log;
    });
}

function tickers(n) {
  return Array.from({ length: n }, (_, i) => `S${String(i).padStart(2, '0')}`);
}

function clearCaches() {
  invalidatePrefix('finnhub:');
  invalidatePrefix('fred:');
  invalidatePrefix('alpaca:');
  invalidatePrefix('edgar:');
  invalidatePrefix('polygon:');
  invalidatePrefix('holdings:');
  invalidatePrefix('fundamentals-score:');
}

test.describe('public API bounds and error redaction', { concurrency: 1 }, () => {
  test('pages stay inside the shared symbol, period, and series limits', () => {
    const portfolioPage = fs.readFileSync(path.join(__dirname, '../src/app/portfolio/page.tsx'), 'utf8');
    const periods = [...portfolioPage.matchAll(/PORTFOLIO_CHART_PERIODS = \[([^\]]+)\]/g)]
      .flatMap((match) => [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1]));
    assert.deepEqual(periods, ['1D', '1M', '3M', '6M', '1Y']);
    for (const period of periods) assert.ok(ALPACA_PERIODS.includes(period), period);

    const alerts = fs.readFileSync(path.join(__dirname, '../src/app/alerts/page.tsx'), 'utf8');
    assert.match(alerts, /forms=10-K,10-Q,8-K&count=3/);

    assert.ok(WATCHLIST.length > 0);
    assert.ok(WATCHLIST.length <= MAX_SYMBOLS);
    for (const item of WATCHLIST) assert.match(item.symbol, TICKER_RE, item.symbol);

    const riskSymbols = Array.from(new Set([
      ...HOLDINGS.filter((holding) => holding.symbol !== 'CASH').map((holding) => holding.symbol),
      'SPY',
    ]));
    assert.ok(boundedTickers(riskSymbols));
    assert.ok(riskSymbols.length <= MAX_SYMBOLS);
  });

  test('oversized or malformed finnhub, fred, alpaca, and edgar inputs never call upstream', () => withFetch('ok', async (calls) => {
    const samples = [
      [finnhub, '/api/finnhub', `?action=fundamentals-score&symbols=${tickers(MAX_SYMBOLS + 1).join(',')}`],
      [finnhub, '/api/finnhub', '?action=quote&symbol=AAA/BBB'],
      [finnhub, '/api/finnhub', '?action=news&symbol=AAA/BBB'],
      [finnhub, '/api/finnhub', '?action=news&symbol=AAPL&days=0'],
      [finnhub, '/api/finnhub', '?action=news&symbol=AAPL&days=31'],
      [finnhub, '/api/finnhub', '?action=news&category=nope'],
      [finnhub, '/api/finnhub', '?action=candles&symbol=AAPL&resolution=ZZZ'],
      [finnhub, '/api/finnhub', '?action=candles&symbol=AAPL&from=1&to=2'],
      [fred, '/api/fred', '?action=series&id=../DGS10'],
      [fred, '/api/fred', '?action=series&id=NOT_A_SERIES'],
      [fred, '/api/fred', '?action=info&id=DGS10%2Fextra'],
      [fred, '/api/fred', '?action=series&id=DGS10&frequency=daily'],
      [fred, '/api/fred', '?action=series&id=DGS10&start=2024-13-01'],
      [fred, '/api/fred', '?action=series&id=DGS10&start=2024-02-01&end=2024-01-01'],
      [alpaca, '/api/alpaca', '?action=bars&symbol=SPY&limit=999999'],
      [alpaca, '/api/alpaca', '?action=bars&symbol=..'],
      [alpaca, '/api/alpaca', '?action=snapshot&symbol=.'],
      [alpaca, '/api/alpaca', '?action=portfolio-chart&period=2Y'],
      [alpaca, '/api/alpaca', '?action=bars&symbol=SPY&timeframe=1day'],
      [edgar, '/api/edgar', '?action=filings&ticker=..'],
      [edgar, '/api/edgar', '?action=filings&ticker=AAPL&count=10000'],
      [edgar, '/api/edgar', '?action=filings&ticker=AAPL&count=0'],
      [edgar, '/api/edgar', `?action=filings&ticker=AAPL&forms=${tickers(11).join(',')}`],
      [edgar, '/api/edgar', '?action=filings&ticker=AAPL&forms=10-K,../etc'],
    ];
    for (const [route, pathname, qs] of samples) {
      const before = calls.length;
      const res = await get(route, pathname, qs);
      const body = await res.json();
      assert.equal(res.status, 400, qs);
      assert.deepEqual(body, { error: 'Invalid request' });
      assert.equal(calls.length, before, qs);
    }
  }));

  test('requests the pages send are still accepted', () => withFetch('ok', async (calls) => {
    clearCaches();
    const quote = await get(finnhub, '/api/finnhub', '?action=quote&symbol=AAPL');
    assert.equal(quote.status, 200);
    assert.equal((await quote.json()).price, 10);
    assert.ok(calls.some((url) => url.includes('/quote?') && url.includes('symbol=AAPL')));

    clearCaches();
    calls.length = 0;
    const scores = await get(finnhub, '/api/finnhub', '?action=fundamentals-score&symbols=AAPL,MSFT');
    const scoreBody = await scores.json();
    assert.equal(scores.status, 200);
    assert.equal(scoreBody.length, 2);
    assert.deepEqual(scoreBody.map((row) => row.symbol), ['AAPL', 'MSFT']);

    clearCaches();
    const series = await get(fred, '/api/fred', '?action=series&id=DGS10');
    assert.equal(series.status, 200);
    assert.deepEqual(await series.json(), [{ date: '2024-01-02', value: 4.5 }]);

    clearCaches();
    const indicator = await get(fred, '/api/fred', '?action=series&id=PCEC96');
    assert.equal(indicator.status, 200);
    assert.equal((await indicator.json())[0].value, 4.5);

    clearCaches();
    const curve = await get(fred, '/api/fred', '?action=yield-curve');
    assert.equal(curve.status, 200);
    assert.equal((await curve.json()).length, 5);

    clearCaches();
    const bars = await get(alpaca, '/api/alpaca', '?action=bars&symbol=SPY&timeframe=1Day');
    const barBody = await bars.json();
    assert.equal(bars.status, 200);
    assert.equal(barBody[0].close, 1.5);

    clearCaches();
    calls.length = 0;
    const filings = await get(edgar, '/api/edgar', '?action=filings&ticker=AAPL&forms=10-K,10-Q,8-K&count=3');
    const filingBody = await filings.json();
    assert.equal(filings.status, 200);
    assert.equal(filingBody.length, 2);
    const urls = filingBody.map((row) => row.fileUrl).join('\n');
    assert.equal(urls.includes('aapl-10k.htm'), true);
    assert.equal(urls.includes('xslF345X05/form4.xml'), true);
    assert.equal(urls.includes('..'), false);
    assert.equal(calls.some((url) => url.includes('/submissions/CIK0000320193.json')), true);
    assert.equal(urls.includes('/data/0000320193/'), true);

    const missing = await get(edgar, '/api/edgar', '?action=fundamentals&ticker=ZZZZ');
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'Not found' });
  }));

  test('finnhub and edgar builders encode caller-supplied path text', () => withFetch('ok', async (calls) => {
    assert.equal(encodeUpstreamPath('/stock/profile2'), '/stock/profile2');
    assert.equal(encodeUpstreamPath('/quote'), '/quote');
    assert.throws(() => encodeUpstreamPath('/../x'));
    assert.equal(encodeUpstreamRelative('xslF345X05/form4.xml'), 'xslF345X05/form4.xml');
    assert.equal(encodeUpstreamRelative('../../x'), null);
    assert.equal(encodeUpstreamRelative('aapl-10k.htm'), 'aapl-10k.htm');

    clearCaches();
    calls.length = 0;
    await getQuote('AAA/BBB');
    const url = calls[0] || '';
    assert.equal(/\/quote\?/.test(url), true);
    assert.equal(url.includes('symbol=AAA%2FBBB'), true);
    assert.equal(url.includes('symbol=AAA/BBB'), false);
    assert.equal(url.includes('/AAA/BBB'), false);
  }));

  test('fetcher errors and route failures do not return a URL or key', async () => {
    const key = 'synthetic-polygon-key-0123456789';
    const leakedUrl = `https://api.polygon.io/v2/aggs?apiKey=${key}&api_key=synthetic-fred-key-0123456789`;
    await withFetch('fail', async () => {
      global.fetch = async () => {
        throw new Error(`socket hang up ${key} synthetic-alpaca-secret-0123456789`);
      };
      await assert.rejects(
        () => fetchJson(leakedUrl, { retries: 0, backoffMs: 0, timeoutMs: 50, provider: 'Polygon' }),
        (error) => {
          assert.equal(error instanceof Error, true);
          assert.match(error.message, /Failed after 1 attempts/);
          assertLogSafe([error.message], 'fetchJson');
          assert.equal(error.message.includes('apiKey='), true);
          assert.equal(error.message.includes('REDACTED'), true);
          assert.equal(/https?:\/\/[^?\s]*apiKey=[^&\s]+/.test(error.message.replace('apiKey=REDACTED', '')), false);
          return true;
        },
      );
    });

    const logged = [];
    const original = console.error;
    console.error = (...args) => logged.push(args.map(String).join(' '));
    try {
      logUpstreamError('scope', new Error(`${leakedUrl} synthetic-finnhub-key-0123456789`));
    } finally {
      console.error = original;
    }
    assertLogSafe(logged, 'logUpstreamError');
    assert.equal(logged.join('\n').includes('REDACTED'), true);
    assert.equal(redactSecrets(`token=${key}`).includes(key), false);

    const routes = [
      ['polygon', polygon, '/api/polygon', '?action=aggregates&symbol=IWM&timeframe=1day', 500],
      ['finnhub', finnhub, '/api/finnhub', '?action=quote&symbol=MSFT', 500],
      ['fred', fred, '/api/fred', '?action=series&id=UNRATE', 500],
      ['alpaca', alpaca, '/api/alpaca', '?action=snapshot&symbol=QQQ', 500],
      ['edgar', edgar, '/api/edgar', '?action=fundamentals&ticker=AAPL', 500],
      ['risk', risk, '/api/risk', '', 503],
    ];

    for (const [label, route, pathname, qs, status] of routes) {
      clearCaches();
      const { result, lines } = await captureConsole(() => withFetch('fail', () => get(route, pathname, qs)));
      const body = await result.json();
      assert.equal(result.status, status, label);
      assert.deepEqual(body, { error: 'Request failed' });
      assertClientSafe(body, label);
      assertLogSafe(lines, label);
    }

    const apiDir = path.join(__dirname, '../src/app/api');
    const routeFiles = fs.readdirSync(apiDir).map((dir) => path.join(apiDir, dir, 'route.ts'));
    assert.ok(routeFiles.length >= 6);
    for (const file of routeFiles) {
      const source = fs.readFileSync(file, 'utf8');
      assert.equal(source.includes('error.message'), false, file);
    }
  });
});
