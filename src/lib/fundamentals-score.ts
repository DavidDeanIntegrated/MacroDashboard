// Fundamental Analysis Scoring Engine
// Computes a 0–100 composite score across 5 pillars for each stock
//
// ═══ METHODOLOGY ═══
//
// The score combines five fundamental pillars, each measuring a different
// aspect of business quality. Higher scores indicate stronger fundamentals.
//
// 1. PROFITABILITY (25 pts max)
//    - Net Margin: measures how much profit a company keeps per dollar of revenue.
//      >20% = 10pts, >10% = 7, >5% = 4, >0% = 2, negative = 0
//    - Gross Margin: measures pricing power and cost efficiency.
//      >60% = 8pts, >40% = 6, >25% = 4, >10% = 2, below = 0
//    - Return on Equity (ROE): measures efficiency of shareholder capital.
//      >20% = 7pts, >15% = 5, >10% = 3, >5% = 1, below = 0
//
// 2. GROWTH (20 pts max)
//    - Revenue Growth YoY: top-line momentum.
//      >30% = 10pts, >15% = 8, >7% = 5, >0% = 3, negative = 0
//    - EPS Growth YoY: bottom-line momentum.
//      >30% = 10pts, >15% = 8, >7% = 5, >0% = 3, negative = 0
//
// 3. VALUATION (20 pts max)
//    - P/E Ratio: price vs earnings. Lower is cheaper (but negative PE = unprofitable).
//      <12 = 10pts, <18 = 8, <25 = 6, <35 = 3, <50 = 1, >50 or negative = 0
//    - P/B Ratio: price vs book value. Lower means more asset backing.
//      <1.5 = 5pts, <3 = 4, <5 = 3, <8 = 1, above = 0
//    - P/S Ratio: price vs sales. Useful for unprofitable growth companies.
//      <2 = 5pts, <5 = 4, <10 = 2, <20 = 1, above = 0
//
// 4. FINANCIAL HEALTH (20 pts max)
//    - Debt-to-Equity: measures leverage. Lower is safer.
//      <0.3 = 8pts, <0.5 = 6, <1.0 = 4, <2.0 = 2, above = 0
//    - Current Ratio: short-term liquidity. Measures ability to pay near-term obligations.
//      >2.0 = 6pts, >1.5 = 5, >1.0 = 3, >0.5 = 1, below = 0
//    - Cash vs Debt: net cash position indicates financial resilience.
//      Net cash = 6pts, debt < 2x cash = 4, debt < 5x cash = 2, else = 0
//
// 5. EARNINGS QUALITY (15 pts max)
//    - Beat Rate: % of recent quarters that beat estimates. Consistent beats
//      signal management under-promises and operational execution.
//      100% = 10pts, >=75% = 8, >=50% = 5, >=25% = 2, below = 0
//    - Avg Surprise %: magnitude of earnings surprises.
//      >10% avg = 5pts, >5% = 4, >2% = 3, >0% = 1, negative = 0
//
// ═══ GRADE THRESHOLDS ═══
//   80-100 = Strong Buy    (exceptional fundamentals)
//   65-79  = Buy           (solid fundamentals)
//   50-64  = Hold          (average fundamentals)
//   35-49  = Weak          (below average, caution)
//   0-34   = Poor          (fundamentally challenged)
//
// Scores update automatically: EDGAR data refreshes hourly from SEC filings,
// Finnhub metrics refresh hourly, and earnings data updates after each report.
// ETFs and crypto receive "N/A" since traditional fundamental analysis doesn't apply.

import { getCompanyFundamentals, computeMetrics } from './edgar';
import { getBasicFinancials, getEarnings, type EarningsEstimate } from './finnhub';
import { withCache, TTL } from './cache';

// ─── Types ───

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
  };

  growthPts: number;
  growthMax: 20;
  growthDetail: {
    revenueGrowthPts: number;
    epsGrowthPts: number;
    revenueGrowth: number | null;
    epsGrowth: number | null;
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
    beatRate: number | null;
    avgSurprise: number | null;
    quartersAnalyzed: number;
  };
}

