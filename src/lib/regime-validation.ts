import type { EconomicAssessment } from './economy';
import { cleanSeries, monthOffset, type Observation } from './time-series';

export interface VintageAssessment { asOf: string; assessment: EconomicAssessment; fallbackVintage?: string[] }
export type SignalKey = 'regime' | 'outlook' | 'checklist' | 'curve';
// Every forward-looking read the dashboard makes, expressed as a yes/no warning so they can be
// scored against the same outcome. The regime one is what the validator always scored; the
// other three are the "Where it's heading" layer.
export const SIGNALS: Record<SignalKey, { name: string; rule: string; warning: (a: EconomicAssessment) => boolean | null }> = {
  regime: { name: 'Regime label', rule: 'Label is a weak-growth season (deflation or stagflation)', warning: a => a.regime === 'unknown' ? null : ['deflation', 'stagflation'].includes(a.regime) },
  outlook: { name: 'Outlook heading', rule: 'Heading is "growth likely to slow" or "weakness likely to persist"', warning: a => !a.outlook || a.outlook.heading === 'unclear' ? null : ['slowing', 'deepening'].includes(a.outlook.heading) },
  checklist: { name: 'Recession checklist', rule: 'Two or more warning signs on (elevated or high)', warning: a => !a.outlook || a.outlook.warningLevel === 'unknown' ? null : a.outlook.warningLevel !== 'low' },
  curve: { name: 'Yield-curve model', rule: 'Published probit ≥ 30% for a recession within 12 months', warning: a => a.outlook?.curveModel.probability == null ? null : a.outlook.curveModel.probability >= .3 },
};
export interface SignalRow { asOf: string; warning: boolean | null; recessionWithin6Months: boolean | null; recessionWithin12Months: boolean | null }
function score(rows: SignalRow[], horizon: 6 | 12, onsets: string[]) {
  const key = horizon === 6 ? 'recessionWithin6Months' : 'recessionWithin12Months';
  const evaluable = rows.filter(r => r.warning !== null && r[key] !== null);
  const tp = evaluable.filter(r => r.warning && r[key]).length, fp = evaluable.filter(r => r.warning && !r[key]).length;
  const fn = evaluable.filter(r => !r.warning && r[key]).length, tn = evaluable.filter(r => !r.warning && !r[key]).length;
  const onsetLeadDays = onsets.map(onset => {
    const window = rows.filter(r => r.warning && r.asOf >= `${monthOffset(onset, -horizon)}-01` && r.asOf <= onset);
    return { onset, firstWarning: window[0]?.asOf ?? null, leadDays: window.length ? (Date.parse(onset) - Date.parse(window[0].asOf)) / 86400000 : null };
  });
  return { horizonMonths: horizon, evaluated: evaluable.length, abstentions: rows.filter(r => r.warning === null).length,
    truePositive: tp, falsePositive: fp, falseNegative: fn, trueNegative: tn,
    precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null, falsePositiveRate: fp + tn ? fp / (fp + tn) : null,
    onsetLeadDays };
}
export function validateRegimes(snapshots: VintageAssessment[], recessionSeries: Observation[]) {
  const outcomes = new Map(cleanSeries(recessionSeries).map(p => [p.date.slice(0, 7), p.value]));
  const sorted = [...snapshots].sort((a, b) => a.asOf.localeCompare(b.asOf));
  const within = (asOf: string, months: number) => {
    const future = Array.from({ length: months }, (_, i) => outcomes.get(monthOffset(asOf, i + 1)));
    return future.every(v => v === 0 || v === 1) ? future.some(v => v === 1) : null;
  };
  const rows = sorted.map(s => {
    if (s.asOf !== s.assessment.asOf) throw new Error('Assessment date does not match vintage.');
    const recessionWithin6Months = within(s.asOf, 6), recessionWithin12Months = within(s.asOf, 12);
    const warning = SIGNALS.regime.warning(s.assessment) === true;
    return { asOf: s.asOf, regime: s.assessment.regime, warning, recessionWithin6Months, recessionWithin12Months,
      heading: s.assessment.outlook?.heading ?? null, warningLevel: s.assessment.outlook?.warningLevel ?? null, curveProbability: s.assessment.outlook?.curveModel.probability ?? null,
      evaluable: recessionWithin6Months !== null && s.assessment.regime !== 'unknown',
      growthCoverage: s.assessment.axes.growth.coverage, inflationCoverage: s.assessment.axes.inflation.coverage, outlookCoverage: s.assessment.outlook?.axis.coverage ?? null,
      fallbackVintage: s.fallbackVintage ?? [] };
  });
  const recessionMonths = cleanSeries(recessionSeries).filter(p => p.value === 1);
  const onsets = recessionMonths.filter(p => outcomes.get(monthOffset(p.date, -1)) === 0).map(p => p.date)
    .filter(o => rows.length && o >= rows[0].asOf && o <= rows.at(-1)!.asOf);
  const signals = Object.fromEntries((Object.keys(SIGNALS) as SignalKey[]).map(key => {
    const signalRows: SignalRow[] = sorted.map((s, i) => ({ asOf: s.asOf, warning: SIGNALS[key].warning(s.assessment), recessionWithin6Months: rows[i].recessionWithin6Months, recessionWithin12Months: rows[i].recessionWithin12Months }));
    return [key, { name: SIGNALS[key].name, rule: SIGNALS[key].rule, sixMonth: score(signalRows, 6, onsets), twelveMonth: score(signalRows, 12, onsets) }];
  }));
  const regime6 = signals.regime.sixMonth;
  return { version: 'validation-v2', target: 'Recession in the next six calendar months (final USREC labels); twelve-month scoring alongside for the curve model',
    snapshots: rows.length, evaluated: regime6.evaluated, abstentions: rows.filter(r => r.regime === 'unknown').length,
    incompleteOutcomes: rows.filter(r => r.recessionWithin6Months === null).length,
    truePositive: regime6.truePositive, falsePositive: regime6.falsePositive, falseNegative: regime6.falseNegative, trueNegative: regime6.trueNegative,
    precision: regime6.precision, recall: regime6.recall, falsePositiveRate: regime6.falsePositiveRate,
    regimeChanges: rows.slice(1).filter((r, i) => r.regime !== rows[i].regime).length,
    onsetLeadDays: regime6.onsetLeadDays, signals, rows,
    limitations: ['Diagnostic of a weak-growth warning, not ground truth for all four economic regimes.', 'Six-month outcome windows overlap; observations are not independent.', 'USREC is an ex-post outcome label, never an input to the classifier.', 'Thresholds are not calibrated; this report is not a probability model or an investment-strategy backtest.', 'Missing historical series can reduce coverage and cause abstentions.',
      'Series FRED did not archive at the decision date use the latest vintage truncated to that date (listed per snapshot as fallbackVintage). Yields, spreads, and surveys are never revised, so that is exact; claims, hours, NFCI, and the OECD leading indicator are revised, so their fallback carries some look-ahead.'] };
}
