require('./register-ts.cjs');
const fs = require('node:fs');
const path = require('node:path');
const { assessEconomy } = require('../src/lib/economy.ts');
const { validateRegimes } = require('../src/lib/regime-validation.ts');
const { cleanSeries } = require('../src/lib/time-series.ts');

// Re-run the CURRENT assessment code over the raw point-in-time series a previous validation run
// saved, so a threshold or wording change can be re-scored without another hour of FRED requests.
// Usage: node scripts/rescore-validation.cjs --input=artifacts/a.json --output=artifacts/b.json [--recession=artifacts/usrec.json]
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
if (!args.input || !args.output) throw new Error('Usage: --input=<saved report> --output=<new report>');
if (fs.existsSync(args.output)) throw new Error('Output already exists; choose a new report path to preserve the audit trail.');
const report = JSON.parse(fs.readFileSync(args.input, 'utf8'));
const recession = args.recession ? JSON.parse(fs.readFileSync(args.recession, 'utf8')) : report.recession;
if (!recession?.length) throw new Error('Recession outcomes missing: the input report has no `recession` field; pass --recession=<USREC json>.');
const snapshots = report.snapshots.map(s => ({ ...s, assessment: assessEconomy(s.series, s.asOf) }));
const out = { ...report, rescoredAt: new Date().toISOString(), rescoredFrom: path.resolve(args.input), validation: validateRegimes(snapshots, cleanSeries(recession)), snapshots, recession };
fs.mkdirSync(path.dirname(args.output), { recursive: true });
fs.writeFileSync(args.output, JSON.stringify(out, null, 2), { flag: 'wx' });
process.stdout.write(`Rescored ${snapshots.length} snapshots -> ${args.output}\n`);
