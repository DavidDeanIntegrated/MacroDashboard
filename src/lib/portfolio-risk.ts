import { alignedReturns, cleanSeries, covariance, type Close, type Observation } from './time-series';
import type { HoldingPosition } from './holdings';

export interface RiskEstimate {
  status: string; observations: number; start: string | null; end: string | null;
  coveredWeight: number; excluded: string[]; annualizedVolatility: number | null;
  contributions: { symbol: string; weight: number; varianceShare: number }[];
}
// Common sample across every holding: covariance remains positive semidefinite.
// Do not renormalize away an asset with missing history.
export function portfolioRisk(positions: HoldingPosition[], histories: Record<string, Close[]>): RiskEstimate {
  const excluded = positions.filter(p => (histories[p.symbol]?.length ?? 0) < 61).map(p => p.symbol);
  const coveredWeight = positions.filter(p => !excluded.includes(p.symbol)).reduce((s, p) => s + p.weight, 0);
  const empty: RiskEstimate = { status: 'Insufficient history for the full portfolio', observations: 0, start: null, end: null, coveredWeight, excluded, annualizedVolatility: null, contributions: [] };
  if (!positions.length || excluded.length) return empty;
  const { dates, returns } = alignedReturns(positions.map(p => histories[p.symbol]));
  const base = { ...empty, observations: dates.length, start: dates[0] ?? null, end: dates.at(-1) ?? null };
  if (dates.length < 60) return base;
  const weights = positions.map(p => p.weight / 100);
  if (Math.abs(weights.reduce((s, w) => s + w, 0) - 1) > .001) return { ...base, status: 'Weights do not sum to 100%; valuation incomplete' };
  const portfolio = dates.map((_, i) => returns.reduce((s, r, j) => s + weights[j] * r[i], 0));
  const variance = covariance(portfolio, portfolio)!;
  if (variance <= 0) return { ...base, status: 'No measurable variation' };
  return { ...base, status: 'Measured from common-date price returns', annualizedVolatility: Math.sqrt(variance * 252) * 100,
    contributions: positions.map((p, i) => ({ symbol: p.symbol, weight: p.weight, varianceShare: weights[i] * covariance(returns[i], portfolio)! / variance * 100 })).sort((a, b) => b.varianceShare - a.varianceShare) };
}

export interface Sensitivity { beta: number | null; standardError: number | null; rSquared: number | null; observations: number; start: string | null; end: string | null }
// Separate univariate associations: these coefficients must NOT be added as if
// they were independent causal exposures. Units: return pp per factor pp.
export function factorSensitivity(prices: Close[], factor: Observation[], mode: 'return' | 'difference'): Sensitivity {
  const p = new Map(cleanSeries(prices.map(p => ({ date: p.date, value: p.close }))).filter(p => p.value > 0).map(p => [p.date, p.value]));
  const f = new Map(cleanSeries(factor).map(p => [p.date, p.value]));
  const dates = Array.from(p.keys()).filter(d => f.has(d)).sort();
  const x: number[] = [], y: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const a = dates[i - 1], b = dates[i];
    if (mode === 'return' && f.get(a)! <= 0) continue;
    x.push(mode === 'return' ? (f.get(b)! / f.get(a)! - 1) * 100 : f.get(b)! - f.get(a)!);
    y.push((p.get(b)! / p.get(a)! - 1) * 100);
  }
  const base: Sensitivity = { beta: null, standardError: null, rSquared: null, observations: x.length, start: dates[1] ?? null, end: dates.at(-1) ?? null };
  if (x.length < 60) return base;
  const vx = covariance(x, x)!, vy = covariance(y, y)!;
  if (vx <= 1e-12 || vy <= 1e-12) return base;
  const beta = covariance(x, y)! / vx;
  const rSquared = Math.min(1, Math.max(0, covariance(x, y)! ** 2 / (vx * vy)));
  return { ...base, beta, rSquared, standardError: Math.sqrt((1 - rSquared) * vy / ((x.length - 2) * vx)) };
}

export const SCENARIOS = ['Demand recession', 'Inflation resurgence', 'Higher real yields', 'Liquidity shock'] as const;
export type Scenario = typeof SCENARIOS[number];
// Explicit illustrative mark-to-market assumptions, not return forecasts.
const SHOCKS: Record<string, number[]> = {
  'Broad Market': [-25, -10, -12, -30], Value: [-25, -5, -8, -30], International: [-25, -10, -12, -30],
  'Quality Compounder': [-35, -20, -25, -40], 'High Conviction': [-40, -20, -25, -45],
  'Conviction Core': [-50, -30, -35, -60], Gold: [10, 10, -15, -10], Commodity: [-25, 20, -10, -25],
  'Dry Powder': [0, 0, 0, 0], Crypto: [-50, -30, -35, -60],
};
export function scenarioDefaults(positions: HoldingPosition[], scenario: Scenario): Record<string, number> {
  return Object.fromEntries(positions.map(p => [p.symbol, SHOCKS[p.category]?.[SCENARIOS.indexOf(scenario)] ?? -30]));
}
export function stressPortfolio(positions: HoldingPosition[], shocks: Record<string, number>) {
  if (positions.some(p => !Number.isFinite(shocks[p.symbol]) || shocks[p.symbol] < -100 || shocks[p.symbol] > 300)) throw new Error('Each holding needs a shock between −100% and +300%.');
  const rows = positions.map(p => ({ symbol: p.symbol, shock: shocks[p.symbol], contribution: p.weight / 100 * shocks[p.symbol], dollars: p.marketValue * shocks[p.symbol] / 100 }));
  return { rows: rows.sort((a, b) => a.contribution - b.contribution), percent: rows.reduce((s, p) => s + p.contribution, 0), dollars: rows.reduce((s, p) => s + p.dollars, 0) };
}

