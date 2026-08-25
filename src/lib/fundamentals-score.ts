// Fundamental Analysis Scoring Engine
// Computes a 0–100 composite score across 5 pillars for each stock
// Data sourced from Polygon.io Stock Financials API + Finnhub earnings + SEC EDGAR
//
// ═══ METHODOLOGY (v2) ═══
//
// The score combines five fundamental pillars, each measuring a different
// aspect of business quality. Higher scores indicate stronger fundamentals.
//
// Scoring mechanics (shared by every metric):
//   • Piecewise-linear scoring — each metric maps through a set of anchor
//     points (e.g. net margin 0% → 2pts, 10% → 7pts, 20% → 10pts) with linear
//     interpolation between anchors, so a P/E of 24.9 and 25.1 score almost
//     identically instead of jumping a whole bucket on data noise.
//   • Sector-aware thresholds — the SIC code selects a threshold profile.
//     Financials (SIC 6000–6799) skip gross margin, current ratio, cash/debt,
//     and FCF (structurally meaningless for banks) and use leverage/P-B anchors
//     calibrated to financial balance sheets. Utilities & IPPs (SIC 4900–4991)
//     use margin and leverage anchors calibrated to capital-intensive,
//     regulated-return economics. Everything else uses the default profile.
//   • Coverage-aware renormalization — each pillar is scored out of the
//     metrics that are applicable (per sector) AND available (data present).
//     When at least half of a pillar's applicable weight has data, the pillar
//     is renormalized so missing data doesn't read as bad data; below that,
//     missing metrics count as zero (sparse data shouldn't inflate scores).
//     The overall data coverage %% is reported in the breakdown.
//   • Provenance — every metric records which source supplied it
//     (Polygon filing / Finnhub / EDGAR) so a surprising score is diagnosable.
//
// 1. PROFITABILITY (25 pts max)
//    - Net Margin (10): profit kept per dollar of revenue.
//    - Gross Margin (8): pricing power and cost efficiency (sector-calibrated).
//    - ROE (7): efficiency of shareholder capital. Falls back to ROA when
//      equity is negative (buyback-heavy balance sheets) so great businesses
//      aren't zeroed for capital-return policy.
//
// 2. GROWTH (20 pts max)
//    - Revenue Growth YoY (10): top-line momentum.
//    - EPS Growth YoY (10): bottom-line momentum. For still-unprofitable
//      companies, "growth" from a smaller loss is capped at 3pts — loss
//      narrowing is credited, but never scored like profitable growth.
//
// 3. VALUATION (20 pts max)
//    - P/E, growth-adjusted (10): when EPS growth is meaningful (>5%/yr) the
//      P/E is scored as a PEG ratio (P/E ÷ growth), so a fast compounder at
//      35x isn't automatically scored worse than a melting ice cube at 8x.
//      Without usable growth, raw P/E anchors apply. Negative earnings = 0.
//    - P/B (5): price vs book value (sector-calibrated for financials).
//    - P/S (5): price vs sales — the sanity check for unprofitable growth.
//
// 4. FINANCIAL HEALTH (20 pts max)
//    - Debt-to-Equity (8): leverage, scored against sector norms.
//    - Current Ratio (6): short-term liquidity (skipped for financials).
//    - Cash vs Debt (6): net-cash resilience (skipped for financials).
//
// 5. EARNINGS & CASH QUALITY (15 pts max)
//    - Beat Rate (5) + Avg Surprise (3): execution vs analyst estimates.
//      When no estimates exist, an SEC-filings EPS trend substitutes,
//      compared year-over-year against the same fiscal quarter so seasonal
//      businesses aren't penalized.
//    - FCF Conversion (4): free cash flow ÷ net income — do reported earnings
//      turn into cash, or are they accruals?
//    - FCF Margin (3): free cash flow ÷ revenue.
//
// ═══ GRADE THRESHOLDS ═══
//   80-100 = Excellent   (exceptional fundamentals)
//   65-79  = Good        (solid fundamentals)
//   50-64  = Fair        (average fundamentals)
//   35-49  = Weak        (below average, caution)
//   0-34   = Poor        (fundamentally challenged)
//
// Grades describe fundamentals quality only — they are NOT trade
// recommendations. Buy/sell decisions belong to the rebalance rules.
//
// Scores update automatically: Polygon financials data refreshes hourly,
// and earnings data updates after each report.
// ETFs and crypto receive "N/A" since traditional fundamental analysis doesn't apply.

import { getStockFinancials, getSnapshot, getTickerDetails, type StockFinancials } from './polygon';
import { getEarnings, getBasicFinancials, type EarningsEstimate, type BasicFinancials } from './finnhub';
import { getCompanyFundamentals, extractScoringMetrics, type EdgarScoringMetrics, type CompanyFundamentals } from './edgar';
import { withCache, TTL } from './cache';

// ─── Piecewise-linear scoring ───

/** [metricValue, points] — anchors sorted ascending by value; clamped at both ends */
type Anchor = readonly [number, number];

const round1 = (v: number) => Math.round(v * 10) / 10;

function lerpScore(value: number | null, anchors: readonly Anchor[] | null): number | null {
  if (value === null || anchors === null || !Number.isFinite(value)) return null;
  if (value <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (value >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i - 1];
    const [x2, y2] = anchors[i];
    if (value <= x2) {
      const t = (value - x1) / (x2 - x1);
      return round1(y1 + t * (y2 - y1));
    }
  }
  return last[1];
}

// ─── Sector threshold profiles ───

export type SectorProfile = 'default' | 'financial' | 'utility';

/** Anchor tables per metric; null = metric not applicable for this sector */
interface MetricAnchors {
  netMargin: readonly Anchor[];
  grossMargin: readonly Anchor[] | null;
  roe: readonly Anchor[];
  roa: readonly Anchor[];
  revenueGrowth: readonly Anchor[];
  epsGrowth: readonly Anchor[];
  pe: readonly Anchor[];
  peg: readonly Anchor[];
  pb: readonly Anchor[];
  ps: readonly Anchor[] | null;
  debtToEquity: readonly Anchor[];
  currentRatio: readonly Anchor[] | null;
  cashToDebt: readonly Anchor[] | null;
  beatRate: readonly Anchor[];
  avgSurprise: readonly Anchor[];
  fcfConversion: readonly Anchor[] | null;
  fcfMargin: readonly Anchor[] | null;
}