export interface FundamentalsScore {
  symbol: string;
  total: number;
  grade: 'Strong Buy' | 'Buy' | 'Hold' | 'Weak' | 'Poor';
  gradeColor: string;
  breakdown: FundamentalsBreakdown;
  rationale: string;
  unavailable?: boolean;
  unavailableReason?: string;
}

// ─── Scoring Functions ───

function scoreProfitability(
  netMargin: number | null,
  grossMargin: number | null,
  roe: number | null,
): { pts: number; netMarginPts: number; grossMarginPts: number; roePts: number } {
  const netMarginPts = netMargin === null ? 0
    : netMargin > 20 ? 10 : netMargin > 10 ? 7 : netMargin > 5 ? 4 : netMargin > 0 ? 2 : 0;

  const grossMarginPts = grossMargin === null ? 0
    : grossMargin > 60 ? 8 : grossMargin > 40 ? 6 : grossMargin > 25 ? 4 : grossMargin > 10 ? 2 : 0;

  const roePts = roe === null ? 0
    : roe > 20 ? 7 : roe > 15 ? 5 : roe > 10 ? 3 : roe > 5 ? 1 : 0;

  return { pts: netMarginPts + grossMarginPts + roePts, netMarginPts, grossMarginPts, roePts };
}

function scoreGrowth(
  revenueGrowth: number | null,
  epsGrowth: number | null,
): { pts: number; revenueGrowthPts: number; epsGrowthPts: number } {
  const revenueGrowthPts = revenueGrowth === null ? 0
    : revenueGrowth > 30 ? 10 : revenueGrowth > 15 ? 8 : revenueGrowth > 7 ? 5 : revenueGrowth > 0 ? 3 : 0;

  const epsGrowthPts = epsGrowth === null ? 0
    : epsGrowth > 30 ? 10 : epsGrowth > 15 ? 8 : epsGrowth > 7 ? 5 : epsGrowth > 0 ? 3 : 0;

  return { pts: revenueGrowthPts + epsGrowthPts, revenueGrowthPts, epsGrowthPts };
}

function scoreValuation(
  pe: number | null,
  pb: number | null,
  ps: number | null,
): { pts: number; pePts: number; pbPts: number; psPts: number } {
  const pePts = pe === null || pe <= 0 ? 0
    : pe < 12 ? 10 : pe < 18 ? 8 : pe < 25 ? 6 : pe < 35 ? 3 : pe < 50 ? 1 : 0;

  const pbPts = pb === null || pb <= 0 ? 0
    : pb < 1.5 ? 5 : pb < 3 ? 4 : pb < 5 ? 3 : pb < 8 ? 1 : 0;

  const psPts = ps === null || ps <= 0 ? 0
    : ps < 2 ? 5 : ps < 5 ? 4 : ps < 10 ? 2 : ps < 20 ? 1 : 0;

  return { pts: pePts + pbPts + psPts, pePts, pbPts, psPts };
}

function scoreHealth(
  debtToEquity: number | null,
  currentRatio: number | null,
  cashToDebt: number | null,
): { pts: number; debtEquityPts: number; currentRatioPts: number; cashDebtPts: number } {
  const debtEquityPts = debtToEquity === null ? 4 // no debt data often means low/no debt
    : debtToEquity < 0.3 ? 8 : debtToEquity < 0.5 ? 6 : debtToEquity < 1.0 ? 4 : debtToEquity < 2.0 ? 2 : 0;

  const currentRatioPts = currentRatio === null ? 0
    : currentRatio > 2.0 ? 6 : currentRatio > 1.5 ? 5 : currentRatio > 1.0 ? 3 : currentRatio > 0.5 ? 1 : 0;

  const cashDebtPts = cashToDebt === null ? 0
    : cashToDebt > 1 ? 6 : cashToDebt > 0.5 ? 4 : cashToDebt > 0.2 ? 2 : 0;

  return { pts: debtEquityPts + currentRatioPts + cashDebtPts, debtEquityPts, currentRatioPts, cashDebtPts };
}

