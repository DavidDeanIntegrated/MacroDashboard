const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Minimum patched versions for the build-tool advisories fixed on 2026-10-09
// (GHSA ids in the PR). Next 15 pins postcss 8.4.31, so package.json overrides it.
const MIN = {
  postcss: '8.5.23',
  nanoid: '3.3.18',
  'source-map-js': '1.2.2',
  flatted: '3.4.2',
};

const cmp = (a, b) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
};

test('lockfile has no build-tool versions below the patched minimums', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(__dirname, '../package-lock.json'), 'utf8'));
  for (const [loc, meta] of Object.entries(lock.packages)) {
    const name = loc.split('node_modules/').pop();
    if (MIN[name]) assert.ok(cmp(meta.version, MIN[name]) >= 0, `${loc} ${meta.version} < ${MIN[name]}`);
  }
});

test('next keeps its postcss override', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  assert.equal(pkg.overrides?.next?.postcss, '^8.5.23');
});
