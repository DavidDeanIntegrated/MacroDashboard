import { cleanSeries, monthlyMean, monthOffset, percentChange, type Observation } from './time-series';
import type { RegimeKey } from './sleeves';

export type Axis = 'growth' | 'inflation' | 'financial' | 'context' | 'outlook';
type Transform = 'annualized' | 'yoy' | 'level';
export interface IndicatorSpec {
  key: string; id: string; name: string; axis: Axis; family: string;
  transform: Transform; center: number; scale: number; direction: number;
  staleDays: number; units: string; role: string;
  // Months of lag applied to the reading: the yield curve leads growth by about a year, so the
  // outlook scores the slope from 12 months ago, not today's. Staleness is still judged on the latest obs.
  lagMonths?: number;
}
const spec = (key: string, id: string, name: string, axis: Axis, family: string, transform: Transform, center: number, scale: number, direction = 1, staleDays = 100, units = '%', role = 'Coincident', lagMonths?: number): IndicatorSpec => ({ key, id, name, axis, family, transform, center, scale, direction, staleDays, units, role, ...(lagMonths ? { lagMonths } : {}) });
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
  // Outlook-only inputs: they say nothing about where the economy IS, only where it tends to go next.
  // Together with the growth/financial rows tagged 'Leading' they form the forward-looking axis.
  spec('curveSlope', 'T10Y2Y', 'Yield curve slope a year ago (10Y minus 2Y)', 'outlook', 'curve', 'level', 0, 1, 1, 10, 'pp', 'Leading', 12),
  spec('curve10y3m', 'T10Y3M', 'Yield curve slope a year ago (10Y minus 3M)', 'outlook', 'curve', 'level', 0, 1, 1, 10, 'pp', 'Leading', 12),
  spec('leadingIndex', 'USALOLITONOSTSAM', 'OECD composite leading indicator', 'outlook', 'composite', 'level', 100, 1, 1, 100, 'index, 100 = trend', 'Leading'),
  spec('coreCapexOrders', 'NEWORDER', 'Core capital-goods orders', 'outlook', 'orders', 'yoy', 0, 5, 1, 100, '% YoY', 'Leading'),
  spec('consumerSentiment', 'UMCSENT', 'Consumer sentiment', 'outlook', 'sentiment', 'yoy', 0, 15, 1, 100, '% YoY', 'Leading'),
];
export const isLeading = (s: IndicatorSpec) => s.role.startsWith('Leading');

