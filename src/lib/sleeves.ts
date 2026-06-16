// All-Weather sleeve model — shared between the Holdings page (AllWeatherSection)
// and the Briefing home page so the framework never drifts between the two.

import type { HoldingPosition } from './holdings';

export interface SleeveConfig {
  name: string;
  color: string;
  targetMin: number;
  targetMax: number;
  categories: string[];
}

export const SLEEVE_CONFIG: SleeveConfig[] = [
  { name: 'Equities', color: '#007AFF', targetMin: 55, targetMax: 60, categories: ['Broad Market', 'Value', 'International', 'Quality Compounder', 'High Conviction'] },
  { name: 'Real Assets', color: '#E6A700', targetMin: 14, targetMax: 16, categories: ['Gold', 'Commodity'] },
  { name: 'Dry Powder', color: '#34C759', targetMin: 14, targetMax: 17, categories: ['Dry Powder'] },
  { name: 'Crypto', color: '#AF52DE', targetMin: 8, targetMax: 12, categories: ['Crypto'] },
];

export interface SleeveData extends SleeveConfig {
  weight: number;
  value: number;
  positions: HoldingPosition[];
}

export function computeSleeveData(positions: HoldingPosition[]): SleeveData[] {
  return SLEEVE_CONFIG.map((sleeve) => {
    const sleevePositions = positions.filter((p) => sleeve.categories.includes(p.category));
    const weight = sleevePositions.reduce((sum, p) => sum + p.weight, 0);
    const value = sleevePositions.reduce((sum, p) => sum + p.marketValue, 0);
    return { ...sleeve, weight, value, positions: sleevePositions };
  });
}

export type SleeveStatus = 'in-range' | 'over' | 'under';

export function getSleeveStatus(weight: number, min: number, max: number): SleeveStatus {
  if (weight > max + 0.5) return 'over';
  if (weight < min - 0.5) return 'under';
  return 'in-range';
}

// ─── Regime → Sleeve guidance ───
// How each economic season tilts the four sleeves. `lean` drives a colored chip;
// `note` is the plain-English "so what" shown next to each sleeve on the Briefing.

export type RegimeKey = 'reflation' | 'stagflation' | 'goldilocks' | 'deflation' | 'unknown';
export type SleeveLean = 'favored' | 'caution' | 'neutral';

interface SleeveGuidance {
  lean: SleeveLean;
  note: string;
}

export const REGIME_SLEEVE_GUIDANCE: Record<RegimeKey, Record<string, SleeveGuidance>> = {
  reflation: {
    'Equities':    { lean: 'neutral', note: 'Tilt toward value/cyclicals; growth multiples pressured by rates.' },
    'Real Assets': { lean: 'favored', note: 'Commodities & gold are the regime’s sweet spot — keep at/above target.' },
    'Dry Powder':  { lean: 'caution', note: 'Cash drags in rising-price regimes; deploy on dips rather than hoard.' },
    'Crypto':      { lean: 'neutral', note: 'Risk-on tailwind, but size it as the volatile satellite it is.' },
  },
  stagflation: {
    'Equities':    { lean: 'caution', note: 'Historically the hardest regime for stocks — favor quality, trim high-beta.' },
    'Real Assets': { lean: 'favored', note: 'Your primary hedge here — gold + commodities. Do not let this run under target.' },
    'Dry Powder':  { lean: 'favored', note: 'Optionality is valuable; keep T-bills ready for forced-seller bargains.' },
    'Crypto':      { lean: 'caution', note: 'Liquidity-sensitive; expect deeper drawdowns if conditions tighten.' },
  },
  goldilocks: {
    'Equities':    { lean: 'favored', note: 'Steady growth + contained inflation favors risk assets — stay fully weighted.' },
    'Real Assets': { lean: 'neutral', note: 'Insurance, not the driver here — maintain target, no urgency to add.' },
    'Dry Powder':  { lean: 'caution', note: 'Cash underperforms in calm uptrends; keep only your tactical reserve.' },
    'Crypto':      { lean: 'favored', note: 'Benign backdrop for the high-octane sleeve — let winners run toward target.' },
  },
  deflation: {
    'Equities':    { lean: 'caution', note: 'Softening growth — favor defensives and quality over cyclicals/high-conviction.' },
    'Real Assets': { lean: 'neutral', note: 'Gold can still work on real-rate declines; commodities lag in a slowdown.' },
    'Dry Powder':  { lean: 'favored', note: 'Cash is king into a slowdown — this is when your ladder gets deployed.' },
    'Crypto':      { lean: 'caution', note: 'Risk-off pressure; expect correlation-to-1 if markets de-risk.' },
  },
  unknown: {
    'Equities':    { lean: 'neutral', note: 'Hold to target bands until the regime read clarifies.' },
    'Real Assets': { lean: 'neutral', note: 'Hold to target bands until the regime read clarifies.' },
    'Dry Powder':  { lean: 'neutral', note: 'Hold to target bands until the regime read clarifies.' },
    'Crypto':      { lean: 'neutral', note: 'Hold to target bands until the regime read clarifies.' },
  },
};

// Regime tilt — percentage-point nudge applied to each sleeve's target band for the
// current economic season. Each regime's tilts sum to ~0 so the book stays fully
// invested. Used to draw a "regime-adjusted target" overlay on the sleeve graph.
export const REGIME_SLEEVE_TILT: Record<RegimeKey, Record<string, number>> = {
  reflation:   { 'Equities': -1, 'Real Assets': +3, 'Dry Powder': -2, 'Crypto': 0 },
  stagflation: { 'Equities': -5, 'Real Assets': +4, 'Dry Powder': +3, 'Crypto': -2 },
  goldilocks:  { 'Equities': +4, 'Real Assets': -2, 'Dry Powder': -3, 'Crypto': +1 },
  deflation:   { 'Equities': -3, 'Real Assets': 0,  'Dry Powder': +5, 'Crypto': -2 },
  unknown:     { 'Equities': 0,  'Real Assets': 0,  'Dry Powder': 0,  'Crypto': 0 },
};

// Regime-adjusted target band for a sleeve (base band + regime tilt, clamped to >= 0).
export function regimeAdjustedBand(
  sleeveName: string,
  baseMin: number,
  baseMax: number,
  regimeKey: RegimeKey
): { min: number; max: number; delta: number } {
  const delta = REGIME_SLEEVE_TILT[regimeKey]?.[sleeveName] ?? 0;
  return { min: Math.max(0, baseMin + delta), max: Math.max(0, baseMax + delta), delta };
}
