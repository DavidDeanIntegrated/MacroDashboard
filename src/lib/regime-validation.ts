import type { EconomicAssessment } from './economy';
import { cleanSeries, monthOffset, type Observation } from './time-series';

export interface VintageAssessment { asOf: string; assessment: EconomicAssessment }
export function validateRegimes(snapshots: VintageAssessment[], recessionSeries: Observation[]) {
  const outcomes = new Map(cleanSeries(recessionSeries).map(p => [p.date.slice(0, 7), p.value]));
  const rows = [...snapshots].sort((a, b) => a.asOf.localeCompare(b.asOf)).map(s => {
    if (s.asOf !== s.assessment.asOf) throw new Error('Assessment date does not match vintage.');
    const future = Array.from({ length: 6 }, (_, i) => outcomes.get(monthOffset(s.asOf, i + 1)));
    const complete = future.every(v => v === 0 || v === 1);
    const warning = ['deflation', 'stagflation'].includes(s.assessment.regime);
    const recessionWithin6Months = complete ? future.some(v => v === 1) : null;
    return { asOf: s.asOf, regime: s.assessment.regime, warning, recessionWithin6Months,
      evaluable: complete && s.assessment.regime !== 'unknown', growthCoverage: s.assessment.axes.growth.coverage, inflationCoverage: s.assessment.axes.inflation.coverage };
  });
  const evaluable = rows.filter(r => r.evaluable);
  const truePositive = evaluable.filter(r => r.warning && r.recessionWithin6Months).length;
  const falsePositive = evaluable.filter(r => r.warning && !r.recessionWithin6Months).length;
  const falseNegative = evaluable.filter(r => !r.warning && r.recessionWithin6Months).length;
  const trueNegative = evaluable.filter(r => !r.warning && !r.recessionWithin6Months).length;
  const recessionMonths = cleanSeries(recessionSeries).filter(p => p.value === 1);
  const onsets = recessionMonths.filter(p => outcomes.get(monthOffset(p.date, -1)) === 0);
  const onsetLeadDays = onsets.map(o => {
    const candidates = rows.filter(r => r.warning && r.asOf >= `${monthOffset(o.date, -6)}-01` && r.asOf <= o.date);
    return { onset: o.date, firstWarning: candidates[0]?.asOf ?? null, leadDays: candidates.length ? (Date.parse(o.date) - Date.parse(candidates[0].asOf)) / 86400000 : null };
  }).filter(o => rows.length && o.onset >= rows[0].asOf && o.onset <= rows.at(-1)!.asOf);
  return { version: 'validation-v1', target: 'Recession in the next six calendar months (final USREC labels)',
    snapshots: rows.length, evaluated: evaluable.length, abstentions: rows.filter(r => r.regime === 'unknown').length,
    incompleteOutcomes: rows.filter(r => r.recessionWithin6Months === null).length,
    truePositive, falsePositive, falseNegative, trueNegative,
    precision: truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : null,
    recall: truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : null,
    falsePositiveRate: falsePositive + trueNegative ? falsePositive / (falsePositive + trueNegative) : null,
    regimeChanges: rows.slice(1).filter((r, i) => r.regime !== rows[i].regime).length,
    onsetLeadDays, rows,
    limitations: ['Diagnostic of a weak-growth warning, not ground truth for all four economic regimes.', 'Six-month outcome windows overlap; observations are not independent.', 'USREC is an ex-post outcome label, never an input to the classifier.', 'Thresholds are not calibrated; this report is not a probability model or an investment-strategy backtest.', 'Missing historical series can reduce coverage and cause abstentions.'] };
}
