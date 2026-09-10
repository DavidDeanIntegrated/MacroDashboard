require('./register-ts.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { assessEconomy } = require('../src/lib/economy.ts');
const { validateRegimes } = require('../src/lib/regime-validation.ts');
const { cleanSeries } = require('../src/lib/time-series.ts');

// Re-run the CURRENT assessment code over the raw point-in-time series a previous validation run
// saved, so a threshold or wording change can be re-scored without another hour of FRED requests.
// Usage: node scripts/rescore-validation.cjs --input=artifacts/a.json --output=artifacts/b.json [--recession=artifacts/usrec.json] [--refetch-unavailable]
// --refetch-unavailable: series a run could not fetch (FRED vintage timeouts) are re-fetched from the latest
// vintage truncated to the decision date and recorded as fallbackVintage. Needs FRED_API_KEY.
require('@next/env').loadEnvConfig(path.resolve(__dirname, '..'));
const { getFredSeries } = require('../src/lib/fred.ts');
const { ECONOMIC_INDICATORS } = require('../src/lib/economy.ts');
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
if (!args.input || !args.output) throw new Error('Usage: --input=<saved report> --output=<new report>');
if (fs.existsSync(args.output)) throw new Error('Output already exists; choose a new report path to preserve the audit trail.');
const report = JSON.parse(fs.readFileSync(args.input, 'utf8'));
const recession = args.recession ? JSON.parse(fs.readFileSync(args.recession, 'utf8')) : report.recession;
if (!recession?.length) throw new Error('Recession outcomes missing: the input report has no `recession` field; pass --recession=<USREC json>.');
async function main() {
  let refetched = 0;
  if (args['refetch-unavailable']) {
    if (!process.env.FRED_API_KEY) throw new Error('FRED_API_KEY is required to refetch.');
    const keyOf = Object.fromEntries(ECONOMIC_INDICATORS.map(s => [s.id, s.key]));
    for (const s of report.snapshots) {
      for (const id of [...(s.unavailable ?? [])]) {
        const start = new Date(`${s.asOf}T00:00:00Z`); start.setUTCFullYear(start.getUTCFullYear() - 3);
        try {
          s.series[keyOf[id]] = await getFredSeries(id, start.toISOString().slice(0, 10), s.asOf);
          s.unavailable = s.unavailable.filter(x => x !== id); s.fallbackVintage = [...(s.fallbackVintage ?? []), id]; refetched++;
        } catch (error) { process.stdout.write(`${s.asOf} ${id}: still unavailable (${error.message})\n`); }
        await new Promise(resolve => setTimeout(resolve, 750));
      }
    }
  }
  const snapshots = report.snapshots.map(s => ({ ...s, assessment: assessEconomy(s.series, s.asOf) }));
  const out = { ...report, rescoredAt: new Date().toISOString(), rescoredFrom: path.resolve(args.input), refetched, validation: validateRegimes(snapshots, cleanSeries(recession)), snapshots, recession };
  fs.mkdirSync(path.dirname(args.output), { recursive: true });
  fs.writeFileSync(args.output, JSON.stringify(out, null, 2), { flag: 'wx' });
  process.stdout.write(`Rescored ${snapshots.length} snapshots (${refetched} series refetched) -> ${args.output}\n`);
}
main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