const DEFAULT_ANCHORS: MetricAnchors = {
  netMargin: [[-5, 0], [0, 2], [5, 4], [10, 7], [20, 10]],
  grossMargin: [[5, 0], [10, 2], [25, 4], [40, 6], [60, 8]],
  roe: [[2, 0], [5, 1], [10, 3], [15, 5], [20, 7]],
  roa: [[0, 0], [2, 1], [5, 3], [8, 5], [12, 7]],
  revenueGrowth: [[-15, 0], [0, 3], [7, 5], [15, 8], [30, 10]],
  epsGrowth: [[-15, 0], [0, 3], [7, 5], [15, 8], [30, 10]],
  pe: [[8, 10], [12, 9], [18, 8], [25, 6], [35, 3], [50, 1], [60, 0]],
  peg: [[0.5, 10], [1, 9], [1.5, 7], [2, 5], [3, 2], [4, 0]],
  pb: [[1.5, 5], [3, 4], [5, 3], [8, 1], [10, 0]],
  ps: [[2, 5], [5, 4], [10, 2], [20, 1], [25, 0]],
  debtToEquity: [[0.3, 8], [0.5, 6], [1, 4], [2, 2], [3, 0]],
  currentRatio: [[0.4, 0], [0.5, 1], [1, 3], [1.5, 5], [2, 6]],
  cashToDebt: [[0, 0], [0.2, 2], [0.5, 4], [1, 6]],
  beatRate: [[0, 0], [50, 2.5], [75, 4], [100, 5]],
  avgSurprise: [[-2, 0], [0, 0.5], [2, 1.5], [5, 2.5], [10, 3]],
  fcfConversion: [[0.3, 0], [0.5, 1], [0.8, 2.5], [1, 3.5], [1.2, 4]],
  fcfMargin: [[0, 0], [5, 1], [10, 2], [15, 2.5], [20, 3]],
};

// Banks/insurers: deposits and float ARE the business model, so absolute
// leverage, current ratio, cash-vs-debt, gross margin, and FCF don't carry the
// meaning they do for an operating company. P/B is the primary valuation lens.
const FINANCIAL_ANCHORS: MetricAnchors = {
  ...DEFAULT_ANCHORS,
  grossMargin: null,
  currentRatio: null,
  cashToDebt: null,
  fcfConversion: null,
  fcfMargin: null,
  ps: null,
  debtToEquity: [[2, 8], [5, 6], [9, 4], [12, 2], [15, 0]],
  pb: [[0.8, 5], [1.2, 4], [2, 3], [3, 1], [4, 0]],
};

// Utilities & independent power producers: regulated/contracted returns mean
// structurally thinner margins and higher leverage than the market default —
// score against utility norms, not software norms.
const UTILITY_ANCHORS: MetricAnchors = {
  ...DEFAULT_ANCHORS,
  netMargin: [[-5, 0], [0, 2], [4, 4], [8, 7], [14, 10]],
  grossMargin: [[0, 0], [10, 2], [20, 4], [35, 6], [50, 8]],
  debtToEquity: [[1, 8], [1.6, 6], [2.5, 4], [3.5, 2], [5, 0]],
  currentRatio: [[0.3, 0], [0.6, 1], [0.9, 3], [1.2, 5], [1.6, 6]],
  cashToDebt: [[0, 0], [0.05, 2], [0.15, 4], [0.4, 6]],
  fcfMargin: [[-10, 0], [0, 1], [4, 2], [8, 2.5], [12, 3]],
};

const SECTOR_ANCHORS: Record<SectorProfile, MetricAnchors> = {
  default: DEFAULT_ANCHORS,
  financial: FINANCIAL_ANCHORS,
  utility: UTILITY_ANCHORS,
};

export function sectorProfileFor(sicCode: string | null | undefined): SectorProfile {
  const code = sicCode ? parseInt(sicCode, 10) : NaN;
  if (!Number.isFinite(code)) return 'default';
  if (code >= 6000 && code <= 6799) return 'financial';
  if (code >= 4900 && code <= 4991) return 'utility';
  return 'default';
}

// ─── Types ───

export type MetricSource = 'polygon' | 'finnhub' | 'edgar';

export interface FundamentalsBreakdown {
  profitabilityPts: number;
  profitabilityMax: 25;
  profitabilityDetail: {
    netMarginPts: number;
    grossMarginPts: number;
    roePts: number;
    netMargin: number | null;
    grossMargin: number | null;
    roe: number | null;
    /** 'roa' when ROE was unavailable (e.g. negative equity) and ROA substituted */
    roeBasis: 'roe' | 'roa' | null;
  };

  growthPts: number;
  growthMax: 20;
  growthDetail: {
    revenueGrowthPts: number;
    epsGrowthPts: number;
    revenueGrowth: number | null;
    epsGrowth: number | null;
    /** true when EPS-growth points were capped because the company is still unprofitable */
    lossNarrowing: boolean;
  };

  valuationPts: number;
  valuationMax: 20;
  valuationDetail: {
    pePts: number;
    pbPts: number;
    psPts: number;
    pe: number | null;
    pb: number | null;
    ps: number | null;
    peg: number | null;
    /** 'peg' when the P/E was scored growth-adjusted */
    peBasis: 'pe' | 'peg' | null;
  };

  healthPts: number;
  healthMax: 20;
  healthDetail: {
    debtEquityPts: number;
    currentRatioPts: number;
    cashDebtPts: number;
    debtToEquity: number | null;
    currentRatio: number | null;
    cashToDebt: number | null;
  };

  earningsQualityPts: number;
  earningsQualityMax: 15;
  earningsQualityDetail: {
    beatRatePts: number;
    surprisePts: number;
    fcfConversionPts: number;
    fcfMarginPts: number;
    beatRate: number | null;
    avgSurprise: number | null;
    fcfConversion: number | null;
    fcfMargin: number | null;
    quartersAnalyzed: number;
    /** what the execution half of the pillar was scored from */
    basis: 'estimates' | 'filings-trend' | 'none';
  };

  meta: {
    sectorProfile: SectorProfile;
    /** %% of the applicable scoring weight that was backed by actual data */
    coveragePct: number;
    /** which source supplied each metric */
    sources: Partial<Record<string, MetricSource>>;
    /** end date of the most recent filing used, if known */
    dataAsOf: string | null;
  };
}

export interface FundamentalsScore {
  symbol: string;
  total: number;
  grade: 'Excellent' | 'Good' | 'Fair' | 'Weak' | 'Poor';
  gradeColor: string;
  breakdown: FundamentalsBreakdown;
  rationale: string;
  unavailable?: boolean;
  unavailableReason?: string;
  preRevenue?: boolean;
}

// ─── Pillar assembly (coverage-aware renormalization) ───

interface MetricScore {
  pts: number | null;   // null = data missing
  max: number;
  applicable: boolean;  // false = excluded by sector profile
}

interface PillarResult {
  pts: number;
  applicableMax: number;
  availableMax: number;
}

