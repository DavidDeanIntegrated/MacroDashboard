// Print a validation report in plain English: per-signal hit rates at 6 and 12 months,
// lead time before each recession onset, and the month-by-month path through the
// interesting windows. Usage: node scripts/summarize-validation.cjs artifacts/report.json
const fs = require('node:fs');
const report = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const v = report.validation;
const pct = x => x === null || x === undefined ? '  —  ' : `${(x * 100).toFixed(0).padStart(4)}%`;
console.log(`${report.rescoredAt ? 'Rescored' : 'Generated'} ${report.rescoredAt ?? report.generatedAt} · ${v.snapshots} monthly snapshots · ${report.requests ?? '?'} FRED requests`);
console.log(`Regime abstentions (Mixed): ${v.abstentions} · regime changes: ${v.regimeChanges}`);
console.log('\nSignal                    horizon  evaluated  TP  FP  FN  TN  precision  recall  false-alarm-rate  abstain');
for (const [key, s] of Object.entries(v.signals)) for (const h of ['sixMonth', 'twelveMonth']) {
  const m = s[h];
  console.log(`${s.name.padEnd(26)}${String(m.horizonMonths).padStart(3)}mo   ${String(m.evaluated).padStart(6)}  ${String(m.truePositive).padStart(3)} ${String(m.falsePositive).padStart(3)} ${String(m.falseNegative).padStart(3)} ${String(m.trueNegative).padStart(3)}  ${pct(m.precision)}     ${pct(m.recall)}       ${pct(m.falsePositiveRate)}        ${m.abstentions}`);
}
console.log('\nLead time before each recession onset (first month the signal was on inside the horizon window):');
for (const [key, s] of Object.entries(v.signals)) {
  const lead = s.twelveMonth.onsetLeadDays.map(o => `${o.onset.slice(0, 7)}: ${o.firstWarning ? `${o.firstWarning.slice(0, 7)} (${Math.round(o.leadDays / 30)} mo)` : 'missed'}`).join(' · ');
  console.log(`  ${s.name.padEnd(24)} ${lead || '(no onsets in window)'}`);
}
const windows = [['2006-06', '2009-12'], ['2019-06', '2020-12'], ['2022-01', '2024-12']];
for (const [a, b] of windows) {
  const rows = v.rows.filter(r => r.asOf >= a && r.asOf <= `${b}-31`);
  if (!rows.length) continue;
  console.log(`\n${a} → ${b}   (R = recession month per USREC)`);
  for (const r of rows) console.log(`  ${r.asOf.slice(0, 7)} ${report.recession?.find(p => p.date.slice(0, 7) === r.asOf.slice(0, 7))?.value === 1 ? 'R' : ' '}  ${r.regime.padEnd(12)} ${String(r.heading ?? '—').padEnd(11)} ${String(r.warningLevel ?? '—').padEnd(9)} curve ${r.curveProbability == null ? ' — ' : pct(r.curveProbability)}  cov g${r.growthCoverage.toFixed(2)} o${r.outlookCoverage == null ? '—' : r.outlookCoverage.toFixed(2)}${r.fallbackVintage?.length ? `  fb${r.fallbackVintage.length}` : ''}`);
}
