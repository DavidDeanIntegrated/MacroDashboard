import { cleanSeries, monthlyMean, monthOffset, percentChange, type Observation } from './time-series';
import type { RegimeKey } from './sleeves';

export type Axis = 'growth' | 'inflation' | 'financial' | 'context';
type Transform = 'annualized' | 'yoy' | 'level';
export interface IndicatorSpec {
  key: string; id: string; name: string; axis: Axis; family: string;
  transform: Transform; center: number; scale: number; direction: number;
  staleDays: number; units: string; role: string;
}
const spec = (key: string, id: string, name: string, axis: Axis, family: string, transform: Transform, center: number, scale: number, direction = 1, staleDays = 100, units = '%', role = 'Coincident'): IndicatorSpec => ({ key, id, name, axis, family, transform, center, scale, direction, staleDays, units, role });
// Family averages prevent several correlated labor/price series from dominating.
// Thresholds are transparent heuristics; no probabilities or fitted confidence.
export const ECONOMIC_INDICATORS: IndicatorSpec[] = [
  spec('realConsumption', 'PCEC96', 'Real consumer spending', 'growth', 'demand', 'annualized', 0, 3),
  spec('realIncome', 'DSPIC96', 'Real disposable income', 'growth', 'demand', 'annualized', 0, 3),
  spec('payrolls', 'PAYEMS', 'Total payroll employment', 'growth', 'labor', 'annualized', 0, 2),
  spec('unemployment', 'UNRATE', 'Unemployment', 'context', 'labor', 'level', 0, 1),
  spec('initialClaims', 'ICSA', 'Initial claims', 'growth', 'labor', 'yoy', 0, 20, -1, 21, '% YoY', 'Leading'),
  spec('continuingClaims', 'CCSA', 'Continuing claims', 'growth', 'labor', 'yoy', 0, 20, -1, 28, '% YoY', 'Leading'),
  spec('hours', 'AWHAETP', 'Private weekly hours', 'growth', 'labor', 'annualized', 0, 2, 1, 100, '% annualized', 'Leading'),
  spec('industrialProduction', 'INDPRO', 'Industrial production', 'growth', 'production', 'annualized', 0, 5),
  spec('buildingPermits', 'PERMIT', 'Building permits', 'growth', 'housing', 'yoy', 0, 15, 1, 100, '% YoY', 'Leading'),
  spec('realGdp', 'GDPC1', 'Real GDP', 'growth', 'output', 'annualized', 0, 3, 1, 200, '% annualized', 'Lagging / quarterly'),
  spec('corePce', 'PCEPILFE', 'Core PCE inflation', 'inflation', 'pce', 'annualized', 2, 2),
  spec('pce', 'PCEPI', 'Headline PCE inflation', 'inflation', 'pce', 'annualized', 2, 2),
  spec('cpi', 'CPIAUCSL', 'CPI inflation', 'inflation', 'cpi', 'annualized', 2, 2),
  spec('coreCpi', 'CPILFESL', 'Core CPI inflation', 'inflation', 'cpi', 'annualized', 2, 2),
  spec('breakeven10y', 'T10YIE', '10-year inflation compensation', 'inflation', 'expectations', 'level', 2, 1, 1, 10, '%', 'Market pricing'),
  spec('highYieldSpread', 'BAMLH0A0HYM2', 'High-yield credit spread', 'financial', 'credit', 'level', 4, 2, 1, 10),
  spec('igSpread', 'BAMLC0A0CM', 'Investment-grade credit spread', 'financial', 'credit', 'level', 1.2, 1, 1, 10),
  spec('financialConditions', 'NFCI', 'Chicago Fed financial conditions', 'financial', 'conditions', 'level', 0, 1, 1, 21, 'index'),
  spec('lendingStandards', 'DRTSCILM', 'Banks tightening business lending', 'financial', 'banks', 'level', 0, 30, 1, 200, 'net %', 'Leading / quarterly'),
  spec('realYield', 'DFII10', '10-year real Treasury yield', 'financial', 'rates', 'level', 1, 2, 1, 10),
  spec('dollar', 'DTWEXBGS', 'Broad trade-weighted dollar', 'financial', 'currency', 'yoy', 0, 10, 1, 14),
  spec('cardDelinquency', 'DRCCLACBS', 'Credit-card delinquency', 'context', 'households', 'level', 0, 1, 1, 200),
  spec('debtService', 'TDSP', 'Household debt-service burden', 'context', 'households', 'level', 0, 1, 1, 200),
  spec('savingRate', 'PSAVERT', 'Personal saving rate', 'context', 'households', 'level', 0, 1),
  spec('jobOpenings', 'JTSJOL', 'Job openings', 'context', 'labor', 'yoy', 0, 1, 1, 120),
  spec('quits', 'JTSQUR', 'Quits rate', 'context', 'labor', 'level', 0, 1, 1, 120),
  spec('wages', 'CES0500000003', 'Average hourly earnings', 'context', 'labor', 'yoy', 0, 1),
  spec('businessLoans', 'BUSLOANS', 'Commercial and industrial loans', 'context', 'credit', 'yoy', 0, 1, 1, 21),
  spec('investment', 'PNFIC1', 'Real business fixed investment', 'context', 'investment', 'annualized', 0, 1, 1, 200),
  spec('government', 'GCEC1', 'Real government consumption and investment', 'context', 'fiscal', 'annualized', 0, 1, 1, 200),
  spec('services', 'PCES', 'Nominal consumer services spending', 'context', 'services', 'yoy', 0, 1),
  spec('fedAssets', 'WALCL', 'Federal Reserve assets', 'context', 'liquidity', 'yoy', 0, 1, 1, 21),
  spec('euroProduction', 'EA19PRMNTO01IXOBM', 'Euro-area manufacturing production', 'context', 'global', 'yoy', 0, 1, 1, 150),
  spec('chinaProduction', 'CHNPRINTO01IXPYM', 'China industrial production (prior year = 100)', 'context', 'global', 'level', 0, 1, 1, 150, 'index, prior year = 100'),
];