/**
 * Sum a pillar's metric scores. Metrics excluded by the sector profile are
 * renormalized away entirely. Metrics that are applicable but missing data are
 * renormalized away only when at least half the pillar's applicable weight has
 * data (so an outage doesn't read as bad fundamentals) — below that, missing
 * data counts as zero (so near-empty data can't inflate a pillar). Pre-revenue
 * companies never renormalize: their gaps are real, not data failures.
 */
function assemblePillar(metrics: MetricScore[], pillarMax: number, allowRenorm: boolean): PillarResult {
  const applicable = metrics.filter((m) => m.applicable);
  const applicableMax = applicable.reduce((s, m) => s + m.max, 0);
  const available = applicable.filter((m) => m.pts !== null);
  const availableMax = available.reduce((s, m) => s + m.max, 0);
  const earned = available.reduce((s, m) => s + (m.pts ?? 0), 0);

  if (applicableMax === 0 || availableMax === 0) return { pts: 0, applicableMax, availableMax };

  const canRenorm = allowRenorm && availableMax >= applicableMax * 0.5;
  const denominator = canRenorm ? availableMax : applicableMax;
  return { pts: round1((earned / denominator) * pillarMax), applicableMax, availableMax };
}

// ─── Scoring Functions ───

function scoreProfitability(
  netMargin: number | null,
  grossMargin: number | null,
  roe: number | null,
  roa: number | null,
  a: MetricAnchors,
) {
  const netMarginPts = lerpScore(netMargin, a.netMargin);
  const grossMarginPts = lerpScore(grossMargin, a.grossMargin);
  const roeBasis: 'roe' | 'roa' | null = roe !== null ? 'roe' : roa !== null ? 'roa' : null;
  const roePts = roe !== null ? lerpScore(roe, a.roe) : lerpScore(roa, a.roa);

  return {
    metrics: [
      { pts: netMarginPts, max: 10, applicable: true },
      { pts: grossMarginPts, max: 8, applicable: a.grossMargin !== null },
      { pts: roePts, max: 7, applicable: true },
    ] as MetricScore[],
    netMarginPts: netMarginPts ?? 0,
    grossMarginPts: grossMarginPts ?? 0,
    roePts: roePts ?? 0,
    roeBasis,
  };
}

function scoreGrowth(
  revenueGrowth: number | null,
  epsGrowth: number | null,
  isProfitable: boolean | null,
  a: MetricAnchors,
) {
  const revenueGrowthPts = lerpScore(revenueGrowth, a.revenueGrowth);

  // A loss shrinking from -$2 to -$1 computes as +50% "growth" — credit the
  // improvement, but never at profitable-growth rates.
  const lossNarrowing = epsGrowth !== null && epsGrowth > 0 && isProfitable === false;
  let epsGrowthPts = lerpScore(epsGrowth, a.epsGrowth);
  if (lossNarrowing && epsGrowthPts !== null) epsGrowthPts = Math.min(epsGrowthPts, 3);

  return {
    metrics: [
      { pts: revenueGrowthPts, max: 10, applicable: true },
      { pts: epsGrowthPts, max: 10, applicable: true },
    ] as MetricScore[],
    revenueGrowthPts: revenueGrowthPts ?? 0,
    epsGrowthPts: epsGrowthPts ?? 0,
    lossNarrowing,
  };
}

function scoreValuation(
  pe: number | null,
  pb: number | null,
  ps: number | null,
  epsGrowth: number | null,
  isProfitable: boolean | null,
  a: MetricAnchors,
) {
  // Growth-adjusted P/E: with meaningful profitable growth (>5%/yr), score the
  // PEG ratio instead of the raw multiple.
  const peg = pe !== null && pe > 0 && epsGrowth !== null && epsGrowth > 5 && isProfitable !== false
    ? round1((pe / epsGrowth) * 10) / 10
    : null;
  const peBasis: 'pe' | 'peg' | null = pe === null ? null : peg !== null ? 'peg' : 'pe';
  const pePts = pe === null || pe <= 0 ? (pe === null ? null : 0)
    : peg !== null ? lerpScore(peg, a.peg) : lerpScore(pe, a.pe);

  const pbPts = pb === null ? null : pb <= 0 ? 0 : lerpScore(pb, a.pb);
  const psPts = ps === null ? null : ps <= 0 ? 0 : lerpScore(ps, a.ps);

  return {
    metrics: [
      { pts: pePts, max: 10, applicable: true },
      { pts: pbPts, max: 5, applicable: true },
      { pts: psPts, max: 5, applicable: a.ps !== null },
    ] as MetricScore[],
    pePts: pePts ?? 0,
    pbPts: pbPts ?? 0,
    psPts: psPts ?? 0,
    peg,
    peBasis,
  };
}

function scoreHealth(
  debtToEquity: number | null,
  currentRatio: number | null,
  cashToDebt: number | null,
  a: MetricAnchors,
) {
  // Lower is better for D/E — lerpScore handles descending point anchors.
  const debtEquityPts = lerpScore(debtToEquity, a.debtToEquity);
  const currentRatioPts = lerpScore(currentRatio, a.currentRatio);
  const cashDebtPts = lerpScore(cashToDebt, a.cashToDebt);

  return {
    metrics: [
      { pts: debtEquityPts, max: 8, applicable: true },
      { pts: currentRatioPts, max: 6, applicable: a.currentRatio !== null },
      { pts: cashDebtPts, max: 6, applicable: a.cashToDebt !== null },
    ] as MetricScore[],
    debtEquityPts: debtEquityPts ?? 0,
    currentRatioPts: currentRatioPts ?? 0,
    cashDebtPts: cashDebtPts ?? 0,
  };
}