function scoreEarningsQuality(
  earnings: EarningsEstimate[],
): { pts: number; beatRatePts: number; surprisePts: number; beatRate: number | null; avgSurprise: number | null; quartersAnalyzed: number } {
  const recent = earnings.filter((e) => e.actual !== null && e.estimate !== null).slice(-4);
  if (recent.length === 0) {
    return { pts: 0, beatRatePts: 0, surprisePts: 0, beatRate: null, avgSurprise: null, quartersAnalyzed: 0 };
  }

  const beats = recent.filter((e) => (e.actual ?? 0) >= (e.estimate ?? 0)).length;
  const beatRate = (beats / recent.length) * 100;
  const surprises = recent
    .filter((e) => e.surprisePercent !== null)
    .map((e) => e.surprisePercent!);
  const avgSurprise = surprises.length > 0
    ? surprises.reduce((a, b) => a + b, 0) / surprises.length
    : null;

  const beatRatePts = beatRate >= 100 ? 10 : beatRate >= 75 ? 8 : beatRate >= 50 ? 5 : beatRate >= 25 ? 2 : 0;
  const surprisePts = avgSurprise === null ? 0
    : avgSurprise > 10 ? 5 : avgSurprise > 5 ? 4 : avgSurprise > 2 ? 3 : avgSurprise > 0 ? 1 : 0;

  return { pts: beatRatePts + surprisePts, beatRatePts, surprisePts, beatRate, avgSurprise, quartersAnalyzed: recent.length };
}

function getGrade(total: number): { grade: FundamentalsScore['grade']; color: string } {
  if (total >= 80) return { grade: 'Strong Buy', color: 'bg-accent-green/20 text-green-800 border-green-200' };
  if (total >= 65) return { grade: 'Buy', color: 'bg-accent-green/10 text-green-700 border-green-100' };
  if (total >= 50) return { grade: 'Hold', color: 'bg-accent-blue/10 text-blue-700 border-blue-100' };
  if (total >= 35) return { grade: 'Weak', color: 'bg-accent-orange/10 text-orange-700 border-orange-100' };
  return { grade: 'Poor', color: 'bg-accent-red/10 text-red-700 border-red-100' };
}

