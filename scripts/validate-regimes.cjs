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
  const inputs = ECONOMIC_INDICATORS.filter(s => s.axis !== 'context' || s.key === 'unemployment');
  // FRED only archives vintages from the day a series was added (T10Y2Y: 2014, HY spread: 2023). Before that
  // date the latest vintage truncated to the decision date is the only option; the report records where it was used.
  // Market series are never revised, so their latest vintage truncated to the decision date IS the
  // point-in-time value; skipping the vintage request also avoids FRED's slow/timing-out daily vintages.
  const NEVER_REVISED = new Set(['T10Y2Y', 'T10Y3M', 'T10YIE', 'DFII10', 'BAMLH0A0HYM2', 'BAMLC0A0CM', 'DRTSCILM']);
  const firstVintage = {};
  for (const s of inputs) {
    const url = `https://api.stlouisfed.org/fred/series/vintagedates?series_id=${s.id}&api_key=${process.env.FRED_API_KEY}&file_type=json&limit=1`;
    try { firstVintage[s.id] = (await (await fetch(url)).json()).vintage_dates?.[0] ?? null; } catch { firstVintage[s.id] = null; }
    requests++; await pause(750);
  }
  process.stdout.write(`First archived vintage per input: ${inputs.map(s => `${s.id} ${firstVintage[s.id] ?? '?'}`).join(', ')}\n`);
  for (let d = new Date(`${args.start}-01T00:00:00Z`); d.toISOString().slice(0, 7) <= args.end; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const asOf = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    if (asOf > new Date().toISOString().slice(0, 10)) break;
    const data = {}, unavailable = [], fallbackVintage = [];
    // ~80 requests/minute, below FRED's documented 120/minute ceiling.
    for (const s of inputs) {
      const start = new Date(`${asOf}T00:00:00Z`); start.setUTCFullYear(start.getUTCFullYear() - 3);
      const archived = !NEVER_REVISED.has(s.id) && firstVintage[s.id] && firstVintage[s.id] <= asOf;
      try { data[s.key] = await getFredSeries(s.id, start.toISOString().slice(0, 10), asOf, undefined, archived ? asOf : undefined); if (!archived) fallbackVintage.push(s.id); }
      catch { data[s.key] = []; unavailable.push(s.id); }
      requests++; await pause(750);
    }
    const assessment = assessEconomy(data, asOf);
    snapshots.push({ asOf, assessment, unavailable, fallbackVintage, series: data });
    process.stdout.write(`${asOf}: ${assessment.label} | ${assessment.outlook.label} | checklist ${assessment.outlook.triggered}/${assessment.outlook.evaluable} | curve ${assessment.outlook.curveModel.probability === null ? '—' : Math.round(assessment.outlook.curveModel.probability * 100) + '%'} | ${unavailable.length} unavailable, ${fallbackVintage.length} fallback-vintage\n`);
  }
  if (!snapshots.some(s => s.assessment.regime !== 'unknown')) throw new Error('No usable vintage assessments. Check FRED access and coverage; no validation report produced.');
  const recession = await getFredSeries('USREC', `${args.start}-01`);
  if (!recession.length) throw new Error('Recession outcomes unavailable.');
  const report = { generatedAt: new Date().toISOString(), provenance: 'FRED realtime_start = realtime_end = decision date for every archived input; latest vintage truncated to the decision date where FRED has no archive (see fallbackVintage per snapshot)', firstVintage, requests,
    validation: validateRegimes(snapshots, recession), snapshots, recession };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), { flag: 'wx' });
  process.stdout.write(`Saved ${output}\n`);
}
main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
