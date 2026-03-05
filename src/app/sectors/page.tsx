'use client';

import { useState, useMemo } from 'react';
import { Card, CardTitle } from '@/components/ui/Card';
import { LoadingPage } from '@/components/ui/Loading';
import { Badge } from '@/components/ui/Badge';
import { MultiSeriesChart } from '@/components/charts/TimeSeriesChart';
import { useMultiAggregates, useMacroRegime, useYieldCurve, useFredDashboard } from '@/lib/hooks';
import { RegimeBadge } from '@/components/ui/Badge';

const SECTOR_ETFS = [
  { symbol: 'XLK', name: 'Technology', color: '#007AFF' },
  { symbol: 'XLF', name: 'Financials', color: '#34C759' },
  { symbol: 'XLE', name: 'Energy', color: '#FF9500' },
  { symbol: 'XLV', name: 'Health Care', color: '#AF52DE' },
  { symbol: 'XLI', name: 'Industrials', color: '#8E8E93' },
  { symbol: 'XLY', name: 'Consumer Disc.', color: '#FF3B30' },
  { symbol: 'XLP', name: 'Consumer Staples', color: '#5856D6' },
  { symbol: 'XLU', name: 'Utilities', color: '#FF2D55' },
  { symbol: 'XLRE', name: 'Real Estate', color: '#AC8E68' },
  { symbol: 'XLC', name: 'Communication', color: '#30B0C7' },
  { symbol: 'XLB', name: 'Materials', color: '#E6A700' },
];

type HeatmapPeriod = '1W' | '1M' | '3M' | '6M' | '1Y';

const PERIOD_DAYS: Record<HeatmapPeriod, number> = {
  '1W': 7,
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
};

function getReturn(data: Array<{ close: number }>, days: number): number {
  if (data.length < 2) return 0;
  const startIdx = Math.max(0, data.length - days - 1);
  const start = data[startIdx].close;
  const end = data[data.length - 1].close;
  return ((end - start) / start) * 100;
}

function heatColor(value: number): string {
  if (value > 10) return 'bg-accent-green/25 text-green-800';
  if (value > 5) return 'bg-accent-green/15 text-green-700';
  if (value > 2) return 'bg-accent-green/10 text-green-700';
  if (value > 0) return 'bg-accent-green/[0.06] text-green-600';
  if (value > -2) return 'bg-accent-red/[0.06] text-red-600';
  if (value > -5) return 'bg-accent-red/10 text-red-700';
  if (value > -10) return 'bg-accent-red/15 text-red-700';
  return 'bg-accent-red/25 text-red-800';
}

const REGIME_COLORS: Record<string, string> = {
  Goldilocks: '#34C759',
  Reflation: '#FF9500',
  Stagflation: '#FF3B30',
  'Deflation / Contraction': '#007AFF',
};

const REGIME_LEADERS: Record<string, string[]> = {
  Goldilocks: ['XLK', 'XLY', 'XLC'],
  Reflation: ['XLE', 'XLB', 'XLF'],
  Stagflation: ['XLE', 'XLP', 'XLU'],
  'Deflation / Contraction': ['XLU', 'XLP', 'XLRE'],
};

function computeRegimeScore(
  leaders: string[],
  excessReturns: Record<string, number>
): number {
  const leaderExcess = leaders.map((sym) => excessReturns[sym] || 0);
  const avgExcess = leaderExcess.reduce((a, b) => a + b, 0) / leaderExcess.length;
  const leadersOutperforming = leaderExcess.filter((e) => e > 0).length;
  const breadth = leadersOutperforming / leaders.length;
  const rawFromExcess = Math.max(0, Math.min(100, (avgExcess + 10) * 5));
  const breadthMultiplier = 0.5 + breadth * 0.5;
  return Math.round(Math.max(0, Math.min(100, rawFromExcess * breadthMultiplier)));
}