function scoreEarningsQuality(
  earnings: EarningsEstimate[],
  edgarFundamentals: CompanyFundamentals | null | undefined,
  fcfConversion: number | null,
  fcfMargin: number | null,
  a: MetricAnchors,
) {
  const recent = earnings.filter((e) => e.actual !== null && e.estimate !== null).slice(-4);

  let beatRatePts: number | null = null;
  let surprisePts: number | null = null;
  let beatRate: number | null = null;
  let avgSurprise: number | null = null;
  let quartersAnalyzed = 0;
  let basis: 'estimates' | 'filings-trend' | 'none' = 'none';

  if (recent.length > 0) {
    // Analyst estimates available — beat rate + surprise magnitude
    basis = 'estimates';
    quartersAnalyzed = recent.length;
    const beats = recent.filter((e) => (e.actual ?? 0) >= (e.estimate ?? 0)).length;
    beatRate = (beats / recent.length) * 100;
    const surprises = recent
      .filter((e) => e.surprisePercent !== null)
      .map((e) => e.surprisePercent!);
    avgSurprise = surprises.length > 0
      ? surprises.reduce((s, v) => s + v, 0) / surprises.length
      : null;

    beatRatePts = lerpScore(beatRate, a.beatRate);
    surprisePts = lerpScore(avgSurprise, a.avgSurprise);
  } else if (edgarFundamentals) {
    // Fallback: SEC-filings EPS trend. Only true 3-month 10-Q figures, and each
    // quarter is compared YEAR-OVER-YEAR against the same fiscal quarter — never
    // sequentially — so 10-K annual figures can't pollute the series and
    // seasonal businesses aren't punished for their seasonality.
    const quarterly = edgarFundamentals.eps.filter(
      (d) => d.form === '10-Q' && /^Q[1-3]$/.test(d.period.split('-')[1] ?? '')
    );
    const byPeriod = new Map(quarterly.map((d) => [d.period, d.value]));

    let comparisons = 0;
    let improvements = 0;
    for (const d of quarterly) {
      const [fy, fp] = d.period.split('-');
      const priorYear = byPeriod.get(`${Number(fy) - 1}-${fp}`);
      if (priorYear !== undefined) {
        comparisons++;
        if (d.value > priorYear) improvements++;
      }
    }

    if (comparisons >= 2) {
      basis = 'filings-trend';
      quartersAnalyzed = comparisons;
      beatRate = (improvements / comparisons) * 100; // reported as "improvement rate"
      // Trend is a weaker signal than actual beats — capped below the estimates path.
      beatRatePts = lerpScore(beatRate, [[0, 0], [33, 1.5], [66, 3], [100, 4]]);
      const latest = quarterly[quarterly.length - 1];
      surprisePts = latest && latest.value > 0 ? 1 : 0;
    }
  }

  const fcfConversionPts = lerpScore(fcfConversion, a.fcfConversion);
  const fcfMarginPts = lerpScore(fcfMargin, a.fcfMargin);

  return {
    metrics: [
      { pts: beatRatePts, max: 5, applicable: true },
      { pts: surprisePts, max: 3, applicable: true },
      { pts: fcfConversionPts, max: 4, applicable: a.fcfConversion !== null },
      { pts: fcfMarginPts, max: 3, applicable: a.fcfMargin !== null },
    ] as MetricScore[],
    beatRatePts: beatRatePts ?? 0,
    surprisePts: surprisePts ?? 0,
    fcfConversionPts: fcfConversionPts ?? 0,
    fcfMarginPts: fcfMarginPts ?? 0,
    beatRate,
    avgSurprise,
    quartersAnalyzed,
    basis,
  };
}

function getGrade(total: number): { grade: FundamentalsScore['grade']; color: string } {
  if (total >= 80) return { grade: 'Excellent', color: 'bg-accent-green/20 text-green-800 border-green-200' };
  if (total >= 65) return { grade: 'Good', color: 'bg-accent-green/10 text-green-700 border-green-100' };
  if (total >= 50) return { grade: 'Fair', color: 'bg-accent-blue/10 text-blue-700 border-blue-100' };
  if (total >= 35) return { grade: 'Weak', color: 'bg-accent-orange/10 text-orange-700 border-orange-100' };
  return { grade: 'Poor', color: 'bg-accent-red/10 text-red-700 border-red-100' };
}

function buildRationale(breakdown: FundamentalsBreakdown, preRevenue = false): string {
  const parts: string[] = [];
  const { profitabilityPts, growthPts, valuationPts, healthPts, earningsQualityPts } = breakdown;
  const pd = breakdown.profitabilityDetail;
  const gd = breakdown.growthDetail;
  const vd = breakdown.valuationDetail;
  const hd = breakdown.healthDetail;
  const ed = breakdown.earningsQualityDetail;
  const meta = breakdown.meta;

  if (preRevenue) {
    parts.push('Pre-revenue company — profitability, growth, and valuation metrics are not yet applicable.');
  } else if (profitabilityPts >= 20) {
    parts.push(`Highly profitable with${pd.netMargin !== null ? ` ${pd.netMargin.toFixed(1)}% net margin` : ''}${pd.grossMargin !== null ? `, ${pd.grossMargin.toFixed(1)}% gross margin` : ''}${pd.roe !== null ? `, and ${pd.roe.toFixed(1)}% ROE` : ''}.`);
  } else if (profitabilityPts >= 10) {
    parts.push(`Decent profitability${pd.netMargin !== null ? ` (${pd.netMargin.toFixed(1)}% net margin)` : ''}, though there's room for margin expansion.`);
  } else if (profitabilityPts > 0) {
    parts.push(`Thin margins${pd.netMargin !== null ? ` (${pd.netMargin.toFixed(1)}% net margin)` : ''} suggest limited pricing power or high costs.`);
  } else {
    parts.push('Currently unprofitable or insufficient profitability data.');
  }

  if (!preRevenue) {
    if (gd.lossNarrowing) {
      parts.push('Losses are narrowing year-over-year, though the company is not yet profitable.');
    } else if (growthPts >= 16) {
      parts.push(`Strong growth trajectory${gd.revenueGrowth !== null ? ` with ${gd.revenueGrowth.toFixed(1)}% revenue growth` : ''}${gd.epsGrowth !== null ? ` and ${gd.epsGrowth.toFixed(1)}% EPS growth` : ''}.`);
    } else if (growthPts >= 8) {
      parts.push(`Moderate growth${gd.revenueGrowth !== null ? ` (${gd.revenueGrowth.toFixed(1)}% revenue)` : ''}.`);
    } else if (growthPts > 0) {
      parts.push('Growth is slowing but still positive.');
    } else {
      parts.push('Revenue or earnings are declining, indicating headwinds.');
    }
  }

  if (preRevenue) {
    if (vd.pb !== null) {
      parts.push(`Trading at ${vd.pb.toFixed(1)}x book value.`);
    }
  } else if (vd.peBasis === 'peg' && vd.peg !== null && valuationPts >= 12) {
    parts.push(`Reasonably valued for its growth (${vd.peg.toFixed(1)} PEG${vd.pe !== null ? `, ${vd.pe.toFixed(1)}x earnings` : ''}).`);
  } else if (vd.peBasis === 'peg' && vd.peg !== null && valuationPts < 12) {
    parts.push(`Valuation is rich even after adjusting for growth (${vd.peg.toFixed(1)} PEG${vd.pe !== null ? `, ${vd.pe.toFixed(1)}x earnings` : ''}).`);
  } else if (valuationPts >= 15) {
    parts.push(`Attractively valued${vd.pe !== null ? ` at ${vd.pe.toFixed(1)}x earnings` : ''}${vd.pb !== null ? `, ${vd.pb.toFixed(1)}x book` : ''}.`);
  } else if (valuationPts >= 8) {
    parts.push(`Fairly valued${vd.pe !== null ? ` (${vd.pe.toFixed(1)}x PE)` : ''}, not stretched but not a bargain.`);
  } else if (valuationPts > 0) {
    parts.push(`Richly valued${vd.pe !== null ? ` at ${vd.pe.toFixed(1)}x earnings` : ''} — growth expectations are priced in.`);
  } else {
    parts.push('Expensive or unprofitable, making valuation difficult to justify on earnings alone.');
  }

  if (healthPts >= 15) {
    parts.push(meta.sectorProfile === 'default'
      ? 'Fortress balance sheet with low debt and strong liquidity.'
      : `Strong balance sheet for a ${meta.sectorProfile === 'utility' ? 'utility' : 'financial'}.`);
  } else if (healthPts >= 8) {
    parts.push(`Healthy balance sheet${hd.debtToEquity !== null ? ` (${hd.debtToEquity.toFixed(2)}x D/E)` : ''}.`);
  } else if (healthPts > 0) {
    parts.push(`Elevated leverage${hd.debtToEquity !== null ? ` (${hd.debtToEquity.toFixed(2)}x D/E)` : ''}${meta.sectorProfile !== 'default' ? ' even by sector norms' : ''} adds risk in a downturn.`);
  } else {
    parts.push('Financial health data is limited or shows concerning leverage.');
  }

  if (ed.basis === 'estimates') {
    if (ed.beatRatePts + ed.surprisePts >= 6.5) {
      parts.push(`Excellent earnings execution — ${ed.beatRate?.toFixed(0)}% beat rate over ${ed.quartersAnalyzed} quarters.`);
    } else if (ed.beatRatePts + ed.surprisePts >= 3.5) {
      parts.push(`Decent earnings track record (${ed.beatRate?.toFixed(0)}% beat rate).`);
    } else {
      parts.push('Inconsistent earnings relative to estimates.');
    }
  } else if (ed.basis === 'filings-trend') {
    if (ed.beatRatePts >= 3) {
      parts.push(`Improving year-over-year earnings trend across ${ed.quartersAnalyzed} quarterly comparisons (SEC filings).`);
    } else if (ed.beatRatePts >= 1.5) {
      parts.push(`Mixed year-over-year earnings trend (SEC filings).`);
    } else {
      parts.push('Earnings trend is flat or declining based on SEC filings.');
    }
  }

  if (ed.fcfConversion !== null) {
    if (ed.fcfConversion >= 0.9) {
      parts.push(`Earnings convert cleanly to cash (${(ed.fcfConversion * 100).toFixed(0)}% FCF conversion).`);
    } else if (ed.fcfConversion < 0.5 && earningsQualityPts < 10) {
      parts.push(`Weak cash conversion (${(ed.fcfConversion * 100).toFixed(0)}% of earnings become free cash flow).`);
    }
  }

  if (meta.coveragePct < 60) {
    parts.push(`Note: only ${meta.coveragePct.toFixed(0)}% of scoring inputs had data — treat this score as low-confidence.`);
  }

  return parts.join(' ');
}

