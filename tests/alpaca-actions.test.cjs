require('../scripts/register-ts.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { isPublicAlpacaAction, PUBLIC_ALPACA_ACTIONS } = require('../src/lib/alpaca-actions.ts');

test('brokerage account and position reads are not public actions', () => {
  for (const action of ['account', 'positions', 'orders', 'order', 'cancel', null, '']) {
    assert.equal(isPublicAlpacaAction(action), false, String(action));
  }
});

test('every action the UI requests stays public', () => {
  const hooks = fs.readFileSync(path.join(__dirname, '../src/lib/hooks.ts'), 'utf8');
  const used = [...hooks.matchAll(/\/api\/alpaca\?action=([a-z-]+)/g)].map((m) => m[1]);
  assert.ok(used.length > 0);
  for (const action of used) assert.ok(isPublicAlpacaAction(action), action);
});

test('the route exports GET only and no longer calls account or position reads', () => {
  const route = fs.readFileSync(path.join(__dirname, '../src/app/api/alpaca/route.ts'), 'utf8');
  assert.doesNotMatch(route, /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(route, /getAccount|getPositions/);
  assert.match(route, /isPublicAlpacaAction\(action\)/);
  assert.deepEqual([...PUBLIC_ALPACA_ACTIONS].sort(), ['bars', 'portfolio', 'portfolio-chart', 'snapshot', 'watchlist']);
});