export default function SectorsPage() {
  const [selectedPeriod, setSelectedPeriod] = useState<HeatmapPeriod>('1M');

  // Fetch 1 year of data for all sectors (we'll slice for shorter periods)
  const fromDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 370);
    return d.toISOString().split('T')[0];
  }, []);

  const { data: sectorData, loading } = useMultiAggregates(
    SECTOR_ETFS.map((s) => s.symbol),
    '1day',
    fromDate
  );

  // Also fetch SPY as benchmark
  const { data: benchmarkData } = useMultiAggregates(['SPY'], '1day', fromDate);

  // FRED macro regime (economic fundamentals)
  const { data: fredRegime } = useMacroRegime();

  // Leading indicators for monitoring panel
  const { data: yieldCurve } = useYieldCurve();
  const { data: fredDashboard } = useFredDashboard();

  if (loading) return <LoadingPage />;

  // Compute returns for each period
  const allPeriods: HeatmapPeriod[] = ['1W', '1M', '3M', '6M', '1Y'];

  const sectorReturns = SECTOR_ETFS.map((etf) => {
    const series = sectorData?.find((s) => s.symbol === etf.symbol)?.data || [];
    const returns: Record<HeatmapPeriod, number> = {} as Record<HeatmapPeriod, number>;
    for (const p of allPeriods) {
      returns[p] = getReturn(series, PERIOD_DAYS[p]);
    }
    return { ...etf, returns, data: series };
  });

  const spyData = benchmarkData?.find((b) => b.symbol === 'SPY')?.data || [];
  const spyReturns: Record<HeatmapPeriod, number> = {} as Record<HeatmapPeriod, number>;
  for (const p of allPeriods) {
    spyReturns[p] = getReturn(spyData, PERIOD_DAYS[p]);
  }

  // Sort by selected period return
  const sorted = [...sectorReturns].sort((a, b) => b.returns[selectedPeriod] - a.returns[selectedPeriod]);

  // Latest market data date (from SPY's most recent bar)
  const latestDataDate = spyData.length > 0 ? spyData[spyData.length - 1].date : null;
  const formattedDataDate = latestDataDate
    ? new Date(latestDataDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  // Regime hints based on sector leadership
  const topSectors = sorted.slice(0, 3).map((s) => s.symbol);
  const topSectorNames = sorted.slice(0, 3).map((s) => `${s.symbol} (${s.name})`).join(', ');
  const regimeHint = (() => {
    if (topSectors.includes('XLE') && topSectors.includes('XLB'))
      return {
        label: 'Reflation', badge: 'orange' as const,
        text: 'Energy & Materials leading suggests rising commodity prices and inflation expectations.',
        reasoning: `The top 3 sectors over ${selectedPeriod} are ${topSectorNames}. Energy (XLE) and Materials (XLB) both appearing in the top 3 is the classic reflation signature — investors are positioning for rising commodity prices, a weaker dollar, and inflation expectations moving higher. This pattern historically emerges when the economy is growing but monetary conditions are loose enough to fuel price pressures. In past cycles, this rotation preceded CPI acceleration by 2-4 months.`,
      };
    if (topSectors.includes('XLU') && topSectors.includes('XLP'))
      return {
        label: 'Defensive / Late Cycle', badge: 'red' as const,
        text: 'Utilities & Staples leading suggests risk-off positioning and potential slowdown.',
        reasoning: `The top 3 sectors over ${selectedPeriod} are ${topSectorNames}. Utilities (XLU) and Consumer Staples (XLP) both in the top 3 is a defensive rotation — investors are moving capital away from cyclical, high-beta sectors into stable cash-flow businesses with inelastic demand. This pattern typically signals that the market is pricing in slower economic growth or recession risk. These sectors outperform because they offer bond-like income characteristics and their earnings are less sensitive to the economic cycle. Historically, this defensive leadership has preceded economic downturns by 3-6 months.`,
      };
    if (topSectors.includes('XLK') && topSectors.includes('XLC'))
      return {
        label: 'Growth / Risk-On', badge: 'green' as const,
        text: 'Tech & Communication leading suggests growth optimism and risk appetite.',
        reasoning: `The top 3 sectors over ${selectedPeriod} are ${topSectorNames}. Technology (XLK) and Communication Services (XLC) both leading is a growth/risk-on signal — investors are willing to pay premium multiples for earnings growth, which requires confidence in a stable-to-improving economic outlook. These long-duration sectors benefit most from falling or low interest rates and a favorable liquidity backdrop. This pattern is consistent with a Goldilocks environment where growth is solid but inflation isn't threatening enough to force aggressive tightening.`,
      };
    if (topSectors.includes('XLF') && topSectors.includes('XLI'))
      return {
        label: 'Early Cycle', badge: 'blue' as const,
        text: 'Financials & Industrials leading suggests economic expansion and rising rates.',
        reasoning: `The top 3 sectors over ${selectedPeriod} are ${topSectorNames}. Financials (XLF) and Industrials (XLI) both in the top 3 is a classic early-cycle rotation — Financials benefit from a steepening yield curve and rising loan demand, while Industrials benefit from capex recovery and improving PMI data. This pattern historically appears as the economy exits contraction and enters expansion, and often precedes broad market strength by 1-3 months. It signals that credit conditions are improving and businesses are investing again.`,
      };
    return {
      label: 'Mixed', badge: 'neutral' as const,
      text: 'No clear sector leadership pattern. Markets may be in transition.',
      reasoning: `The top 3 sectors over ${selectedPeriod} are ${topSectorNames}. No two sectors from a single regime archetype appear together in the top 3, meaning sector leadership is fragmented. This often occurs during regime transitions — the market hasn't yet committed to a directional view. Fragmented leadership can also signal that stock-specific factors (earnings surprises, M&A) are driving returns more than macro forces. Watch whether a clearer pattern emerges over the next 2-4 weeks.`,
    };
  })();

  // ─── REGIME FIT SCORES ───
  // For each macro regime, compute how well the "expected leader" sectors are
  // actually outperforming SPY. Score = average excess return of leader ETFs,
  // normalized to 0-100 scale where 100 = all leaders beating SPY by 10%+.
  const regimeDefinitions = [
    {
      name: 'Goldilocks',
      badge: 'green' as const,
      border: 'border-accent-green/20',
      bg: 'bg-accent-green/[0.03]',
      barColor: 'bg-accent-green',
      description: 'Moderate growth, low inflation, easy policy.',
      leaders: ['XLK', 'XLY', 'XLC'],
      leaderLabel: 'XLK, XLY, XLC (growth & consumer)',
      positioning: {
        overweight: 'Growth equities (QQQ), Tech (XLK), Consumer Discretionary (XLY), Small-caps (IWM)',
        underweight: 'Commodities, Utilities, Cash',
        fixedIncome: 'Shorter duration corporate credit; consider high-yield for carry',
        alternatives: 'Growth-oriented factor ETFs, momentum strategies',
        rationale: 'Maximum risk appetite — lean into duration and beta. Earnings growth is the primary driver; companies with strong secular trends outperform. Low inflation means the Fed is on hold or easing, supporting multiples.',
      },
      interpretation: {
        high: 'Growth and consumer discretionary sectors are strongly outperforming — markets are pricing in a favorable economic backdrop with healthy earnings growth and manageable inflation.',
        mid: 'Some growth leadership but not dominant — the market sees moderate tailwinds but isn\'t fully in "risk-on" mode.',
        low: 'Growth sectors are underperforming — the market doesn\'t see a goldilocks environment right now. Look for rotation into defensive or value.',
      },
    },
    {
      name: 'Reflation',
      badge: 'orange' as const,
      border: 'border-accent-orange/20',
      bg: 'bg-accent-orange/[0.03]',
      barColor: 'bg-accent-orange',
      description: 'Rising inflation, strong growth, tightening.',
      leaders: ['XLE', 'XLB', 'XLF'],
      leaderLabel: 'XLE, XLB, XLF (commodities & financials)',
      positioning: {
        overweight: 'Commodities (DJP/GSG), Energy (XLE), Materials (XLB), Financials (XLF), TIPS, Value stocks',
        underweight: 'Long-duration growth (unprofitable tech), Long-term Treasuries (TLT)',
        fixedIncome: 'TIPS over nominal bonds; floating-rate notes; short duration',
        alternatives: 'Commodity futures, real assets, infrastructure, value factor ETFs',
        rationale: 'Inflation is the dominant force — own assets with pricing power and real asset backing. Nominal bonds lose purchasing power; equities with tangible asset bases (energy, materials) preserve it. Financials benefit from a steepening yield curve as the Fed tightens.',
      },
      interpretation: {
        high: 'Energy, materials, and financials dominating — strong signal of rising inflation expectations and commodity demand. Pricing power matters most in this environment.',
        mid: 'Some commodity/financial strength — inflation expectations are building but not yet dominant. Monitor CPI and commodity prices for confirmation.',
        low: 'Commodity and financial sectors lagging — the market doesn\'t see a reflationary impulse. Inflation expectations may be well-anchored or declining.',
      },
    },
    {
      name: 'Stagflation',
      badge: 'red' as const,
      border: 'border-accent-red/20',
      bg: 'bg-accent-red/[0.03]',
      barColor: 'bg-accent-red',
      description: 'High inflation, slowing growth.',
      leaders: ['XLE', 'XLP', 'XLU'],
      leaderLabel: 'XLE, XLP, XLU (energy & defensives)',
      positioning: {
        overweight: 'Energy (XLE), Commodities, Consumer Staples (XLP), Healthcare (XLV), Cash',
        underweight: 'Consumer Discretionary (XLY), Small-caps, Unprofitable growth, Cyclicals',
        fixedIncome: 'TIPS, short-duration bonds, cash equivalents (T-bills); avoid long-duration',
        alternatives: 'Gold (GLD), commodity trend-following, managed futures (DBMF), low-vol factor',
        rationale: 'The hardest environment for portfolios — both stocks and bonds struggle. Prioritize real assets (energy, commodities) for inflation protection and defensive sectors (staples, healthcare) for earnings stability. Raise cash allocation. Avoid anything dependent on economic growth or multiple expansion. Gold historically shines as a stagflation hedge.',
      },
      interpretation: {
        high: 'Energy outperforming alongside defensive sectors — a classic stagflation signature. The market is pricing in persistent inflation with slowing growth. This is the hardest environment for portfolios.',
        mid: 'Some defensive + energy leadership — mixed signals. Inflation may be sticky while growth is uncertain. Watch the yield curve for confirmation.',
        low: 'No stagflation pattern — either growth is healthy (goldilocks/reflation) or we\'re in a deflationary bust. Neither energy nor defensives are leading.',
      },
    },
    {
      name: 'Deflation / Contraction',
      badge: 'blue' as const,
      border: 'border-accent-blue/20',
      bg: 'bg-accent-blue/[0.03]',
      barColor: 'bg-accent-blue',
      description: 'Falling prices, demand collapsing, rate cuts.',
      leaders: ['XLU', 'XLP', 'XLRE'],
      leaderLabel: 'XLU, XLP, XLRE (defensives & duration)',
      positioning: {
        overweight: 'Long-term Treasuries (TLT/EDV), Utilities (XLU), REITs (XLRE), Investment-grade bonds',
        underweight: 'Cyclicals, Commodities, Financials, High-yield credit',
        fixedIncome: 'Extend duration aggressively — long-term Treasuries rally as rates fall; investment-grade credit over high-yield',
        alternatives: 'Managed futures (trend-following benefits from bond rally), gold, defensive equity factors (low-vol, quality)',
        rationale: 'Duration is king — falling rates drive outsized gains in long bonds and rate-sensitive equities (utilities, REITs). Avoid cyclicals and anything tied to economic growth. Credit spreads widen, so favor Treasuries over corporate debt. This environment historically precedes Fed rate cuts, making long-duration the highest-conviction trade.',
      },
      interpretation: {
        high: 'Pure defensives and rate-sensitive sectors leading — markets are positioning for economic contraction and rate cuts. Capital preservation is the priority. Duration assets (bonds, REITs) benefit from falling rates.',
        mid: 'Some flight to safety — the market is hedging downside risk but hasn\'t fully capitulated. Monitor credit spreads and leading indicators.',
        low: 'No deflationary positioning — the market sees growth and/or inflation ahead, not contraction. Risk assets are preferred over safety.',
      },
    },
  ];

  // Build a lookup: symbol → excess return over SPY for the selected period
  const excessReturns: Record<string, number> = {};
  for (const s of sectorReturns) {
    excessReturns[s.symbol] = s.returns[selectedPeriod] - spyReturns[selectedPeriod];
  }

  const regimeScores = regimeDefinitions.map((regime) => {
    // Average excess return of leader sectors
    const leaderExcess = regime.leaders.map((sym) => excessReturns[sym] || 0);
    const avgExcess = leaderExcess.reduce((a, b) => a + b, 0) / leaderExcess.length;

    // Also factor in: are ALL leaders positive (outperforming)?
    const leadersOutperforming = leaderExcess.filter((e) => e > 0).length;
    const breadth = leadersOutperforming / regime.leaders.length; // 0 to 1

    // Raw score: average excess return scaled. +10% excess → 100, 0% → 50, -10% → 0
    const rawFromExcess = Math.max(0, Math.min(100, (avgExcess + 10) * 5));
    // Breadth bonus: if all leaders outperform, boost; if none do, penalize
    const breadthMultiplier = 0.5 + breadth * 0.5; // 0.5 to 1.0

    const score = Math.round(Math.max(0, Math.min(100, rawFromExcess * breadthMultiplier)));

    const interpretationLevel = score >= 60 ? 'high' : score >= 35 ? 'mid' : 'low';

    return {
      ...regime,
      score,
      avgExcess,
      breadth,
      leaderExcess,
      interpretation: regime.interpretation[interpretationLevel],
    };
  }).sort((a, b) => b.score - a.score);

  // ─── CROSS-TIMEFRAME REGIME SCORES (for monitoring panel) ───
  const regimeNames = Object.keys(REGIME_LEADERS);
  const crossTimeframeScores: Record<string, Record<HeatmapPeriod, number>> = {};
  for (const name of regimeNames) {
    crossTimeframeScores[name] = {} as Record<HeatmapPeriod, number>;
    for (const p of allPeriods) {
      const periodExcess: Record<string, number> = {};
      for (const s of sectorReturns) {
        periodExcess[s.symbol] = s.returns[p] - spyReturns[p];
      }
      crossTimeframeScores[name][p] = computeRegimeScore(REGIME_LEADERS[name], periodExcess);
    }
  }

  // Determine timeframe agreement: does the top regime at 1W match 1M and 3M?
  const topRegimeByPeriod: Record<HeatmapPeriod, string> = {} as Record<HeatmapPeriod, string>;
  for (const p of allPeriods) {
    let best = regimeNames[0];
    let bestScore = 0;
    for (const name of regimeNames) {
      if (crossTimeframeScores[name][p] > bestScore) {
        bestScore = crossTimeframeScores[name][p];
        best = name;
      }
    }
    topRegimeByPeriod[p] = best;
  }
  const timeframeAgreement = (
    topRegimeByPeriod['1W'] === topRegimeByPeriod['1M'] &&
    topRegimeByPeriod['1M'] === topRegimeByPeriod['3M']
  );

  // ─── ROLLING REGIME HISTORY (weekly snapshots from daily data) ───
  const rollingRegimeData: Array<{ date: string; [key: string]: string | number }> = [];
  if (spyData.length > 60) {
    // Sample every 5 trading days over the last ~90 trading days
    const lookbackBars = Math.min(spyData.length, 90);
    const startBar = spyData.length - lookbackBars;
    for (let i = startBar; i < spyData.length; i += 5) {
      const snapshotDate = spyData[i].date;
      const point: { date: string; [key: string]: string | number } = { date: snapshotDate };
      // For each regime, compute score using trailing 30-day returns up to this point
      const windowDays = 30;
      for (const name of regimeNames) {
        const leaderExcess = REGIME_LEADERS[name].map((sym) => {
          const sData = sectorReturns.find((s) => s.symbol === sym)?.data || [];
          const symBar = sData.findIndex((d) => d.date >= snapshotDate);
          const idx = symBar >= 0 ? symBar : sData.length - 1;
          const start = Math.max(0, idx - windowDays);
          if (idx <= start || !sData[start] || !sData[idx]) return 0;
          const symRet = ((sData[idx].close - sData[start].close) / sData[start].close) * 100;
          const spyIdx = spyData.findIndex((d) => d.date >= snapshotDate);
          const spyStartIdx = Math.max(0, (spyIdx >= 0 ? spyIdx : spyData.length - 1) - windowDays);
          const spyEndIdx = spyIdx >= 0 ? spyIdx : spyData.length - 1;
          if (spyEndIdx <= spyStartIdx || !spyData[spyStartIdx] || !spyData[spyEndIdx]) return 0;
          const spyRet = ((spyData[spyEndIdx].close - spyData[spyStartIdx].close) / spyData[spyStartIdx].close) * 100;
          return symRet - spyRet;
        });
        const avgExcess = leaderExcess.reduce((a, b) => a + b, 0) / leaderExcess.length;
        const breadth = leaderExcess.filter((e) => e > 0).length / leaderExcess.length;
        const raw = Math.max(0, Math.min(100, (avgExcess + 10) * 5));
        point[name] = Math.round(Math.max(0, Math.min(100, raw * (0.5 + breadth * 0.5))));
      }
      rollingRegimeData.push(point);
    }
  }

  // ─── LEADING INDICATOR SIGNALS (from FRED data) ───
  const leadingIndicators: Array<{
    name: string;
    value: string;
    trend: 'up' | 'down' | 'flat';
    supports: string;
    contradicts: string;
    signal: 'supports' | 'contradicts' | 'neutral';
  }> = [];

  if (fredRegime) {
    const topSectorRegimeName = regimeScores[0]?.name || '';

    // CPI
    const cpiSignal = (() => {
      if (fredRegime.inflationTrend === 'rising') return { supports: 'Reflation, Stagflation', contradicts: 'Goldilocks, Deflation / Contraction' };
      if (fredRegime.inflationTrend === 'falling') return { supports: 'Goldilocks, Deflation / Contraction', contradicts: 'Reflation, Stagflation' };
      return { supports: '', contradicts: '' };
    })();
    const cpiAlignment = cpiSignal.supports.toLowerCase().includes(topSectorRegimeName.toLowerCase().split(' ')[0])
      ? 'supports' : cpiSignal.contradicts.toLowerCase().includes(topSectorRegimeName.toLowerCase().split(' ')[0])
      ? 'contradicts' : 'neutral' as const;
    leadingIndicators.push({
      name: 'CPI YoY',
      value: `${fredRegime.latestInflation.toFixed(1)}%`,
      trend: fredRegime.inflationTrend === 'rising' ? 'up' : fredRegime.inflationTrend === 'falling' ? 'down' : 'flat',
      ...cpiSignal,
      signal: cpiAlignment,
    });

    // Unemployment
    const unempSignal = (() => {
      if (fredRegime.growthTrend === 'decelerating') return { supports: 'Stagflation, Deflation / Contraction', contradicts: 'Goldilocks, Reflation' };
      if (fredRegime.growthTrend === 'accelerating') return { supports: 'Goldilocks, Reflation', contradicts: 'Stagflation, Deflation / Contraction' };
      return { supports: '', contradicts: '' };
    })();
    const unempAlignment = unempSignal.supports.toLowerCase().includes(topSectorRegimeName.toLowerCase().split(' ')[0])
      ? 'supports' : unempSignal.contradicts.toLowerCase().includes(topSectorRegimeName.toLowerCase().split(' ')[0])
      ? 'contradicts' : 'neutral' as const;
    leadingIndicators.push({
      name: 'Unemployment',
      value: `${fredRegime.latestUnemployment.toFixed(1)}%`,
      trend: fredRegime.growthTrend === 'decelerating' ? 'up' : fredRegime.growthTrend === 'accelerating' ? 'down' : 'flat',
      ...unempSignal,
      signal: unempAlignment,
    });

    // Yield curve (10Y-2Y spread)
    if (yieldCurve) {
      const t10y = yieldCurve.find((y) => y.id === 'DGS10');
      const t2y = yieldCurve.find((y) => y.id === 'DGS2');
      if (t10y && t2y) {
        const spread = t10y.value - t2y.value;
        const ycSupports = spread < 0 ? 'Deflation / Contraction, Stagflation' : spread > 0.5 ? 'Goldilocks, Reflation' : '';
        const ycContradicts = spread < 0 ? 'Goldilocks, Reflation' : spread > 0.5 ? 'Deflation / Contraction' : '';
        const ycAlignment = ycSupports.toLowerCase().includes(topSectorRegimeName.toLowerCase().split(' ')[0])
          ? 'supports' : ycContradicts.toLowerCase().includes(topSectorRegimeName.toLowerCase().split(' ')[0])
          ? 'contradicts' : 'neutral' as const;
        leadingIndicators.push({
          name: '10Y-2Y Spread',
          value: `${spread.toFixed(2)}%`,
          trend: spread > 0 ? 'up' : spread < 0 ? 'down' : 'flat',
          supports: ycSupports,
          contradicts: ycContradicts,
          signal: ycAlignment,
        });
      }
    }

    // Fed Funds Rate from dashboard
    if (fredDashboard) {
      const ffData = fredDashboard['FED_FUNDS'] || fredDashboard['fedFunds'];
      if (Array.isArray(ffData) && ffData.length > 0) {
        const latestFF = (ffData as Array<{ value: number }>)[ffData.length - 1].value;
        const prevFF = ffData.length > 3 ? (ffData as Array<{ value: number }>)[ffData.length - 4].value : latestFF;
        const ffTrend = latestFF > prevFF + 0.1 ? 'up' : latestFF < prevFF - 0.1 ? 'down' : 'flat' as const;
        const ffSupports = ffTrend === 'up' ? 'Reflation, Stagflation' : ffTrend === 'down' ? 'Goldilocks, Deflation / Contraction' : '';
        const ffContradicts = ffTrend === 'up' ? 'Goldilocks, Deflation / Contraction' : ffTrend === 'down' ? 'Reflation' : '';
        const ffAlignment = ffSupports.toLowerCase().includes(topSectorRegimeName.toLowerCase().split(' ')[0])
          ? 'supports' : ffContradicts.toLowerCase().includes(topSectorRegimeName.toLowerCase().split(' ')[0])
          ? 'contradicts' : 'neutral' as const;
        leadingIndicators.push({
          name: 'Fed Funds',
          value: `${latestFF.toFixed(2)}%`,
          trend: ffTrend,
          supports: ffSupports,
          contradicts: ffContradicts,
          signal: ffAlignment,
        });
      }
    }
  }

  // ─── SIGNAL CONFIDENCE SCORE ───
  const topRegime = regimeScores[0];
  const confidenceFactors = {
    timeframeAgreement,
    scoreAbove60: topRegime ? topRegime.score >= 60 : false,
    fullBreadth: topRegime ? topRegime.breadth === 1 : false,
    indicatorsSupport: leadingIndicators.filter((i) => i.signal === 'supports').length,
    indicatorsContradict: leadingIndicators.filter((i) => i.signal === 'contradicts').length,
    scoreSpread: topRegime && regimeScores[1] ? topRegime.score - regimeScores[1].score : 0,
  };
  const confidenceScore = (
    (confidenceFactors.timeframeAgreement ? 25 : 0) +
    (confidenceFactors.scoreAbove60 ? 20 : confidenceFactors.scoreSpread > 15 ? 10 : 0) +
    (confidenceFactors.fullBreadth ? 15 : 0) +
    (confidenceFactors.indicatorsSupport * 10) +
    (-confidenceFactors.indicatorsContradict * 10) +
    (confidenceFactors.scoreSpread > 20 ? 10 : confidenceFactors.scoreSpread > 10 ? 5 : 0)
  );
  const clampedConfidence = Math.max(0, Math.min(100, confidenceScore));
  const confidenceLabel = clampedConfidence >= 70 ? 'High' : clampedConfidence >= 40 ? 'Moderate' : 'Low';
  const confidenceColor = clampedConfidence >= 70 ? 'text-accent-green' : clampedConfidence >= 40 ? 'text-accent-orange' : 'text-accent-red';

  // Build normalized comparison chart data
  const chartSectors = sorted.slice(0, 5); // Top 5 sectors
  const normalizedData: Array<{ date: string; [key: string]: string | number }> = [];
  if (chartSectors.length > 0 && chartSectors[0].data.length > 0) {
    const periodDays = PERIOD_DAYS[selectedPeriod];
    const baseData = chartSectors.map((s) => {
      const startIdx = Math.max(0, s.data.length - periodDays - 1);
      return { symbol: s.symbol, sliced: s.data.slice(startIdx), base: s.data[startIdx]?.close || 1 };
    });

    const minLen = Math.min(...baseData.map((b) => b.sliced.length));
    for (let i = 0; i < minLen; i++) {
      const point: { date: string; [key: string]: string | number } = { date: baseData[0].sliced[i].date };
      for (const b of baseData) {
        point[b.symbol] = +((b.sliced[i].close / b.base) * 100).toFixed(2);
      }
      point['date'] = baseData[0].sliced[i].date;
      normalizedData.push(point);
    }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-black/85 tracking-tight">Sector Rotation</h2>
          <p className="text-sm text-black/45 mt-1">
            Performance heatmap across S&P 500 sectors via Polygon.io
          </p>
        </div>
        <div className="flex items-center gap-2">
          {allPeriods.map((p) => (
            <button
              key={p}
              onClick={() => setSelectedPeriod(p)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                selectedPeriod === p
                  ? 'bg-accent-blue text-white shadow-sm'
                  : 'text-black/45 hover:bg-black/[0.04]'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Rotation Signal */}
      <Card className="bg-gradient-to-r from-white/80 to-white/60">
        <div className="flex items-start gap-4">
          <div>
            <p className="text-xs font-medium text-black/45 uppercase tracking-wider mb-2">
              Sector Rotation Signal
            </p>
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-xl font-semibold text-black/85">{regimeHint.label}</h3>
              <Badge variant={regimeHint.badge}>{selectedPeriod} Leadership</Badge>
            </div>
            <p className="text-sm text-black/55 max-w-xl leading-relaxed">
              {regimeHint.text}
            </p>
          </div>
        </div>
        <div className="mt-4 pt-3 border-t border-black/[0.06]">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-black/35">Why this signal?</p>
            {formattedDataDate && (
              <span className="text-[10px] text-black/30 tabular-nums">
                Data through {formattedDataDate}
              </span>
            )}
          </div>
          <p className="text-xs text-black/50 leading-relaxed">
            {regimeHint.reasoning}
          </p>
        </div>
      </Card>

      {/* Heatmap Table */}
      <Card padding="none">
        <div className="px-6 pt-6 pb-3">
          <CardTitle>Performance Heatmap</CardTitle>
          <p className="text-xs text-black/40 mt-1">Returns across timeframes — sorted by {selectedPeriod}</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-black/[0.06]">
                <th className="px-4 py-3 text-left text-xs font-medium text-black/40 uppercase tracking-wider">Sector</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-black/40 uppercase tracking-wider">ETF</th>
                {allPeriods.map((p) => (
                  <th
                    key={p}
                    className={`px-4 py-3 text-center text-xs font-medium uppercase tracking-wider cursor-pointer transition-colors ${
                      selectedPeriod === p ? 'text-accent-blue' : 'text-black/40'
                    }`}
                    onClick={() => setSelectedPeriod(p)}
                  >
                    {p}
                  </th>
                ))}
                <th className="px-4 py-3 text-center text-xs font-medium text-black/40 uppercase tracking-wider">vs SPY</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((sector) => (
                <tr key={sector.symbol} className="border-b border-black/[0.03] hover:bg-black/[0.02] transition-colors">
                  <td className="px-4 py-3 text-sm text-black/75 font-medium">{sector.name}</td>
                  <td className="px-4 py-3">
                    <span className="text-sm font-semibold text-black/85">{sector.symbol}</span>
                  </td>
                  {allPeriods.map((p) => (
                    <td key={p} className="px-4 py-3 text-center">
                      <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-semibold tabular-nums ${heatColor(sector.returns[p])}`}>
                        {sector.returns[p] > 0 ? '+' : ''}{sector.returns[p].toFixed(1)}%
                      </span>
                    </td>
                  ))}
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-semibold tabular-nums ${
                      sector.returns[selectedPeriod] - spyReturns[selectedPeriod] > 0
                        ? 'text-accent-green'
                        : 'text-accent-red'
                    }`}>
                      {(sector.returns[selectedPeriod] - spyReturns[selectedPeriod]) > 0 ? '+' : ''}
                      {(sector.returns[selectedPeriod] - spyReturns[selectedPeriod]).toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
              {/* SPY Benchmark Row */}
              <tr className="border-t border-black/[0.08] bg-black/[0.02]">
                <td className="px-4 py-3 text-sm text-black/75 font-semibold">S&P 500</td>
                <td className="px-4 py-3">
                  <span className="text-sm font-semibold text-black/85">SPY</span>
                </td>
                {allPeriods.map((p) => (
                  <td key={p} className="px-4 py-3 text-center">
                    <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-semibold tabular-nums ${heatColor(spyReturns[p])}`}>
                      {spyReturns[p] > 0 ? '+' : ''}{spyReturns[p].toFixed(1)}%
                    </span>
                  </td>
                ))}
                <td className="px-4 py-3 text-center text-xs text-black/35">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Top 5 Normalized Chart */}
      {normalizedData.length > 0 && (
        <Card>
          <CardTitle>Top 5 Sectors — Indexed Performance ({selectedPeriod})</CardTitle>
          <p className="text-xs text-black/40 mt-1 mb-4">Normalized to 100 at start of period</p>
          <MultiSeriesChart
            data={normalizedData}
            series={chartSectors.map((s) => ({
              key: s.symbol,
              color: s.color,
              name: `${s.symbol} (${s.name})`,
            }))}
            height={350}
          />
        </Card>
      )}

      {/* Regime Cross-Reference: FRED vs Sector Signals */}
      {fredRegime && fredRegime.regime !== 'unknown' && regimeScores.length > 0 && (() => {
        const fredRegimeName = fredRegime.regime === 'deflation' ? 'Deflation / Contraction' : fredRegime.label;
        const topSectorRegime = regimeScores[0];
        const fredMatchScore = regimeScores.find((r) =>
          r.name.toLowerCase().includes(fredRegime.regime)
        );
        const isAligned = topSectorRegime.name === fredRegimeName ||
          topSectorRegime.name.toLowerCase().includes(fredRegime.regime);
        const fredRank = fredMatchScore
          ? regimeScores.indexOf(fredMatchScore) + 1
          : null;

        return (
          <Card className={`border ${isAligned ? 'border-accent-green/20 bg-accent-green/[0.02]' : 'border-accent-orange/20 bg-accent-orange/[0.02]'}`}>
            <div className="flex items-center gap-2 mb-1">
              <CardTitle>Regime Cross-Reference</CardTitle>
              <Badge variant={isAligned ? 'green' : 'orange'}>
                {isAligned ? 'Aligned' : 'Diverging'}
              </Badge>
            </div>
            <p className="text-xs text-black/40 mb-4">
              Comparing FRED economic data (backward-looking) with sector rotation signals (forward-looking)
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              {/* FRED Regime */}
              <div className="border border-black/[0.06] rounded-xl p-4 bg-white/60">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-black/35 mb-2">
                  Economic Data (FRED)
                </p>
                <div className="flex items-center gap-2 mb-2">
                  <RegimeBadge regime={fredRegime.regime} />
                </div>
                <p className="text-xs text-black/55 mb-2">{fredRegime.description}</p>
                <div className="flex gap-3 text-[11px] text-black/45">
                  <span>CPI YoY: <span className="font-semibold text-black/70">{fredRegime.latestInflation.toFixed(1)}%</span></span>
                  <span>Unemployment: <span className="font-semibold text-black/70">{fredRegime.latestUnemployment.toFixed(1)}%</span></span>
                </div>
                <div className="flex gap-3 mt-1 text-[11px] text-black/40">
                  <span>Inflation: {fredRegime.inflationTrend}</span>
                  <span>Growth: {fredRegime.growthTrend}</span>
                </div>
              </div>

              {/* Top Sector Regime */}
              <div className="border border-black/[0.06] rounded-xl p-4 bg-white/60">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-black/35 mb-2">
                  Market Pricing (Sectors, {selectedPeriod})
                </p>
                <div className="flex items-center gap-2 mb-2">
                  <Badge variant={topSectorRegime.badge} size="md">{topSectorRegime.name}</Badge>
                  <span className="text-lg font-bold tabular-nums text-black/70">{topSectorRegime.score}</span>
                </div>
                <p className="text-xs text-black/55 mb-2">{topSectorRegime.description}</p>
                <div className="flex gap-2">
                  {topSectorRegime.leaders.map((sym, i) => (
                    <span key={sym} className={`text-[10px] font-semibold px-2 py-0.5 rounded-md tabular-nums ${
                      topSectorRegime.leaderExcess[i] > 0
                        ? 'bg-accent-green/10 text-green-700'
                        : 'bg-accent-red/10 text-red-700'
                    }`}>
                      {sym} {topSectorRegime.leaderExcess[i] > 0 ? '+' : ''}{topSectorRegime.leaderExcess[i].toFixed(1)}%
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Interpretation */}
            <div className={`rounded-lg p-3 ${isAligned ? 'bg-accent-green/[0.05]' : 'bg-accent-orange/[0.05]'}`}>
              <p className="text-xs text-black/65 leading-relaxed">
                {isAligned ? (
                  <>
                    <span className="font-semibold">Consensus:</span> Both economic fundamentals and market sector rotation point to a{' '}
                    <span className="font-semibold">{fredRegime.label}</span> environment. FRED data and market positioning are in agreement
                    — the macro picture is consistent.
                  </>
                ) : (
                  <>
                    <span className="font-semibold">Divergence:</span> FRED economic data indicates{' '}
                    <span className="font-semibold">{fredRegime.label}</span>
                    {fredRank && <> (ranked #{fredRank} by sector fit)</>},
                    but sector rotation is pricing in{' '}
                    <span className="font-semibold">{topSectorRegime.name}</span> (score: {topSectorRegime.score}).
                    Markets often lead economic data — this divergence may signal a regime transition.
                    Monitor whether sector signals are front-running a shift or if fundamentals will reassert.
                  </>
                )}
              </p>
            </div>
          </Card>
        );
      })()}

      {/* Regime Fit Scores */}
      <Card>
        <CardTitle>Sector Rotation & Macro Regimes — Fit Scores</CardTitle>
        <p className="text-xs text-black/45 mt-1 mb-2">
          How well current sector leadership matches each macro regime ({selectedPeriod} data)
        </p>
        <p className="text-xs text-black/35 mb-4">
          Score = 0-100 based on whether a regime&apos;s expected leader sectors are outperforming SPY. Higher score = stronger match to that regime&apos;s signature.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {regimeScores.map((regime) => (
            <div key={regime.name} className={`border ${regime.border} rounded-xl p-4 ${regime.bg}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Badge variant={regime.badge}>{regime.name}</Badge>
                  {regime.score === Math.max(...regimeScores.map((r) => r.score)) && regime.score > 50 && (
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-black/40">Best Fit</span>
                  )}
                </div>
                <span className={`text-2xl font-bold tabular-nums ${
                  regime.score >= 60 ? 'text-black/85' : regime.score >= 35 ? 'text-black/55' : 'text-black/30'
                }`}>
                  {regime.score}
                </span>
              </div>

              {/* Score bar */}
              <div className="relative h-2 bg-black/[0.06] rounded-full mb-3 overflow-hidden">
                <div
                  className={`absolute inset-y-0 left-0 rounded-full transition-all ${regime.barColor}`}
                  style={{ width: `${regime.score}%`, opacity: 0.6 }}
                />
              </div>

              <p className="text-xs text-black/55 mb-2">{regime.description}</p>
              <p className="text-xs text-black/75 font-medium mb-2">Leaders: {regime.leaderLabel}</p>

              {/* Leader breakdown */}
              <div className="flex gap-2 mb-3">
                {regime.leaders.map((sym, i) => {
                  const excess = regime.leaderExcess[i];
                  return (
                    <span
                      key={sym}
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-md tabular-nums ${
                        excess > 2 ? 'bg-accent-green/15 text-green-700' :
                        excess > 0 ? 'bg-accent-green/[0.06] text-green-600' :
                        excess > -2 ? 'bg-accent-red/[0.06] text-red-600' :
                        'bg-accent-red/15 text-red-700'
                      }`}
                    >
                      {sym} {excess > 0 ? '+' : ''}{excess.toFixed(1)}%
                    </span>
                  );
                })}
              </div>

              {/* Interpretation */}
              <p className="text-xs text-black/50 leading-relaxed italic">
                {regime.interpretation}
              </p>

              {/* Portfolio Positioning */}
              {regime.score >= 35 && (
                <div className="mt-3 pt-3 border-t border-black/[0.06]">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-black/35 mb-2">
                    Portfolio Positioning
                  </p>
                  <div className="space-y-1.5">
                    <p className="text-[11px] text-black/60">
                      <span className="font-semibold text-accent-green">Overweight:</span>{' '}
                      {regime.positioning.overweight}
                    </p>
                    <p className="text-[11px] text-black/60">
                      <span className="font-semibold text-accent-red">Underweight:</span>{' '}
                      {regime.positioning.underweight}
                    </p>
                    <p className="text-[11px] text-black/60">
                      <span className="font-semibold text-accent-blue">Fixed Income:</span>{' '}
                      {regime.positioning.fixedIncome}
                    </p>
                    <p className="text-[11px] text-black/60">
                      <span className="font-semibold text-accent-purple">Alternatives:</span>{' '}
                      {regime.positioning.alternatives}
                    </p>
                  </div>
                  <p className="text-[11px] text-black/45 mt-2 leading-relaxed italic">
                    {regime.positioning.rationale}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {/* Regime Transition Monitoring Dashboard */}
      <Card>
        <div className="flex items-center justify-between mb-1">
          <CardTitle>How to Monitor Regime Transitions</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-black/35 uppercase tracking-wider">Signal Confidence</span>
            <span className={`text-lg font-bold tabular-nums ${confidenceColor}`}>{clampedConfidence}</span>
            <Badge variant={clampedConfidence >= 70 ? 'green' : clampedConfidence >= 40 ? 'orange' : 'red'}>
              {confidenceLabel}
            </Badge>
          </div>
        </div>
        <p className="text-xs text-black/40 mb-4">
          Live data comparing sector signals against economic fundamentals to detect regime transitions
        </p>

        <div className="space-y-4">
          {/* Step 1: Cross-Timeframe Regime Scores — horizontal grouped bars */}
          <div className="border border-black/[0.06] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-accent-blue bg-accent-blue/10 w-6 h-6 rounded-full flex items-center justify-center">1</span>
              <p className="text-sm font-semibold text-black/75">Cross-Timeframe Regime Scores</p>
              <Badge variant={timeframeAgreement ? 'green' : 'orange'}>
                {timeframeAgreement ? 'Aligned' : 'Diverging'}
              </Badge>
            </div>
            <p className="text-xs text-black/50 mb-3">
              Each regime&apos;s fit score across all timeframes. Consistent scores = durable signal. Divergence between 1W and 3M = possible transition.
            </p>

            {/* Horizontal bar chart for each regime across timeframes */}
            <div className="space-y-3">
              {regimeNames.map((name) => (
                <div key={name}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] font-semibold text-black/60 w-36 shrink-0">{name}</span>
                    <div className="flex items-center gap-1 text-[10px] text-black/35">
                      {name === topRegimeByPeriod[selectedPeriod] && (
                        <span className="font-semibold text-black/50">Current Top</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {(['1W', '1M', '3M', '6M', '1Y'] as HeatmapPeriod[]).map((p) => {
                      const score = crossTimeframeScores[name][p];
                      const isTop = topRegimeByPeriod[p] === name;
                      return (
                        <div key={p} className="flex-1">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className={`text-[9px] ${p === selectedPeriod ? 'font-bold text-accent-blue' : 'text-black/30'}`}>{p}</span>
                            <span className={`text-[10px] tabular-nums font-semibold ${isTop ? 'text-black/75' : 'text-black/35'}`}>{score}</span>
                          </div>
                          <div className="h-2 bg-black/[0.04] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{
                                width: `${score}%`,
                                backgroundColor: REGIME_COLORS[name],
                                opacity: isTop ? 0.8 : 0.35,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Winner row */}
            <div className="mt-3 pt-3 border-t border-black/[0.06]">
              <div className="flex items-center gap-1">
                <span className="text-[10px] font-semibold text-black/35 uppercase tracking-wider mr-2">Top regime:</span>
                {(['1W', '1M', '3M', '6M', '1Y'] as HeatmapPeriod[]).map((p) => (
                  <div key={p} className="flex-1 text-center">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                      p === selectedPeriod ? 'bg-accent-blue/10 text-accent-blue' : 'text-black/40'
                    }`}>
                      {topRegimeByPeriod[p].split(' ')[0]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Step 2: Rolling Regime Score History — multi-line chart */}
          <div className="border border-black/[0.06] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-accent-blue bg-accent-blue/10 w-6 h-6 rounded-full flex items-center justify-center">2</span>
              <p className="text-sm font-semibold text-black/75">Regime Score History (Rolling 30-Day)</p>
            </div>
            <p className="text-xs text-black/50 mb-3">
              How each regime&apos;s score has evolved over the past ~90 trading days. Rising lines = strengthening signal. Crossovers = regime transition in progress.
            </p>

            {rollingRegimeData.length > 3 ? (
              <MultiSeriesChart
                data={rollingRegimeData}
                series={regimeNames.map((name) => ({
                  key: name,
                  color: REGIME_COLORS[name],
                  name,
                }))}
                height={220}
              />
            ) : (
              <div className="flex items-center justify-center h-[220px] text-black/25 text-sm">
                Insufficient data for rolling history
              </div>
            )}

            {/* Legend */}
            <div className="flex items-center gap-4 mt-2 justify-center">
              {regimeNames.map((name) => (
                <div key={name} className="flex items-center gap-1.5">
                  <div className="w-3 h-[3px] rounded-full" style={{ backgroundColor: REGIME_COLORS[name] }} />
                  <span className="text-[10px] text-black/45">{name.split(' ')[0]}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Step 3: Leading Indicator Validation */}
          <div className="border border-black/[0.06] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-accent-blue bg-accent-blue/10 w-6 h-6 rounded-full flex items-center justify-center">3</span>
              <p className="text-sm font-semibold text-black/75">Leading Indicator Validation</p>
            </div>
            <p className="text-xs text-black/50 mb-3">
              Do economic fundamentals support or contradict the top sector regime signal ({regimeScores[0]?.name || 'N/A'})?
            </p>

            {leadingIndicators.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {leadingIndicators.map((ind) => (
                  <div key={ind.name} className={`border rounded-lg p-3 ${
                    ind.signal === 'supports' ? 'border-accent-green/15 bg-accent-green/[0.02]' :
                    ind.signal === 'contradicts' ? 'border-accent-red/15 bg-accent-red/[0.02]' :
                    'border-black/[0.06] bg-black/[0.01]'
                  }`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[11px] font-semibold text-black/60">{ind.name}</span>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold tabular-nums text-black/75">{ind.value}</span>
                        <span className={`text-xs ${
                          ind.trend === 'up' ? 'text-accent-red' : ind.trend === 'down' ? 'text-accent-green' : 'text-black/30'
                        }`}>
                          {ind.trend === 'up' ? '\u2191' : ind.trend === 'down' ? '\u2193' : '\u2192'}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                        ind.signal === 'supports' ? 'bg-accent-green/10 text-accent-green' :
                        ind.signal === 'contradicts' ? 'bg-accent-red/10 text-accent-red' :
                        'bg-black/[0.04] text-black/40'
                      }`}>
                        {ind.signal === 'supports' ? 'Supports' : ind.signal === 'contradicts' ? 'Contradicts' : 'Neutral'}
                      </span>
                      <span className="text-[10px] text-black/35">
                        {ind.signal === 'supports' && ind.supports ? `Favors: ${ind.supports}` : ''}
                        {ind.signal === 'contradicts' && ind.contradicts ? `Favors: ${ind.contradicts}` : ''}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-black/30 italic">Loading economic indicators...</div>
            )}

            <div className="mt-3 bg-black/[0.02] rounded-lg p-2.5">
              <p className="text-[11px] text-black/50 italic">
                {(() => {
                  const sup = leadingIndicators.filter((i) => i.signal === 'supports').length;
                  const con = leadingIndicators.filter((i) => i.signal === 'contradicts').length;
                  if (sup > con) return `${sup} of ${leadingIndicators.length} indicators support the sector signal. Fundamentals are confirming the market\u2019s read.`;
                  if (con > sup) return `${con} of ${leadingIndicators.length} indicators contradict the sector signal. The market may be front-running a shift that hasn\u2019t materialized in data yet \u2014 or it may reverse.`;
                  return 'Indicators are mixed \u2014 no clear confirmation or contradiction. Wait for more data before committing to the sector signal.';
                })()}
              </p>
            </div>
          </div>

          {/* Step 4: Signal Confidence Breakdown */}
          <div className="border border-black/[0.06] rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-bold text-accent-blue bg-accent-blue/10 w-6 h-6 rounded-full flex items-center justify-center">4</span>
              <p className="text-sm font-semibold text-black/75">Signal Confidence Breakdown</p>
            </div>
            <p className="text-xs text-black/50 mb-3">
              Automated checklist scoring whether the current sector signal is actionable or requires more confirmation.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                {
                  label: 'Timeframe agreement (1W + 1M + 3M)',
                  pass: confidenceFactors.timeframeAgreement,
                  detail: confidenceFactors.timeframeAgreement
                    ? `All three point to ${topRegimeByPeriod['1W'].split(' ')[0]}`
                    : `1W: ${topRegimeByPeriod['1W'].split(' ')[0]}, 1M: ${topRegimeByPeriod['1M'].split(' ')[0]}, 3M: ${topRegimeByPeriod['3M'].split(' ')[0]}`,
                  weight: '+25',
                },
                {
                  label: 'Top score above 60',
                  pass: confidenceFactors.scoreAbove60,
                  detail: `Top score: ${topRegime?.score || 0}`,
                  weight: '+20',
                },
                {
                  label: 'Full breadth (all leaders outperforming)',
                  pass: confidenceFactors.fullBreadth,
                  detail: `${Math.round((topRegime?.breadth || 0) * 100)}% of leaders outperforming SPY`,
                  weight: '+15',
                },
                {
                  label: 'Leading indicators support signal',
                  pass: confidenceFactors.indicatorsSupport > confidenceFactors.indicatorsContradict,
                  detail: `${confidenceFactors.indicatorsSupport} support, ${confidenceFactors.indicatorsContradict} contradict`,
                  weight: '+10 ea',
                },
                {
                  label: 'Clear separation from #2 regime',
                  pass: confidenceFactors.scoreSpread > 10,
                  detail: `Spread: ${confidenceFactors.scoreSpread} pts (#1 vs #2)`,
                  weight: '+10',
                },
              ].map((item) => (
                <div key={item.label} className={`flex items-start gap-2 p-2.5 rounded-lg ${
                  item.pass ? 'bg-accent-green/[0.04]' : 'bg-black/[0.02]'
                }`}>
                  <span className={`text-sm mt-0.5 ${item.pass ? 'text-accent-green' : 'text-black/20'}`}>
                    {item.pass ? '\u2713' : '\u2717'}
                  </span>
                  <div>
                    <p className={`text-[11px] font-semibold ${item.pass ? 'text-black/70' : 'text-black/40'}`}>
                      {item.label} <span className="text-black/25 font-normal">({item.weight})</span>
                    </p>
                    <p className="text-[10px] text-black/40">{item.detail}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className={`mt-3 rounded-lg p-3 ${
              clampedConfidence >= 70 ? 'bg-accent-green/[0.05] border border-accent-green/10' :
              clampedConfidence >= 40 ? 'bg-accent-orange/[0.05] border border-accent-orange/10' :
              'bg-accent-red/[0.05] border border-accent-red/10'
            }`}>
              <p className="text-xs text-black/60 leading-relaxed">
                {clampedConfidence >= 70 ? (
                  <>
                    <span className="font-semibold text-accent-green">High confidence.</span> Multiple timeframes agree, leading indicators confirm, and the signal
                    has strong breadth. This is actionable — consider positioning toward the {topRegime?.name} playbook above.
                  </>
                ) : clampedConfidence >= 40 ? (
                  <>
                    <span className="font-semibold text-accent-orange">Moderate confidence.</span> Some factors support the signal but others are mixed.
                    Consider a partial tilt toward {topRegime?.name} positioning, but don&apos;t fully rotate until more factors align. Re-check in 1-2 weeks.
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-accent-red">Low confidence.</span> Signals are conflicting — timeframes disagree, indicators contradict,
                    or regime scores are clustered. The market hasn&apos;t committed to a direction. Hold current positioning and wait for clearer signals before acting.
                  </>
                )}
              </p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