export interface Evidence extends IndicatorSpec {
  date: string | null; raw: number | null; value: number | null; previous: number | null;
  change: number | null; score: number | null; momentum: number | null;
  status: 'available' | 'stale' | 'missing' | 'insufficient'; source: string;
}
export interface AxisSummary { score: number | null; momentum: number | null; coverage: number; families: number; totalFamilies: number; disagreement: boolean }
export interface EconomicAssessment {
  asOf: string; version: string; regime: RegimeKey; label: string; description: string;
  inflationTrend: 'rising' | 'falling' | 'stable'; growthTrend: 'accelerating' | 'decelerating' | 'stable';
  latestInflation: number | null; latestUnemployment: number | null;
  axes: Record<'growth' | 'inflation' | 'financial', AxisSummary>;
  evidence: Evidence[]; caveats: string[]; changes: { name: string; change: number; date: string }[];
}
const average = (v: number[]) => v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
const clamp = (v: number) => Math.max(-1, Math.min(1, v));
export function assessEconomy(data: Record<string, Observation[]>, asOf = new Date().toISOString().slice(0, 10)): EconomicAssessment {
  const evidence: Evidence[] = ECONOMIC_INDICATORS.map(s => {
    const clean = cleanSeries(data[s.key] ?? [], asOf);
    const last = clean.at(-1);
    const monthly = monthlyMean(clean);
    const transformed = s.transform === 'level' ? monthly : percentChange(monthly, s.transform === 'yoy' ? 12 : 3, s.transform === 'annualized');
    const current = transformed.at(-1);
    const previous = current ? transformed.find(p => p.date.slice(0, 7) === monthOffset(current.date, -3)) : undefined;
    const age = last ? (Date.parse(asOf) - Date.parse(last.date)) / 86400000 : Infinity;
    const status: Evidence['status'] = !last ? 'missing' : age > s.staleDays ? 'stale' : !current || !previous ? 'insufficient' : 'available';
    const value = current?.value ?? null;
    const change = current && previous ? current.value - previous.value : null;
    return { ...s, date: last?.date ?? null, raw: last?.value ?? null, value, previous: previous?.value ?? null, change,
      score: status === 'available' && value !== null ? clamp((value - s.center) / s.scale * s.direction) : null,
      momentum: status === 'available' && change !== null ? clamp(change / s.scale * s.direction) : null,
      status, source: `https://fred.stlouisfed.org/series/${s.id}` };
  });
  const summarize = (axis: Axis): AxisSummary => {
    const rows = evidence.filter(e => e.axis === axis);
    const families = Array.from(new Set(rows.map(e => e.family)));
    const groups = families.map(f => rows.filter(e => e.family === f && e.score !== null));
    const scores = groups.flatMap(g => { const v = average(g.map(e => e.score!)); return v === null ? [] : [v]; });
    const momentum = groups.flatMap(g => { const v = average(g.map(e => e.momentum!)); return v === null ? [] : [v]; });
    return { score: average(scores), momentum: average(momentum), coverage: rows.filter(e => e.score !== null).length / rows.length,
      families: scores.length, totalFamilies: families.length, disagreement: scores.some(v => v > .15) && scores.some(v => v < -.15) };
  };
  const axes = { growth: summarize('growth'), inflation: summarize('inflation'), financial: summarize('financial') };
  const ready = axes.growth.coverage >= .6 && axes.inflation.coverage >= .6 && axes.growth.families >= 3 && axes.inflation.families >= 2;
  const g = axes.growth.score ?? 0, i = axes.inflation.score ?? 0;
  // A neutral zone prevents tiny changes being presented as a decisive regime.
  const regime: RegimeKey = !ready || Math.abs(g) < .1 ? 'unknown' : g > 0 ? i > .25 ? 'reflation' : 'goldilocks' : i > .25 ? 'stagflation' : 'deflation';
  const labels: Record<RegimeKey, string> = { unknown: 'Mixed / insufficient evidence', goldilocks: 'Expansion / contained inflation', reflation: 'Expansion / inflation pressure', stagflation: 'Weak growth / inflation pressure', deflation: 'Weak growth / contained inflation' };
  const inflationTrend = (axes.inflation.momentum ?? 0) > .1 ? 'rising' : (axes.inflation.momentum ?? 0) < -.1 ? 'falling' : 'stable';
  const growthTrend = (axes.growth.momentum ?? 0) > .1 ? 'accelerating' : (axes.growth.momentum ?? 0) < -.1 ? 'decelerating' : 'stable';
  const credit = axes.financial.score === null ? 'unavailable' : axes.financial.score > .15 ? 'restrictive' : axes.financial.score < -.15 ? 'supportive' : 'mixed';
  const caveats = ['Rule-based assessment; scores are not probabilities. Thresholds have not been calibrated out of sample.',
    'Observation dates differ from publication dates. Daily/weekly monthly averages include the latest partial month; quarterly data are slower.',
    'The Fed’s 2% goal refers to headline PCE. CPI and breakevens are complementary measures, not equivalent targets.',
    'Markets can anticipate or contradict economic releases. This model does not forecast returns.'];
  if (Object.values(axes).some(a => a.disagreement)) caveats.push('Indicators disagree within at least one axis; inspect the opposing evidence before interpreting the aggregate.');
  if (evidence.some(e => e.status !== 'available')) caveats.push('Stale, missing, and insufficient series are excluded from the axes; coverage shows what remains.');
  const latestInflation = percentChange(data.cpi ?? []).filter(p => p.date <= asOf).at(-1)?.value ?? null;
  return { asOf, version: 'economy-v1', regime, label: labels[regime], description: `${labels[regime]}. Growth momentum is ${axes.growth.momentum === null ? 'unavailable' : growthTrend}; inflation pressure is ${axes.inflation.momentum === null ? 'unavailable' : inflationTrend}. Financial conditions are ${credit}.`,
    inflationTrend, growthTrend, latestInflation, latestUnemployment: cleanSeries(data.unemployment ?? [], asOf).at(-1)?.value ?? null,
    axes, evidence, caveats, changes: evidence.filter(e => e.status === 'available' && e.change !== null).sort((a, b) => Math.abs(b.momentum ?? 0) - Math.abs(a.momentum ?? 0)).slice(0, 5).map(e => ({ name: e.name, change: e.change!, date: e.date! })) };
}
