require('../scripts/register-ts.cjs');
// Resolve the tsconfig "@/*" -> "src/*" alias for route modules (test-local hook).
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

const SRC = path.join(__dirname, '../src');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(d, e.name)) : /\.(ts|tsx)$/.test(e.name) ? [path.join(d, e.name)] : []);

function withFetchSpy(fn) {
  const calls = [];
  const original = global.fetch;
  global.fetch = async (u) => { calls.push(String(u)); return { ok: false, status: 599, statusText: 'blocked in test', headers: { get: () => null }, json: async () => ({}) }; };
  return Promise.resolve(fn(calls)).finally(() => { global.fetch = original; });
}

const route = require('../src/app/api/alpaca/route.ts');
const { NextRequest } = require('next/server');
const get = (qs) => route.GET(new NextRequest(`https://example.test/api/alpaca${qs}`));

test('anonymous brokerage-style actions are rejected before any provider call', () => withFetchSpy(async (calls) => {
  for (const qs of ['?action=account', '?action=positions', '?action=orders', '?action=order', '?action=cancel',
                    '?action=ACCOUNT', '?action=portfolio%00account', '?action=', '', '?action=../account']) {
    const res = await get(qs);
    assert.equal(res.status, 400, qs);
  }
  assert.deepEqual(calls, []);
}));

test('malformed requests for public actions fail closed without provider calls', () => withFetchSpy(async (calls) => {
  assert.equal((await get('?action=bars')).status, 400);
  assert.equal((await get('?action=snapshot')).status, 400);
  assert.deepEqual(calls, []);
}));

test('the route exposes GET only (Next.js answers 405 to other methods)', () => {
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD']) assert.equal(route[m], undefined, m);
  assert.equal(typeof route.GET, 'function');
});

test('no source file can reach brokerage account, position or order endpoints', () => {
  for (const f of walk(SRC)) {
    const s = fs.readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /paper-api\.alpaca\.markets|\/\/api\.alpaca\.markets|\/v2\/(account|positions|orders)\b/, f);
    assert.doesNotMatch(s, /HOLDINGS_SOURCE|ALPACA_PAPER/, f);
  }
  assert.equal(fs.existsSync(path.join(SRC, 'lib/broker-portfolio.ts')), false);
});

test('Alpaca configuration is market-data only regardless of environment', () => {
  const { config } = require('../src/lib/config.ts');
  assert.equal(config.alpaca.dataUrl, 'https://data.alpaca.markets');
  assert.equal('baseUrl' in config.alpaca, false);
  assert.equal('paper' in config.alpaca, false);
});
