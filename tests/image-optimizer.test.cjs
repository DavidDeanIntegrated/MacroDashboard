const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('image optimizer stays disabled while no page uses next/image', () => {
  const cfg = fs.readFileSync(path.join(__dirname, '../next.config.mjs'), 'utf8');
  assert.match(cfg, /unoptimized:\s*true/);
  assert.doesNotMatch(cfg, /remotePatterns|domains:/);
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
  for (const f of walk(path.join(__dirname, '../src')).filter((f) => /\.(ts|tsx)$/.test(f))) {
    assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /from ['"]next\/image['"]/, f);
  }
});