// ─── Non-scoreable assets ───

const ETF_SYMBOLS = new Set(['VTI', 'VXUS', 'VTV', 'SGOV', 'GLD', 'BCI', 'SPY', 'QQQ', 'IWM', 'DIA', 'EFA', 'EEM', 'TLT', 'IEF', 'SHY', 'HYG', 'LQD', 'XLF', 'XLE', 'XLK', 'XLV', 'XLI', 'XLP', 'XLU', 'XLRE', 'XLC', 'XLB', 'XLY']);
const CRYPTO_SYMBOLS = new Set(['BTC', 'ETH', 'SOL', 'DOGE']);

function isNonScoreable(symbol: string): { skip: boolean; reason?: string } {
  if (CRYPTO_SYMBOLS.has(symbol)) return { skip: true, reason: 'Crypto asset — no traditional financial statements' };
  if (ETF_SYMBOLS.has(symbol)) return { skip: true, reason: 'ETF/Fund — composed of underlying holdings, not a single company' };
  return { skip: false };
}

// ─── Compute metrics from Polygon financials ───

function computeFromPolygon(
  annuals: StockFinancials[],
  quarters: StockFinancials[],
  price: number,
  marketCap: number,
  sources: Partial<Record<string, MetricSource>>,
): ComputedMetrics {
  // Use most recent annual for profitability and health
  const latest = annuals[0] || quarters[0];
  const prevAnnual = annuals[1] || null;

  const metrics = emptyMetrics();
  const mark = (key: string) => { sources[key] = 'polygon'; };

  // Profitability — prefer TTM from the last 4 quarters (fresher than the
  // latest annual filing), falling back to the latest filing.
  const recentQuarters = quarters.slice(0, 4);
  const ttmOf = (get: (q: StockFinancials) => number | null): number | null => {
    if (recentQuarters.length < 4) return null;
    let sum = 0;
    for (const q of recentQuarters) {
      const v = get(q);
      if (v === null) return null; // all 4 quarters required — no silent zero-fill
      sum += v;
    }
    return sum;
  };

  const ttmRevenue = ttmOf((q) => q.revenue);
  const ttmNetIncome = ttmOf((q) => q.netIncome);
  const ttmGrossProfit = ttmOf((q) => q.grossProfit);
  const ttmEps = ttmOf((q) => q.eps);
  const ttmFcf = ttmOf((q) => q.freeCashFlow);

  const marginRevenue = ttmRevenue ?? (latest?.revenue || null);
  const marginNetIncome = ttmRevenue !== null ? ttmNetIncome : (latest?.netIncome ?? null);
  const marginGrossProfit = ttmRevenue !== null ? ttmGrossProfit : (latest?.grossProfit ?? null);

  if (marginRevenue !== null && marginRevenue !== 0) {
    if (marginNetIncome !== null) { metrics.netMargin = (marginNetIncome / marginRevenue) * 100; mark('netMargin'); }
    if (marginGrossProfit !== null) { metrics.grossMargin = (marginGrossProfit / marginRevenue) * 100; mark('grossMargin'); }
  }

  const equity = latest?.stockholdersEquity ?? null;
  const roeIncome = marginNetIncome ?? latest?.netIncome ?? null;
  if (roeIncome !== null && equity !== null && equity > 0) {
    metrics.roe = (roeIncome / equity) * 100; mark('roe');
  } else if (roeIncome !== null && latest?.totalAssets && latest.totalAssets > 0) {
    // Negative or missing equity (buyback-heavy balance sheets) — use ROA instead
    metrics.roa = (roeIncome / latest.totalAssets) * 100; mark('roa');
  }

  // Growth: compare most recent annual to prior annual
  if (latest && prevAnnual) {
    if (latest.revenue !== null && prevAnnual.revenue !== null && prevAnnual.revenue !== 0) {
      metrics.revenueGrowth = ((latest.revenue - prevAnnual.revenue) / Math.abs(prevAnnual.revenue)) * 100;
      mark('revenueGrowth');
    }
    if (latest.eps !== null && prevAnnual.eps !== null && prevAnnual.eps !== 0) {
      metrics.epsGrowth = ((latest.eps - prevAnnual.eps) / Math.abs(prevAnnual.eps)) * 100;
      mark('epsGrowth');
    }
  }

  // If no annual growth data, try quarterly YoY (Q vs same Q prior year)
  if (metrics.revenueGrowth === null && quarters.length >= 5) {
    const recentQ = quarters[0];
    const priorYearQ = quarters.find(
      (q) => q.fiscalPeriod === recentQ.fiscalPeriod && q.fiscalYear !== recentQ.fiscalYear
    );
    if (recentQ.revenue !== null && priorYearQ?.revenue !== null && priorYearQ && priorYearQ.revenue !== 0) {
      metrics.revenueGrowth = ((recentQ.revenue - priorYearQ.revenue) / Math.abs(priorYearQ.revenue)) * 100;
      mark('revenueGrowth');
    }
    if (recentQ.eps !== null && priorYearQ?.eps !== null && priorYearQ && priorYearQ.eps !== 0 && metrics.epsGrowth === null) {
      metrics.epsGrowth = ((recentQ.eps - priorYearQ.eps) / Math.abs(priorYearQ.eps)) * 100;
      mark('epsGrowth');
    }
  }

  // Valuation: compute from price + financial data
  if (ttmEps !== null && ttmEps > 0 && price > 0) {
    metrics.pe = price / ttmEps; mark('pe');
  } else if (ttmEps === null && latest?.eps && latest.eps > 0 && price > 0) {
    metrics.pe = price / latest.eps; mark('pe');
  }

  if (equity !== null && equity > 0 && marketCap > 0) {
    metrics.pb = marketCap / equity; mark('pb');
  }

  if (ttmRevenue !== null && ttmRevenue > 0 && marketCap > 0) {
    metrics.ps = marketCap / ttmRevenue; mark('ps');
  } else if (ttmRevenue === null && latest?.revenue && latest.revenue > 0 && marketCap > 0) {
    metrics.ps = marketCap / latest.revenue; mark('ps');
  }

  // Financial Health
  const healthSource = quarters[0] || latest;
  if (healthSource) {
    if (healthSource.totalDebt !== null && healthSource.stockholdersEquity && healthSource.stockholdersEquity > 0) {
      metrics.debtToEquity = healthSource.totalDebt / healthSource.stockholdersEquity; mark('debtToEquity');
    } else if (healthSource.longTermDebt !== null && healthSource.stockholdersEquity && healthSource.stockholdersEquity > 0) {
      metrics.debtToEquity = healthSource.longTermDebt / healthSource.stockholdersEquity; mark('debtToEquity');
    } else if (healthSource.totalLiabilities !== null && healthSource.stockholdersEquity && healthSource.stockholdersEquity > 0) {
      metrics.debtToEquity = healthSource.totalLiabilities / healthSource.stockholdersEquity; mark('debtToEquity');
    }

    if (healthSource.currentAssets !== null && healthSource.currentLiabilities !== null && healthSource.currentLiabilities > 0) {
      metrics.currentRatio = healthSource.currentAssets / healthSource.currentLiabilities; mark('currentRatio');
    }

    const debt = healthSource.totalDebt ?? healthSource.longTermDebt ?? 0;
    if (healthSource.cash !== null && debt > 0) {
      metrics.cashToDebt = healthSource.cash / debt; mark('cashToDebt');
    } else if (healthSource.cash !== null && debt === 0) {
      metrics.cashToDebt = 10; mark('cashToDebt'); // no debt = excellent
    }
  }

  // Cash flow quality — TTM FCF preferred, latest annual as fallback
  const fcf = ttmFcf ?? latest?.freeCashFlow ?? null;
  const fcfRevenue = ttmFcf !== null ? ttmRevenue : (latest?.revenue ?? null);
  const fcfIncome = ttmFcf !== null ? ttmNetIncome : (latest?.netIncome ?? null);
  if (fcf !== null && fcfRevenue !== null && fcfRevenue > 0) {
    metrics.fcfMargin = (fcf / fcfRevenue) * 100; mark('fcfMargin');
  }
  if (fcf !== null && fcfIncome !== null && fcfIncome > 0) {
    metrics.fcfConversion = fcf / fcfIncome; mark('fcfConversion');
  }

  return metrics;
}