function buildRationale(symbol: string, total: number, breakdown: FundamentalsBreakdown): string {
  const parts: string[] = [];
  const { profitabilityPts, growthPts, valuationPts, healthPts, earningsQualityPts } = breakdown;
  const pd = breakdown.profitabilityDetail;
  const gd = breakdown.growthDetail;
  const vd = breakdown.valuationDetail;
  const hd = breakdown.healthDetail;
  const ed = breakdown.earningsQualityDetail;

  // Profitability
  if (profitabilityPts >= 20) {
    parts.push(`Highly profitable with${pd.netMargin !== null ? ` ${pd.netMargin.toFixed(1)}% net margin` : ''}${pd.grossMargin !== null ? `, ${pd.grossMargin.toFixed(1)}% gross margin` : ''}${pd.roe !== null ? `, and ${pd.roe.toFixed(1)}% ROE` : ''}.`);
  } else if (profitabilityPts >= 10) {
    parts.push(`Decent profitability${pd.netMargin !== null ? ` (${pd.netMargin.toFixed(1)}% net margin)` : ''}, though there\'s room for margin expansion.`);
  } else if (profitabilityPts > 0) {
    parts.push(`Thin margins${pd.netMargin !== null ? ` (${pd.netMargin.toFixed(1)}% net margin)` : ''} suggest limited pricing power or high costs.`);
  } else {
    parts.push('Currently unprofitable or insufficient profitability data.');
  }

  // Growth
  if (growthPts >= 16) {
    parts.push(`Strong growth trajectory${gd.revenueGrowth !== null ? ` with ${gd.revenueGrowth.toFixed(1)}% revenue growth` : ''}${gd.epsGrowth !== null ? ` and ${gd.epsGrowth.toFixed(1)}% EPS growth` : ''}.`);
  } else if (growthPts >= 8) {
    parts.push(`Moderate growth${gd.revenueGrowth !== null ? ` (${gd.revenueGrowth.toFixed(1)}% revenue)` : ''}.`);
  } else if (growthPts > 0) {
    parts.push('Growth is slowing but still positive.');
  } else {
    parts.push('Revenue or earnings are declining, indicating headwinds.');
  }

  // Valuation
  if (valuationPts >= 15) {
    parts.push(`Attractively valued${vd.pe !== null ? ` at ${vd.pe.toFixed(1)}x earnings` : ''}${vd.pb !== null ? `, ${vd.pb.toFixed(1)}x book` : ''}.`);
  } else if (valuationPts >= 8) {
    parts.push(`Fairly valued${vd.pe !== null ? ` (${vd.pe.toFixed(1)}x PE)` : ''}, not stretched but not a bargain.`);
  } else if (valuationPts > 0) {
    parts.push(`Richly valued${vd.pe !== null ? ` at ${vd.pe.toFixed(1)}x earnings` : ''} — growth expectations are priced in.`);
  } else {
    parts.push('Expensive or unprofitable, making valuation difficult to justify on earnings alone.');
  }

  // Health
  if (healthPts >= 15) {
    parts.push('Fortress balance sheet with low debt and strong liquidity.');
  } else if (healthPts >= 8) {
    parts.push(`Healthy balance sheet${hd.debtToEquity !== null ? ` (${hd.debtToEquity.toFixed(2)}x D/E)` : ''}.`);
  } else if (healthPts > 0) {
    parts.push(`Elevated leverage${hd.debtToEquity !== null ? ` (${hd.debtToEquity.toFixed(2)}x D/E)` : ''} adds risk in a downturn.`);
  } else {
    parts.push('Financial health data is limited or shows concerning leverage.');
  }

  // Earnings quality
  if (earningsQualityPts >= 12) {
    parts.push(`Excellent earnings execution — ${ed.beatRate?.toFixed(0)}% beat rate over ${ed.quartersAnalyzed} quarters.`);
  } else if (earningsQualityPts >= 6) {
    parts.push(`Decent earnings track record (${ed.beatRate?.toFixed(0)}% beat rate).`);
  } else if (ed.quartersAnalyzed > 0) {
    parts.push('Inconsistent earnings relative to estimates.');
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

// ─── Main Scoring Function ───

export async function computeFundamentalsScore(symbol: string): Promise<FundamentalsScore> {
  const nonScore = isNonScoreable(symbol);
  if (nonScore.skip) {
    return {
      symbol,
      total: 0,
      grade: 'Hold',
      gradeColor: 'bg-black/[0.04] text-black/45 border-black/[0.06]',
      breakdown: emptyBreakdown(),
      rationale: nonScore.reason || 'Not applicable',
      unavailable: true,
      unavailableReason: nonScore.reason,
    };
  }

  return withCache(`fundamentals-score:${symbol}`, TTL.FUNDAMENTALS, async () => {
    // Fetch all data sources in parallel
    const [edgarData, finnhubMetrics, earnings] = await Promise.all([
      getCompanyFundamentals(symbol).catch(() => null),
      getBasicFinancials(symbol).catch(() => null),
      getEarnings(symbol).catch(() => []),
    ]);

    const edgarMetrics = edgarData ? computeMetrics(edgarData) : null;

    // Merge data: prefer Finnhub for valuation metrics (more current), EDGAR for margins
    const netMargin = edgarMetrics?.netMargin ?? null;
    const grossMargin = edgarMetrics?.grossMargin ?? null;
    const roe = finnhubMetrics?.roe ?? null;
    const revenueGrowth = finnhubMetrics?.revenueGrowthTTM ?? null;
    const epsGrowth = finnhubMetrics?.epsGrowthTTM ?? null;
    const pe = finnhubMetrics?.peRatio ?? null;
    const pb = finnhubMetrics?.pbRatio ?? null;
    const ps = finnhubMetrics?.psRatio ?? null;
    const debtToEquity = edgarMetrics?.debtToEquity ?? null;
    const currentRatio = finnhubMetrics?.currentRatio ?? null;

    // Cash to debt ratio from EDGAR
    let cashToDebt: number | null = null;
    if (edgarData) {
      const cashArr = edgarData.cash;
      const debtArr = edgarData.longTermDebt;
      const latestCash = cashArr.length > 0 ? cashArr[cashArr.length - 1].value : null;
      const latestDebt = debtArr.length > 0 ? debtArr[debtArr.length - 1].value : null;
      if (latestCash !== null && latestDebt !== null && latestDebt > 0) {
        cashToDebt = latestCash / latestDebt;
      } else if (latestCash !== null && (latestDebt === null || latestDebt === 0)) {
        cashToDebt = 10; // no debt = very good
      }
    }

    const profitability = scoreProfitability(netMargin, grossMargin, roe);
    const growth = scoreGrowth(revenueGrowth, epsGrowth);
    const valuation = scoreValuation(pe, pb, ps);
    const health = scoreHealth(debtToEquity, currentRatio, cashToDebt);
    const earningsQuality = scoreEarningsQuality(earnings);

    const total = profitability.pts + growth.pts + valuation.pts + health.pts + earningsQuality.pts;
    const { grade, color } = getGrade(total);

    const breakdown: FundamentalsBreakdown = {
      profitabilityPts: profitability.pts,
      profitabilityMax: 25,
      profitabilityDetail: {
        netMarginPts: profitability.netMarginPts,
        grossMarginPts: profitability.grossMarginPts,
        roePts: profitability.roePts,
        netMargin,
        grossMargin,
        roe,
      },
      growthPts: growth.pts,
      growthMax: 20,
      growthDetail: {
        revenueGrowthPts: growth.revenueGrowthPts,
        epsGrowthPts: growth.epsGrowthPts,
        revenueGrowth,
        epsGrowth,
      },
      valuationPts: valuation.pts,
      valuationMax: 20,
      valuationDetail: {
        pePts: valuation.pePts,
        pbPts: valuation.pbPts,
        psPts: valuation.psPts,
        pe, pb, ps,
      },
      healthPts: health.pts,
      healthMax: 20,
      healthDetail: {
        debtEquityPts: health.debtEquityPts,
        currentRatioPts: health.currentRatioPts,
        cashDebtPts: health.cashDebtPts,
        debtToEquity,
        currentRatio,
        cashToDebt,
      },
      earningsQualityPts: earningsQuality.pts,
      earningsQualityMax: 15,
      earningsQualityDetail: {
        beatRatePts: earningsQuality.beatRatePts,
        surprisePts: earningsQuality.surprisePts,
        beatRate: earningsQuality.beatRate,
        avgSurprise: earningsQuality.avgSurprise,
        quartersAnalyzed: earningsQuality.quartersAnalyzed,
      },
    };

    const rationale = buildRationale(symbol, total, breakdown);

    return { symbol, total, grade, gradeColor: color, breakdown, rationale };
  });
}

function emptyBreakdown(): FundamentalsBreakdown {
  return {
    profitabilityPts: 0, profitabilityMax: 25,
    profitabilityDetail: { netMarginPts: 0, grossMarginPts: 0, roePts: 0, netMargin: null, grossMargin: null, roe: null },
    growthPts: 0, growthMax: 20,
    growthDetail: { revenueGrowthPts: 0, epsGrowthPts: 0, revenueGrowth: null, epsGrowth: null },
    valuationPts: 0, valuationMax: 20,
    valuationDetail: { pePts: 0, pbPts: 0, psPts: 0, pe: null, pb: null, ps: null },
    healthPts: 0, healthMax: 20,
    healthDetail: { debtEquityPts: 0, currentRatioPts: 0, cashDebtPts: 0, debtToEquity: null, currentRatio: null, cashToDebt: null },
    earningsQualityPts: 0, earningsQualityMax: 15,
    earningsQualityDetail: { beatRatePts: 0, surprisePts: 0, beatRate: null, avgSurprise: null, quartersAnalyzed: 0 },
  };
}

// ─── Batch scoring ───

export async function computeAllScores(symbols: string[]): Promise<FundamentalsScore[]> {
  // Process in parallel with concurrency limit to avoid rate limits
  const CONCURRENCY = 4;
  const results: FundamentalsScore[] = [];

  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    const batch = symbols.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((sym) => computeFundamentalsScore(sym).catch(() => ({
        symbol: sym,
        total: 0,
        grade: 'Hold' as const,
        gradeColor: 'bg-black/[0.04] text-black/45 border-black/[0.06]',
        breakdown: emptyBreakdown(),
        rationale: 'Unable to fetch fundamental data for this stock.',
        unavailable: true,
        unavailableReason: 'Data fetch failed',
      })))
    );
    results.push(...batchResults);
  }

  return results;
}