export interface Constituent { fund: string; symbol: string; weight: number; asOf: string; source: string }
export interface ResearchObservation {
  symbol: string; metric: string; value: number; units: string; asOf: string; period: string;
  source: string; kind: 'estimate' | 'guidance' | 'operating' | 'actual' | 'consensus';
}
export interface ResearchInputs { constituents: Constituent[]; observations: ResearchObservation[] }
const symbolPattern = /^[A-Z0-9.^:/_-]{1,24}$/;
function validDate(s: unknown): s is string { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s && s <= new Date().toISOString().slice(0, 10); }
function sourceUrl(s: unknown): boolean { try { return typeof s === 'string' && ['https:', 'http:'].includes(new URL(s).protocol); } catch { return false; } }
export function parseResearchInputs(value: unknown): ResearchInputs {
  if (!value || typeof value !== 'object') throw new Error('Expected a research JSON object.');
  const input = value as ResearchInputs;
  if (!Array.isArray(input.constituents) || !Array.isArray(input.observations) || input.constituents.length > 20000 || input.observations.length > 5000) throw new Error('Provide constituents and observations arrays within the row limits.');
  const keys = new Set<string>(), totals = new Map<string, number>(), snapshots = new Map<string, string>();
  for (const row of input.constituents) {
    if (!row || !symbolPattern.test(row.fund) || !symbolPattern.test(row.symbol) || !Number.isFinite(row.weight) || row.weight <= 0 || row.weight > 100 || !validDate(row.asOf) || !sourceUrl(row.source)) throw new Error('Invalid constituent: fund, symbol, weight (0–100), date and source URL are required.');
    const key = `${row.fund}:${row.symbol}`;
    if (keys.has(key)) throw new Error(`Duplicate constituent ${key}. Import one snapshot per fund.`);
    keys.add(key);
    if (snapshots.has(row.fund) && snapshots.get(row.fund) !== row.asOf) throw new Error(`Mixed snapshot dates for ${row.fund}.`);
    snapshots.set(row.fund, row.asOf);
    totals.set(row.fund, (totals.get(row.fund) ?? 0) + row.weight);
    if (totals.get(row.fund)! > 100.01) throw new Error(`Constituents exceed 100% for ${row.fund}.`);
  }
  keys.clear();
  for (const row of input.observations) {
    if (!row || !symbolPattern.test(row.symbol) || typeof row.metric !== 'string' || !row.metric || row.metric.length > 100 || !Number.isFinite(row.value) || typeof row.units !== 'string' || !row.units || typeof row.period !== 'string' || !row.period || !validDate(row.asOf) || !sourceUrl(row.source) || !['estimate', 'guidance', 'operating', 'actual', 'consensus'].includes(row.kind)) throw new Error('Invalid observation: symbol, metric, finite value, units, period, kind, asOf and source URL are required.');
    const key = [row.symbol, row.metric, row.units, row.period, row.kind, row.asOf].join(':');
    if (keys.has(key)) throw new Error('Duplicate research observation.');
    keys.add(key);
  }
  return input;
}

const FUNDS = new Set(['VTI', 'VTV', 'VXUS', 'GLD', 'BCI', 'SGOV']);
export function lookThrough(positions: HoldingPosition[], constituents: Constituent[], asOf = new Date().toISOString().slice(0, 10)) {
  const exposures = new Map<string, { symbol: string; direct: number; indirect: number; funds: string[] }>();
  const uncovered: { fund: string; portfolioWeight: number; reason: string }[] = [];
  const add = (symbol: string, direct: number, indirect: number, fund?: string) => {
    const row = exposures.get(symbol) ?? { symbol, direct: 0, indirect: 0, funds: [] };
    row.direct += direct; row.indirect += indirect;
    if (fund) row.funds.push(fund);
    exposures.set(symbol, row);
  };
  for (const p of positions) {
    const snapshot = constituents.filter(c => c.fund === p.symbol);
    const rows = snapshot.filter(c => (Date.parse(asOf) - Date.parse(c.asOf)) / 86400000 <= 100 && c.asOf <= asOf);
    if (!FUNDS.has(p.symbol) && !snapshot.length) { add(p.symbol, p.weight, 0); continue; }
    for (const row of rows) add(row.symbol, 0, p.weight * row.weight / 100, p.symbol);
    const covered = rows.reduce((s, r) => s + r.weight, 0);
    if (covered < 99.99) uncovered.push({ fund: p.symbol, portfolioWeight: p.weight * (1 - covered / 100), reason: snapshot.length && !rows.length ? 'Stale snapshot' : 'Constituents not supplied or partial' });
  }
  return { exposures: Array.from(exposures.values()).map(e => ({ ...e, total: e.direct + e.indirect })).sort((a, b) => b.total - a.total), uncovered };
}

export function researchChanges(observations: ResearchObservation[]) {
  const groups = new Map<string, ResearchObservation[]>();
  for (const row of observations) {
    const key = [row.symbol, row.metric, row.period, row.units, row.kind].join(':');
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return Array.from(groups.values()).map(rows => {
    rows.sort((a, b) => a.asOf.localeCompare(b.asOf));
    const latest = rows.at(-1)!, previous = rows.at(-2);
    return { ...latest, previous: previous?.value ?? null, previousAsOf: previous?.asOf ?? null, change: previous ? latest.value - previous.value : null };
  });
}