// ─── Metrics type + fallbacks ───

interface ComputedMetrics {
  netMargin: number | null;
  grossMargin: number | null;
  roe: number | null;
  roa: number | null;
  revenueGrowth: number | null;
  epsGrowth: number | null;
  pe: number | null;
  pb: number | null;
  ps: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  cashToDebt: number | null;
  fcfMargin: number | null;
  fcfConversion: number | null;
}

/** Detect pre-revenue / early-stage companies where revenue-based metrics are meaningless */
function isPreRevenue(metrics: ComputedMetrics): boolean {
  // If profitability, growth, valuation (P/E, P/S), and earnings quality are all null/zero,
  // but balance sheet data may exist — this is likely a pre-revenue company
  const hasNoRevenueBased = metrics.netMargin === null && metrics.grossMargin === null
    && metrics.revenueGrowth === null && metrics.epsGrowth === null
    && metrics.pe === null && metrics.ps === null;
  return hasNoRevenueBased;
}

function emptyMetrics(): ComputedMetrics {
  return {
    netMargin: null, grossMargin: null, roe: null, roa: null,
    revenueGrowth: null, epsGrowth: null,
    pe: null, pb: null, ps: null,
    debtToEquity: null, currentRatio: null, cashToDebt: null,
    fcfMargin: null, fcfConversion: null,
  };
}