export interface Evidence extends IndicatorSpec {
  date: string | null; raw: number | null; value: number | null; previous: number | null;
  change: number | null; score: number | null; momentum: number | null;
  status: 'available' | 'stale' | 'missing' | 'insufficient'; source: string;
}
export interface AxisSummary { score: number | null; momentum: number | null; coverage: number; families: number; totalFamilies: number; disagreement: boolean }
export interface Warning { key: string; name: string; rule: string; triggered: boolean | null; reading: string; date: string | null; source: string }
export type WarningLevel = 'low' | 'elevated' | 'high' | 'unknown';
export type Heading = 'continuing' | 'slowing' | 'deepening' | 'recovering' | 'unclear';
export interface CurveModel { probability: number | null; spread: number | null; date: string | null; horizonMonths: 12; source: string }
export interface Outlook {
  axis: AxisSummary; heading: Heading; label: string; description: string;
  warnings: Warning[]; triggered: number; evaluable: number; warningLevel: WarningLevel; curveModel: CurveModel;
}
export interface EconomicAssessment {
  asOf: string; version: string; regime: RegimeKey; label: string; description: string;
  inflationTrend: 'rising' | 'falling' | 'stable'; growthTrend: 'accelerating' | 'decelerating' | 'stable';
  latestInflation: number | null; latestUnemployment: number | null;
  axes: Record<'growth' | 'inflation' | 'financial', AxisSummary>;
  outlook: Outlook;
  evidence: Evidence[]; caveats: string[]; changes: { name: string; change: number; date: string }[];
}
export type CoreAxis = 'growth' | 'inflation' | 'financial';
// Plain-English readings of the −1…+1 axis scores, so the UI never has to show a bare number first.
export function describeLevel(axis: CoreAxis, score: number | null): string {
  if (score === null) return 'not enough data';
  if (axis === 'growth') return score > .4 ? 'expanding strongly' : score > .1 ? 'expanding modestly' : score > -.1 ? 'roughly flat' : score > -.4 ? 'contracting modestly' : 'contracting sharply';
  if (axis === 'inflation') return score > .5 ? 'running hot' : score > .25 ? 'running warm' : score > -.25 ? "near the Fed's target" : 'unusually low';
  return score > .4 ? 'tight' : score > .15 ? 'somewhat tight' : score > -.15 ? 'neutral' : score > -.4 ? 'somewhat easy' : 'easy';
}
// The outlook axis is read on the same −1…+1 scale, but its words are about the NEXT few quarters.
export function describeOutlook(score: number | null): string {
  if (score === null) return 'not enough data';
  return score > .3 ? 'pointing to stronger growth' : score > .1 ? 'pointing to continued growth' : score > -.1 ? 'mixed' : score > -.3 ? 'pointing to a slowdown' : 'pointing to contraction';
}
export function describeOutlookMomentum(momentum: number | null): string {
  if (momentum === null) return 'trend unavailable';
  return momentum > .1 ? 'improving' : momentum < -.1 ? 'deteriorating' : 'steady';
}
export const HEADING_PLAIN: Record<Heading, string> = {
  continuing: 'the expansion looks set to continue',
  slowing: 'growth looks likely to slow from here',
  deepening: 'the weakness looks likely to persist or deepen',
  recovering: 'a recovery looks likely to take hold',
  unclear: 'the direction is not clear yet',
};
export const WARNING_PLAIN: Record<WarningLevel, string> = {
  low: 'few recession warning signs are on', elevated: 'several recession warning signs are on',
  high: 'most recession warning signs are on', unknown: 'the recession checklist is not readable',
};
export function describeMomentum(axis: CoreAxis, momentum: number | null): string {
  if (momentum === null) return 'trend unavailable';
  if (axis === 'growth') return momentum > .1 ? 'picking up' : momentum < -.1 ? 'slowing' : 'steady';
  if (axis === 'inflation') return momentum > .1 ? 'building' : momentum < -.1 ? 'easing' : 'steady';
  return momentum > .1 ? 'tightening' : momentum < -.1 ? 'loosening' : 'steady';
}
// What each season has historically meant for a portfolio — same voice as the rest of the dashboard.
export const REGIME_PLAIN: Record<RegimeKey, string> = {
  goldilocks: 'The economy is growing and inflation is contained — historically the friendliest season for stocks, because profits grow while the Fed has little reason to tighten.',
  reflation: 'The economy is growing, but inflation is running above where the Fed wants it. Real assets (commodities, gold) and value stocks have historically led; bonds and expensive growth stocks feel rate pressure.',
  stagflation: "Growth is weak while inflation stays elevated — the hardest season, because the Fed can't cut rates to help growth without feeding inflation. Gold, commodities, and cash have historically held up best.",
  deflation: "Growth is weak and inflation is contained — a slowdown. This season favors safety: cash earning yield, high-quality bonds, and defensive stocks, since the Fed's usual response (rate cuts) rewards exactly those assets.",
  unknown: "The evidence doesn't point clearly one way — growth is close to flat, or too few inputs are available to make the call. Treat this as \"wait for more data\" rather than a signal.",
};
const average = (v: number[]) => v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
// Standard normal CDF via Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7) — enough for a displayed percentage.
export function normalCdf(x: number): number {
  const t = 1 / (1 + .3275911 * Math.abs(x) / Math.SQRT2);
  const poly = t * (.254829592 + t * (-.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(x * x) / 2);
  return .5 * (1 + (x < 0 ? -erf : erf));
}
// Estrella & Trubin (2006, NY Fed Current Issues 12-5): probability of a recession 12 months ahead
// from the monthly-average 10Y minus 3M Treasury spread. Published coefficients, not fitted here.
export const CURVE_MODEL = { alpha: -0.5333, beta: -0.6330, source: 'https://www.newyorkfed.org/research/capital_markets/ycfaq' } as const;
export function curveRecessionProbability(spread: number | null): number | null {
  return spread === null ? null : normalCdf(CURVE_MODEL.alpha + CURVE_MODEL.beta * spread);
}
const clamp = (v: number) => Math.max(-1, Math.min(1, v));
export function assessEconomy(data: Record<string, Observation[]>, asOf = new Date().toISOString().slice(0, 10)): EconomicAssessment {
  const evidence: Evidence[] = ECONOMIC_INDICATORS.map(s => {
    const clean = cleanSeries(data[s.key] ?? [], asOf);
    const last = clean.at(-1);
    const monthly = monthlyMean(clean);
    const transformed = s.transform === 'level' ? monthly : percentChange(monthly, s.transform === 'yoy' ? 12 : 3, s.transform === 'annualized');
    const latest = transformed.at(-1);
    const current = s.lagMonths && latest ? transformed.find(p => p.date.slice(0, 7) === monthOffset(latest.date, -s.lagMonths!)) : latest;
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
  const summarize = (axis: Axis | 'leading'): AxisSummary => {
    // On the borrowing axis a positive score means "tight"; as a leading signal for growth that is bad news, so it enters the outlook with its sign flipped.
    const sign = (e: Evidence) => axis === 'leading' && e.axis === 'financial' ? -1 : 1;
    const rows = evidence.filter(e => axis === 'leading' ? isLeading(e) : e.axis === axis);
    const families = Array.from(new Set(rows.map(e => e.family)));
    const groups = families.map(f => rows.filter(e => e.family === f && e.score !== null));
    const scores = groups.flatMap(g => { const v = average(g.map(e => e.score! * sign(e))); return v === null ? [] : [v]; });
    const momentum = groups.flatMap(g => { const v = average(g.map(e => e.momentum! * sign(e))); return v === null ? [] : [v]; });
    return { score: average(scores), momentum: average(momentum), coverage: rows.filter(e => e.score !== null).length / rows.length,
      families: scores.length, totalFamilies: families.length, disagreement: scores.some(v => v > .15) && scores.some(v => v < -.15) };
  };
  const axes = { growth: summarize('growth'), inflation: summarize('inflation'), financial: summarize('financial') };
  const outlook = buildOutlook(evidence, summarize('leading'), axes.growth, data, asOf);
  const ready = axes.growth.coverage >= .6 && axes.inflation.coverage >= .6 && axes.growth.families >= 3 && axes.inflation.families >= 2;
  const g = axes.growth.score ?? 0, i = axes.inflation.score ?? 0;
  // A neutral zone prevents tiny changes being presented as a decisive regime.
  const regime: RegimeKey = !ready || Math.abs(g) < .1 ? 'unknown' : g > 0 ? i > .25 ? 'reflation' : 'goldilocks' : i > .25 ? 'stagflation' : 'deflation';
  const labels: Record<RegimeKey, string> = { unknown: 'Mixed / not enough evidence', goldilocks: 'Growing, inflation contained', reflation: 'Growing, inflation running warm', stagflation: 'Weak growth, inflation running warm', deflation: 'Weak growth, inflation contained' };
  const inflationTrend = (axes.inflation.momentum ?? 0) > .1 ? 'rising' : (axes.inflation.momentum ?? 0) < -.1 ? 'falling' : 'stable';
  const growthTrend = (axes.growth.momentum ?? 0) > .1 ? 'accelerating' : (axes.growth.momentum ?? 0) < -.1 ? 'decelerating' : 'stable';
  const credit = axes.financial.score === null ? 'unavailable' : axes.financial.score > .15 ? 'restrictive' : axes.financial.score < -.15 ? 'supportive' : 'mixed';
  const caveats = ['Rule-based assessment; scores are not probabilities. Thresholds were checked against 2005–2024 point-in-time data (docs/regime-validation.md) but not tuned to it.',
    'Observation dates differ from publication dates. Daily/weekly monthly averages include the latest partial month; quarterly data are slower.',
    'The Fed’s 2% goal refers to headline PCE. CPI and breakevens are complementary measures, not equivalent targets.',
    'Markets can anticipate or contradict economic releases. This model does not forecast returns.',
    'The outlook reads leading indicators, which have historically turned 6–18 months before the economy; they give direction, not timing. In the 2005–2024 check they caught both recessions early and also called a slowdown in 2022–24 that never came.'];
  if (Object.values(axes).some(a => a.disagreement)) caveats.push('Indicators disagree within at least one axis; inspect the opposing evidence before interpreting the aggregate.');
  if (evidence.some(e => e.status !== 'available')) caveats.push('Stale, missing, and insufficient series are excluded from the axes; coverage shows what remains.');
  const latestInflation = percentChange(data.cpi ?? []).filter(p => p.date <= asOf).at(-1)?.value ?? null;
  const now = `Right now: growth is ${describeLevel('growth', axes.growth.score)} and ${describeMomentum('growth', axes.growth.momentum)}; inflation is ${describeLevel('inflation', axes.inflation.score)} and ${describeMomentum('inflation', axes.inflation.momentum)}; borrowing conditions are ${credit === 'unavailable' ? 'unavailable' : describeLevel('financial', axes.financial.score)}.`;
  return { asOf, version: 'economy-v2', regime, label: labels[regime], description: `${REGIME_PLAIN[regime]} ${now}`,
    inflationTrend, growthTrend, latestInflation, latestUnemployment: cleanSeries(data.unemployment ?? [], asOf).at(-1)?.value ?? null,
    axes, outlook, evidence, caveats, changes: evidence.filter(e => e.status === 'available' && e.change !== null).sort((a, b) => Math.abs(b.momentum ?? 0) - Math.abs(a.momentum ?? 0)).slice(0, 5).map(e => ({ name: e.name, change: e.change!, date: e.date! })) };
}

const fmt = (v: number | null, digits = 1, suffix = '', signed = true) => v === null ? '—' : `${signed && v > 0 ? '+' : ''}${v.toFixed(digits)}${suffix}`;
// Recession warning checklist: each row is a well-known rule of thumb with a published track record,
// evaluated on the same as-of data as everything else. Counted, never summed into a probability.
function buildWarnings(evidence: Evidence[], data: Record<string, Observation[]>, asOf: string): Warning[] {
  const byKey = new Map(evidence.map(e => [e.key, e]));
  const fromEvidence = (key: string, name: string, rule: string, test: (v: number) => boolean, digits = 1, suffix = '%', signed = true): Warning => {
    const e = byKey.get(key);
    const value = e?.status === 'available' ? e.value : null;
    return { key, name, rule, triggered: value === null ? null : test(value), reading: fmt(value, digits, suffix, signed), date: e?.date ?? null, source: e?.source ?? '' };
  };
  // Curve: inverted now, or inverted at any point in the past 12 months (recessions usually begin after the curve re-steepens).
  const curve = monthlyMean(cleanSeries(data.curve10y3m ?? [], asOf)).filter(p => p.date >= `${monthOffset(asOf, -12)}-01`);
  const latestCurve = curve.at(-1) ?? null;
  const lastInverted = [...curve].reverse().find(p => p.value < 0) ?? null;
  const curveWarning: Warning = { key: 'curveInversion', name: 'Yield curve (10Y minus 3M)', rule: 'Inverted now or within the past 12 months',
    triggered: latestCurve ? lastInverted !== null : null,
    reading: latestCurve ? `${fmt(latestCurve.value, 2, ' pp')}${lastInverted ? (lastInverted.date === latestCurve.date ? ' — inverted' : ` — last inverted ${lastInverted.date.slice(0, 7)}`) : ' — no inversion in the past year'}` : '—',
    date: latestCurve?.date ?? null, source: 'https://fred.stlouisfed.org/series/T10Y3M' };
  // Sahm rule on monthly unemployment, official definition.
  const unemp = cleanSeries(data.unemployment ?? [], asOf);
  let sahm: Warning = { key: 'sahm', name: 'Sahm rule (unemployment)', rule: '3-month average rises 0.50 pt above its 12-month low', triggered: null, reading: '—', date: unemp.at(-1)?.date ?? null, source: 'https://fred.stlouisfed.org/series/UNRATE' };
  if (unemp.length >= 15) {
    const avg3 = (i: number) => (unemp[i].value + unemp[i - 1].value + unemp[i - 2].value) / 3;
    const n = unemp.length - 1;
    const low12 = Math.min(...Array.from({ length: 12 }, (_, k) => avg3(n - k - 1)));
    const gap = avg3(n) - low12;
    sahm = { ...sahm, triggered: gap >= .5, reading: `${fmt(gap, 2, ' pt')} above the low (trigger 0.50)` };
  }
  return [
    curveWarning,
    sahm,
    fromEvidence('initialClaims', 'Initial jobless claims', 'Up more than 15% from a year ago', v => v > 15),
    fromEvidence('leadingIndex', 'OECD leading indicator', 'Below 99 (trend = 100)', v => v < 99, 1, '', false),
    fromEvidence('buildingPermits', 'Building permits', 'Down more than 10% from a year ago', v => v < -10),
    fromEvidence('coreCapexOrders', 'Core capital-goods orders', 'Down from a year ago', v => v < 0),
    fromEvidence('lendingStandards', 'Bank lending standards', 'More than 20% of banks tightening (net)', v => v > 20, 0, '% net', false),
    fromEvidence('highYieldSpread', 'High-yield credit spread', 'Above 5 percentage points', v => v > 5, 2, ' pp'),
  ];
}
function buildOutlook(evidence: Evidence[], axis: AxisSummary, growth: AxisSummary, data: Record<string, Observation[]>, asOf: string): Outlook {
  const warnings = buildWarnings(evidence, data, asOf);
  const evaluable = warnings.filter(w => w.triggered !== null).length;
  const triggered = warnings.filter(w => w.triggered).length;
  const warningLevel: WarningLevel = evaluable < 4 ? 'unknown' : triggered >= 4 ? 'high' : triggered >= 2 ? 'elevated' : 'low';
  const curve = monthlyMean(cleanSeries(data.curve10y3m ?? [], asOf)).at(-1) ?? null;
  const curveModel: CurveModel = { probability: curveRecessionProbability(curve?.value ?? null), spread: curve?.value ?? null, date: curve?.date ?? null, horizonMonths: 12, source: CURVE_MODEL.source };
  const ready = axis.coverage >= .5 && axis.families >= 3 && axis.score !== null;
  const o = axis.score ?? 0, g = growth.score ?? 0;
  const heading: Heading = !ready || Math.abs(o) < .1 || growth.score === null ? 'unclear'
    : o > 0 ? (g >= -.1 ? 'continuing' : 'recovering') : (g > .1 ? 'slowing' : 'deepening');
  const labels: Record<Heading, string> = { continuing: 'Expansion likely to continue', slowing: 'Growth likely to slow', deepening: 'Weakness likely to persist', recovering: 'Recovery likely', unclear: 'Direction unclear' };
  const odds = curveModel.probability === null ? '' : ` The yield-curve model puts the chance of a recession starting within 12 months at about ${Math.round(curveModel.probability * 100)}%.`;
  const description = `Looking ahead: ${HEADING_PLAIN[heading]} — leading indicators are ${describeOutlook(axis.score)} (trend: ${describeOutlookMomentum(axis.momentum)}), and ${WARNING_PLAIN[warningLevel]}${evaluable ? ` (${triggered} of ${evaluable})` : ''}.${odds}`;
  return { axis, heading, label: labels[heading], description, warnings, triggered, evaluable, warningLevel, curveModel };
}
