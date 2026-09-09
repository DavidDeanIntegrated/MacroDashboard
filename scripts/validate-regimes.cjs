require('./register-ts.cjs');
const fs = require('node:fs');
const path = require('node:path');
require('@next/env').loadEnvConfig(path.resolve(__dirname, '..'));
const { getFredSeries } = require('../src/lib/fred.ts');
const { assessEconomy, ECONOMIC_INDICATORS } = require('../src/lib/economy.ts');
const { validateRegimes } = require('../src/lib/regime-validation.ts');

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
  if (!args.start || !args.end || !args.output) throw new Error('Usage: npm run validate:regimes -- --start=2007-01 --end=2010-12 --output=artifacts/regime-validation.json');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(args.start) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(args.end) || args.start > args.end || args.end > new Date().toISOString().slice(0, 7)) throw new Error('Use valid chronological historical YYYY-MM dates.');
  if (!process.env.FRED_API_KEY) throw new Error('FRED_API_KEY is required. No historical validation has been performed.');
  const output = path.resolve(args.output);
  if (fs.existsSync(output)) throw new Error('Output already exists; choose a new report path to preserve the audit trail.');
  const snapshots = [];
  let requests = 0;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  for (let d = new Date(`${args.start}-01T00:00:00Z`); d.toISOString().slice(0, 7) <= args.end; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const asOf = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    if (asOf > new Date().toISOString().slice(0, 10)) break;
    const data = {}, unavailable = [];
    // ~60 requests/minute, below FRED's documented 120/minute ceiling.
    for (const s of ECONOMIC_INDICATORS.filter(s => s.axis !== 'context' || s.key === 'unemployment')) {
      const start = new Date(`${asOf}T00:00:00Z`); start.setUTCFullYear(start.getUTCFullYear() - 3);
      try { data[s.key] = await getFredSeries(s.id, start.toISOString().slice(0, 10), asOf, undefined, asOf); }
      catch { data[s.key] = []; unavailable.push(s.id); }
      requests++; await pause(1000);
    }
    snapshots.push({ asOf, assessment: assessEconomy(data, asOf), unavailable, series: data });
    process.stdout.write(`${asOf}: ${snapshots.at(-1).assessment.label}; ${unavailable.length} unavailable series\n`);
  }
  if (!snapshots.some(s => s.assessment.regime !== 'unknown')) throw new Error('No usable vintage assessments. Check FRED access and coverage; no validation report produced.');
  const recession = await getFredSeries('USREC', `${args.start}-01`);
  if (!recession.length) throw new Error('Recession outcomes unavailable.');
  const report = { generatedAt: new Date().toISOString(), provenance: 'FRED realtime_start = realtime_end = decision date for every model input', requests,
    validation: validateRegimes(snapshots, recession), snapshots };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: 'wx' });
  process.stdout.write(`Saved ${output}\n`);
}
main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