/** Fill in any null metrics from Finnhub's pre-computed values */
function backfillFromFinnhub(
  metrics: ComputedMetrics,
  fh: BasicFinancials,
  sources: Partial<Record<string, MetricSource>>,
): void {
  const mark = (key: string) => { sources[key] = 'finnhub'; };

  // Valuation — Finnhub often has these even when Polygon lacks filings
  if (metrics.pe === null && fh.peRatio !== null && fh.peRatio > 0) { metrics.pe = fh.peRatio; mark('pe'); }
  if (metrics.pb === null && fh.pbRatio !== null && fh.pbRatio > 0) { metrics.pb = fh.pbRatio; mark('pb'); }
  if (metrics.ps === null && fh.psRatio !== null && fh.psRatio > 0) { metrics.ps = fh.psRatio; mark('ps'); }

  // Profitability — ROE
  if (metrics.roe === null && metrics.roa === null && fh.roe !== null) { metrics.roe = fh.roe; mark('roe'); }

  // Growth
  if (metrics.revenueGrowth === null && fh.revenueGrowthTTM !== null) { metrics.revenueGrowth = fh.revenueGrowthTTM; mark('revenueGrowth'); }
  if (metrics.epsGrowth === null && fh.epsGrowthTTM !== null) { metrics.epsGrowth = fh.epsGrowthTTM; mark('epsGrowth'); }

  // Financial Health — current ratio
  if (metrics.currentRatio === null && fh.currentRatio !== null) { metrics.currentRatio = fh.currentRatio; mark('currentRatio'); }
}

/** Fill in any null metrics from SEC EDGAR XBRL data (third-tier fallback) */
function backfillFromEdgar(
  metrics: ComputedMetrics,
  edgar: EdgarScoringMetrics,
  price: number,
  marketCap: number,
  sources: Partial<Record<string, MetricSource>>,
): void {
  const mark = (key: string) => { sources[key] = 'edgar'; };

  // Profitability
  if (metrics.netMargin === null && edgar.netMargin !== null) { metrics.netMargin = edgar.netMargin; mark('netMargin'); }
  if (metrics.grossMargin === null && edgar.grossMargin !== null) { metrics.grossMargin = edgar.grossMargin; mark('grossMargin'); }
  if (metrics.roe === null && metrics.roa === null && edgar.roe !== null) { metrics.roe = edgar.roe; mark('roe'); }

  // Growth
  if (metrics.revenueGrowth === null && edgar.revenueGrowth !== null) { metrics.revenueGrowth = edgar.revenueGrowth; mark('revenueGrowth'); }
  if (metrics.epsGrowth === null && edgar.epsGrowth !== null) { metrics.epsGrowth = edgar.epsGrowth; mark('epsGrowth'); }

  // Valuation — compute from EDGAR financials + live price/marketCap
  if (metrics.pe === null && edgar.eps !== null && edgar.eps > 0 && price > 0) {
    metrics.pe = price / edgar.eps; mark('pe');
  }
  if (metrics.pb === null && edgar.equity !== null && edgar.equity > 0 && marketCap > 0) {
    metrics.pb = marketCap / edgar.equity; mark('pb');
  }
  if (metrics.ps === null && edgar.revenue !== null && edgar.revenue > 0 && marketCap > 0) {
    metrics.ps = marketCap / edgar.revenue; mark('ps');
  }

  // Financial Health
  if (metrics.debtToEquity === null && edgar.debtToEquity !== null) { metrics.debtToEquity = edgar.debtToEquity; mark('debtToEquity'); }
  if (metrics.currentRatio === null && edgar.currentRatio !== null) { metrics.currentRatio = edgar.currentRatio; mark('currentRatio'); }
  if (metrics.cashToDebt === null && edgar.cashToDebt !== null) { metrics.cashToDebt = edgar.cashToDebt; mark('cashToDebt'); }
}

// ─── Main Scoring Function ───

export async function computeFundamentalsScore(symbol: string): Promise<FundamentalsScore> {
  const nonScore = isNonScoreable(symbol);
  if (nonScore.skip) {
    return {
      symbol,
      total: 0,
      grade: 'Fair',
      gradeColor: 'bg-black/[0.04] text-black/45 border-black/[0.06]',
      breakdown: emptyBreakdown(),
      rationale: nonScore.reason || 'Not applicable',
      unavailable: true,
      unavailableReason: nonScore.reason,
    };
  }

  return withCache(`fundamentals-score:v2:${symbol}`, TTL.FUNDAMENTALS, async () => {
    // Fetch all data from Polygon + Finnhub + EDGAR in parallel
    const [annuals, quarters, snapshot, tickerDetails, earnings, finnhubMetrics, edgarFundamentals] = await Promise.all([
      getStockFinancials(symbol, 'annual', 3).catch(() => []),
      getStockFinancials(symbol, 'quarterly', 8).catch(() => []),
      getSnapshot(symbol).catch(() => null),
      getTickerDetails(symbol).catch(() => null),
      getEarnings(symbol).catch(() => []),
      getBasicFinancials(symbol).catch(() => null),
      getCompanyFundamentals(symbol).catch(() => null),
    ]);

    const price = snapshot?.price ?? 0;
    const marketCap = tickerDetails?.marketCap ?? 0;
    const sectorProfile = sectorProfileFor(tickerDetails?.sicCode);
    const anchors = SECTOR_ANCHORS[sectorProfile];

    const hasPolygonFinancials = annuals.length > 0 || quarters.length > 0;
    const edgarMetrics = edgarFundamentals ? extractScoringMetrics(edgarFundamentals) : null;

    if (!hasPolygonFinancials && !finnhubMetrics && !edgarMetrics) {
      return {
        symbol,
        total: 0,
        grade: 'Fair' as const,
        gradeColor: 'bg-black/[0.04] text-black/45 border-black/[0.06]',
        breakdown: emptyBreakdown(),
        rationale: 'No financial data available for this stock.',
        unavailable: true,
        unavailableReason: 'No financial statements found',
      };
    }

    const sources: Partial<Record<string, MetricSource>> = {};
    const metrics = hasPolygonFinancials
      ? computeFromPolygon(annuals, quarters, price, marketCap, sources)
      : emptyMetrics();

    // Fill gaps with Finnhub pre-computed metrics where Polygon data is missing
    if (finnhubMetrics) {
      backfillFromFinnhub(metrics, finnhubMetrics, sources);
    }

    // Fill remaining gaps from SEC EDGAR XBRL filings (third fallback)
    if (edgarMetrics) {
      backfillFromEdgar(metrics, edgarMetrics, price, marketCap, sources);
    }

    const preRevenue = isPreRevenue(metrics);
    const isProfitable = metrics.netMargin !== null ? metrics.netMargin > 0
      : metrics.pe !== null ? true : null;

    const profitability = scoreProfitability(metrics.netMargin, metrics.grossMargin, metrics.roe, metrics.roa, anchors);
    const growth = scoreGrowth(metrics.revenueGrowth, metrics.epsGrowth, isProfitable, anchors);
    const valuation = scoreValuation(metrics.pe, metrics.pb, metrics.ps, metrics.epsGrowth, isProfitable, anchors);
    const health = scoreHealth(metrics.debtToEquity, metrics.currentRatio, metrics.cashToDebt, anchors);
    const earningsQuality = scoreEarningsQuality(earnings, edgarFundamentals, metrics.fcfConversion, metrics.fcfMargin, anchors);

    // Pre-revenue companies never renormalize — their missing revenue metrics
    // are a real absence, not a data failure.
    const allowRenorm = !preRevenue;
    const pProf = assemblePillar(profitability.metrics, 25, allowRenorm);
    const pGrow = assemblePillar(growth.metrics, 20, allowRenorm);
    const pVal = assemblePillar(valuation.metrics, 20, allowRenorm);
    const pHealth = assemblePillar(health.metrics, 20, allowRenorm);
    const pEarn = assemblePillar(earningsQuality.metrics, 15, allowRenorm);

    const pillars = [pProf, pGrow, pVal, pHealth, pEarn];
    const totalApplicable = pillars.reduce((s, p) => s + p.applicableMax, 0);
    const totalAvailable = pillars.reduce((s, p) => s + p.availableMax, 0);
    const coveragePct = totalApplicable > 0 ? round1((totalAvailable / totalApplicable) * 100) : 0;

    const total = Math.round(pProf.pts + pGrow.pts + pVal.pts + pHealth.pts + pEarn.pts);
    const { grade, color } = getGrade(total);

    const dataAsOf = quarters[0]?.endDate ?? annuals[0]?.endDate ?? null;

    const breakdown: FundamentalsBreakdown = {
      profitabilityPts: pProf.pts,
      profitabilityMax: 25,
      profitabilityDetail: {
        netMarginPts: profitability.netMarginPts,
        grossMarginPts: profitability.grossMarginPts,
        roePts: profitability.roePts,
        netMargin: metrics.netMargin,
        grossMargin: metrics.grossMargin,
        roe: profitability.roeBasis === 'roa' ? metrics.roa : metrics.roe,
        roeBasis: profitability.roeBasis,
      },
      growthPts: pGrow.pts,
      growthMax: 20,
      growthDetail: {
        revenueGrowthPts: growth.revenueGrowthPts,
        epsGrowthPts: growth.epsGrowthPts,
        revenueGrowth: metrics.revenueGrowth,
        epsGrowth: metrics.epsGrowth,
        lossNarrowing: growth.lossNarrowing,
      },
      valuationPts: pVal.pts,
      valuationMax: 20,
      valuationDetail: {
        pePts: valuation.pePts,
        pbPts: valuation.pbPts,
        psPts: valuation.psPts,
        pe: metrics.pe, pb: metrics.pb, ps: metrics.ps,
        peg: valuation.peg,
        peBasis: valuation.peBasis,
      },
      healthPts: pHealth.pts,
      healthMax: 20,
      healthDetail: {
        debtEquityPts: health.debtEquityPts,
        currentRatioPts: health.currentRatioPts,
        cashDebtPts: health.cashDebtPts,
        debtToEquity: metrics.debtToEquity,
        currentRatio: metrics.currentRatio,
        cashToDebt: metrics.cashToDebt,
      },
      earningsQualityPts: pEarn.pts,
      earningsQualityMax: 15,
      earningsQualityDetail: {
        beatRatePts: earningsQuality.beatRatePts,
        surprisePts: earningsQuality.surprisePts,
        fcfConversionPts: earningsQuality.fcfConversionPts,
        fcfMarginPts: earningsQuality.fcfMarginPts,
        beatRate: earningsQuality.beatRate,
        avgSurprise: earningsQuality.avgSurprise,
        fcfConversion: metrics.fcfConversion,
        fcfMargin: metrics.fcfMargin,
        quartersAnalyzed: earningsQuality.quartersAnalyzed,
        basis: earningsQuality.basis,
      },
      meta: {
        sectorProfile,
        coveragePct,
        sources,
        dataAsOf,
      },
    };

    const rationale = buildRationale(breakdown, preRevenue);

    return { symbol, total, grade, gradeColor: color, breakdown, rationale, preRevenue };
  });
}

function emptyBreakdown(): FundamentalsBreakdown {
  return {
    profitabilityPts: 0, profitabilityMax: 25,
    profitabilityDetail: { netMarginPts: 0, grossMarginPts: 0, roePts: 0, netMargin: null, grossMargin: null, roe: null, roeBasis: null },
    growthPts: 0, growthMax: 20,
    growthDetail: { revenueGrowthPts: 0, epsGrowthPts: 0, revenueGrowth: null, epsGrowth: null, lossNarrowing: false },
    valuationPts: 0, valuationMax: 20,
    valuationDetail: { pePts: 0, pbPts: 0, psPts: 0, pe: null, pb: null, ps: null, peg: null, peBasis: null },
    healthPts: 0, healthMax: 20,
    healthDetail: { debtEquityPts: 0, currentRatioPts: 0, cashDebtPts: 0, debtToEquity: null, currentRatio: null, cashToDebt: null },
    earningsQualityPts: 0, earningsQualityMax: 15,
    earningsQualityDetail: { beatRatePts: 0, surprisePts: 0, fcfConversionPts: 0, fcfMarginPts: 0, beatRate: null, avgSurprise: null, fcfConversion: null, fcfMargin: null, quartersAnalyzed: 0, basis: 'none' },
    meta: { sectorProfile: 'default', coveragePct: 0, sources: {}, dataAsOf: null },
  };
}

// ─── Batch scoring ───

/** Score a single stock with a hard timeout to prevent batch stalls */
function scoreWithTimeout(sym: string, timeoutMs = 30000): Promise<FundamentalsScore> {
  const fallback: FundamentalsScore = {
    symbol: sym,
    total: 0,
    grade: 'Fair' as const,
    gradeColor: 'bg-black/[0.04] text-black/45 border-black/[0.06]',
    breakdown: emptyBreakdown(),
    rationale: 'Unable to fetch fundamental data for this stock.',
    unavailable: true,
    unavailableReason: 'Data fetch failed',
  };

  return Promise.race([
    computeFundamentalsScore(sym).catch(() => fallback),
    new Promise<FundamentalsScore>((resolve) =>
      setTimeout(() => resolve({ ...fallback, unavailableReason: 'Timed out' }), timeoutMs)
    ),
  ]);
}

export async function computeAllScores(symbols: string[]): Promise<FundamentalsScore[]> {
  const CONCURRENCY = 5;
  const results: FundamentalsScore[] = [];

  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    const batch = symbols.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((sym) => scoreWithTimeout(sym))
    );
    results.push(...batchResults);
  }

  return results;
}
