'use client';

import { useState, useMemo } from 'react';
import { Card, CardTitle, MetricCard } from '@/components/ui/Card';
import { LoadingPage } from '@/components/ui/Loading';
import { Badge } from '@/components/ui/Badge';
import { TimeSeriesChart, MultiSeriesChart } from '@/components/charts/TimeSeriesChart';
import { useMultiAggregates, useApi } from '@/lib/hooks';
import { HOLDINGS } from '@/lib/holdings';

type AnalyticsPeriod = '1M' | '3M' | '6M' | '1Y';

const PERIOD_DAYS: Record<AnalyticsPeriod, number> = {
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
};

// Get non-BTC, non-cash-like holdings
const EQUITY_HOLDINGS = HOLDINGS.filter((h) => h.symbol !== 'BTC' && h.symbol !== 'SGOV');

// ─── Math utilities ───

function computeReturns(closes: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  return returns;
}

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const aSlice = a.slice(-n);
  const bSlice = b.slice(-n);
  const ma = mean(aSlice);
  const mb = mean(bSlice);
  const sa = stdDev(aSlice);
  const sb = stdDev(bSlice);
  if (sa === 0 || sb === 0) return 0;
  let cov = 0;
  for (let i = 0; i < n; i++) {
    cov += (aSlice[i] - ma) * (bSlice[i] - mb);
  }
  cov /= n - 1;
  return cov / (sa * sb);
}

function corrColor(r: number): string {
  if (r > 0.7) return 'bg-accent-red/20 text-red-800';
  if (r > 0.4) return 'bg-accent-orange/15 text-orange-700';
  if (r > 0.1) return 'bg-accent-orange/[0.06] text-orange-600';
  if (r > -0.1) return 'bg-black/[0.04] text-black/55';
  if (r > -0.4) return 'bg-accent-blue/[0.06] text-blue-600';
  if (r > -0.7) return 'bg-accent-blue/15 text-blue-700';
  return 'bg-accent-blue/25 text-blue-800';
}

// ─── Bottom Timing Score ───
interface BottomScoreBreakdown {
  total: number;
  drawdownPts: number;
  volSpikePts: number;
  volumePts: number;
  vixPts: number;
  hySpreadPts: number;
  pricePositionPts: number;
  volMeanReversionPts: number;
  grade: 'Extreme Capitulation' | 'Heavy Selling' | 'Moderate Distress' | 'Mild Weakness' | 'No Signal';
  gradeColor: string;
}

function computeBottomScore(
  stock: {
    drawdown: number;
    volPercentile: number;
    pricePosition: number;
    currentVol: number;
    medianVol: number;
  },
  volumes: number[],
  vixLevel: number | null,
  hySpread: number | null,
  allRollingVols: number[],
): BottomScoreBreakdown {
  // 1. Drawdown severity (0-20)
  const dd = Math.abs(stock.drawdown);
  const drawdownPts = dd > 30 ? 20 : dd > 25 ? 17 : dd > 20 ? 14 : dd > 15 ? 10 : dd > 10 ? 5 : 0;

  // 2. Volatility spike (0-15)
  const vp = stock.volPercentile;
  const volSpikePts = vp > 0.95 ? 15 : vp > 0.90 ? 12 : vp > 0.75 ? 8 : vp > 0.60 ? 4 : 0;

  // 3. Volume capitulation (0-15) — recent max volume vs average
  let volumePts = 0;
  if (volumes.length >= 20) {
    const avgVol = volumes.slice(0, -5).reduce((a, b) => a + b, 0) / (volumes.length - 5);
    const recentMax = Math.max(...volumes.slice(-5));
    const volRatio = avgVol > 0 ? recentMax / avgVol : 0;
    volumePts = volRatio > 3 ? 15 : volRatio > 2 ? 10 : volRatio > 1.5 ? 5 : 0;
  }

  // 4. VIX level (0-15)
  let vixPts = 0;
  if (vixLevel !== null) {
    vixPts = vixLevel > 40 ? 15 : vixLevel > 30 ? 12 : vixLevel > 25 ? 8 : vixLevel > 20 ? 4 : 0;
  }

  // 5. HY spread (0-10)
  let hySpreadPts = 0;
  if (hySpread !== null) {
    hySpreadPts = hySpread > 8 ? 10 : hySpread > 6 ? 7 : hySpread > 5 ? 5 : hySpread > 4 ? 3 : 0;
  }

  // 6. Price position (0-10)
  const pp = stock.pricePosition;
  const pricePositionPts = pp < 0.10 ? 10 : pp < 0.20 ? 7 : pp < 0.30 ? 4 : 0;

  // 7. Volatility mean reversion signal (0-15)
  let volMeanReversionPts = 0;
  if (allRollingVols.length >= 3) {
    const recent3 = allRollingVols.slice(-3);
    const peak = Math.max(...allRollingVols.slice(-10));
    const current = allRollingVols[allRollingVols.length - 1];
    const isPastPeak = peak > current && (peak - current) / peak > 0.10;
    if (isPastPeak && stock.volPercentile > 0.60) {
      volMeanReversionPts = 15; // Vol peaked and declining from elevated levels
    } else if (stock.volPercentile > 0.90) {
      volMeanReversionPts = 8; // At extreme but hasn't peaked yet
    } else if (recent3[2] < recent3[1] && stock.volPercentile > 0.50) {
      volMeanReversionPts = 5; // Starting to decline
    }
  }

  const total = drawdownPts + volSpikePts + volumePts + vixPts + hySpreadPts + pricePositionPts + volMeanReversionPts;

  let grade: BottomScoreBreakdown['grade'];
  let gradeColor: string;
  if (total >= 75) {
    grade = 'Extreme Capitulation';
    gradeColor = 'bg-accent-red/15 text-red-700 border-accent-red/20';
  } else if (total >= 55) {
    grade = 'Heavy Selling';
    gradeColor = 'bg-accent-orange/15 text-orange-700 border-accent-orange/20';
  } else if (total >= 35) {
    grade = 'Moderate Distress';
    gradeColor = 'bg-accent-blue/15 text-blue-700 border-accent-blue/20';
  } else if (total >= 20) {
    grade = 'Mild Weakness';
    gradeColor = 'bg-black/[0.06] text-black/65 border-black/[0.08]';
  } else {
    grade = 'No Signal';
    gradeColor = 'bg-black/[0.04] text-black/45 border-black/[0.06]';
  }

  return { total, drawdownPts, volSpikePts, volumePts, vixPts, hySpreadPts, pricePositionPts, volMeanReversionPts, grade, gradeColor };
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<AnalyticsPeriod>('3M');

  const fromDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 370); // Always fetch 1Y, slice for shorter
    return d.toISOString().split('T')[0];
  }, []);

  const allSymbols = useMemo(() => {
    const syms = EQUITY_HOLDINGS.map((h) => h.symbol);
    if (!syms.includes('SPY')) syms.push('SPY');
    return syms;
  }, []);

  const { data: aggData, loading } = useMultiAggregates(allSymbols, '1day', fromDate);

  // Fetch macro context for bottom scoring
  const { data: macroData } = useApi<{
    vix: Array<{ date: string; value: number }>;
    highYieldSpread: Array<{ date: string; value: number }>;
  }>('/api/fred?action=dashboard');

  if (loading) return <LoadingPage />;

  const days = PERIOD_DAYS[period];

  // We always fetch ~1Y of daily bars, then slice by actual calendar date so each
  // period reflects the true trailing window. Slicing by bar count (e.g. last 90
  // bars for "3M") is wrong because bars are trading days, not calendar days —
  // 90 trading days is ~4.3 months, which made the periods inaccurate.
  const periodCutoff = (() => {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString().split('T')[0];
  })();

  // Get sliced close prices for each symbol
  const symbolData: Record<string, { closes: number[]; dates: string[] }> = {};
  for (const sym of allSymbols) {
    const series = aggData?.find((s) => s.symbol === sym)?.data || [];
    const sliced = series.filter((d) => d.date >= periodCutoff);
    symbolData[sym] = {
      closes: sliced.map((d) => d.close),
      dates: sliced.map((d) => d.date),
    };
  }

  const spyCloses = symbolData['SPY']?.closes || [];
  const spyReturns = computeReturns(spyCloses);

  // ─── RELATIVE STRENGTH ───
  const relativeStrength = EQUITY_HOLDINGS.map((h) => {
    const closes = symbolData[h.symbol]?.closes || [];
    if (closes.length < 2 || spyCloses.length < 2) {
      return { symbol: h.symbol, category: h.category, holdingReturn: 0, spyReturn: 0, relStrength: 0 };
    }
    const holdingReturn = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;
    const spyReturn = ((spyCloses[spyCloses.length - 1] - spyCloses[0]) / spyCloses[0]) * 100;
    return {
      symbol: h.symbol,
      category: h.category,
      holdingReturn,
      spyReturn,
      relStrength: holdingReturn - spyReturn,
    };
  }).sort((a, b) => b.relStrength - a.relStrength);

  // ─── CORRELATION MATRIX ───
  const corrSymbols = EQUITY_HOLDINGS.map((h) => h.symbol);
  const dailyReturns: Record<string, number[]> = {};
  for (const sym of corrSymbols) {
    dailyReturns[sym] = computeReturns(symbolData[sym]?.closes || []);
  }
  // Also include SPY
  dailyReturns['SPY'] = spyReturns;
  const corrMatrixSymbols = [...corrSymbols, 'SPY'];

  const corrMatrix: number[][] = corrMatrixSymbols.map((a) =>
    corrMatrixSymbols.map((b) => correlation(dailyReturns[a] || [], dailyReturns[b] || []))
  );

  // ─── VOLATILITY ───
  const volatility = EQUITY_HOLDINGS.map((h) => {
    const returns = computeReturns(symbolData[h.symbol]?.closes || []);
    const dailyVol = stdDev(returns);
    const annualized = dailyVol * Math.sqrt(252) * 100;

    // Rolling 20-day volatility for chart
    const closes = symbolData[h.symbol]?.closes || [];
    const dates = symbolData[h.symbol]?.dates || [];
    const rollingVol: Array<{ date: string; value: number }> = [];
    for (let i = 20; i < closes.length; i++) {
      const window = computeReturns(closes.slice(i - 20, i + 1));
      rollingVol.push({
        date: dates[i],
        value: stdDev(window) * Math.sqrt(252) * 100,
      });
    }

    return { symbol: h.symbol, category: h.category, annualized, rollingVol };
  }).sort((a, b) => b.annualized - a.annualized);

  const spyDailyVol = stdDev(spyReturns);
  const spyAnnualizedVol = spyDailyVol * Math.sqrt(252) * 100;

  // ─── VOLATILITY SIGNALS ───
  // For each holding: compare current 20-day vol to its historical median,
  // and check price position relative to the period high/low.
  const volSignals = EQUITY_HOLDINGS.map((h) => {
    const closes = symbolData[h.symbol]?.closes || [];
    if (closes.length < 30) return null;

    // Current rolling 20-day vol
    const recentReturns = computeReturns(closes.slice(-21));
    const currentVol = stdDev(recentReturns) * Math.sqrt(252) * 100;

    // Historical median rolling vol (all 20-day windows)
    const allRollingVols: number[] = [];
    for (let i = 20; i < closes.length; i++) {
      const w = computeReturns(closes.slice(i - 20, i + 1));
      allRollingVols.push(stdDev(w) * Math.sqrt(252) * 100);
    }
    allRollingVols.sort((a, b) => a - b);
    const medianVol = allRollingVols[Math.floor(allRollingVols.length / 2)] || currentVol;
    const volPercentile = allRollingVols.filter((v) => v <= currentVol).length / (allRollingVols.length || 1);

    // Price position: how far is current price from period high/low?
    const periodHigh = Math.max(...closes);
    const periodLow = Math.min(...closes);
    const currentPrice = closes[closes.length - 1];
    const range = periodHigh - periodLow;
    const pricePosition = range > 0 ? (currentPrice - periodLow) / range : 0.5; // 0 = at low, 1 = at high

    // Price momentum: 20-day return
    const momentum20d = closes.length >= 21
      ? ((closes[closes.length - 1] - closes[closes.length - 21]) / closes[closes.length - 21]) * 100
      : 0;

    // Drawdown from period high
    const drawdown = ((currentPrice - periodHigh) / periodHigh) * 100;

    return {
      symbol: h.symbol,
      category: h.category,
      currentVol,
      medianVol,
      volPercentile,
      pricePosition,
      momentum20d,
      drawdown,
      currentPrice,
    };
  }).filter(Boolean) as Array<{
    symbol: string;
    category: string;
    currentVol: number;
    medianVol: number;
    volPercentile: number;
    pricePosition: number;
    momentum20d: number;
    drawdown: number;
    currentPrice: number;
  }>;

  // Generate signal for each holding
  const getVolSignal = (s: typeof volSignals[0]) => {
    const volExpanded = s.volPercentile > 0.75; // Vol is in the top 25% historically
    const volContracted = s.volPercentile < 0.25; // Vol is in the bottom 25%
    const nearLow = s.pricePosition < 0.25; // Price near period low
    const nearHigh = s.pricePosition > 0.85; // Price near period high
    const strongMomentum = s.momentum20d > 5;
    const deepDrawdown = s.drawdown < -15;

    // High vol + price near lows = potential accumulation zone
    if (volExpanded && nearLow) {
      return {
        signal: 'Potential Buy Zone' as const,
        badge: 'green' as const,
        reason: `Volatility is elevated (${s.currentVol.toFixed(0)}% vs median ${s.medianVol.toFixed(0)}%) while price sits near period lows (${s.drawdown.toFixed(1)}% from high). Historically, high fear + depressed prices create opportunities for patient buyers. Consider scaling in if your thesis is intact.`,
      };
    }

    // Deep drawdown with expanding vol = possible capitulation
    if (deepDrawdown && volExpanded) {
      return {
        signal: 'Capitulation Watch' as const,
        badge: 'blue' as const,
        reason: `Down ${Math.abs(s.drawdown).toFixed(1)}% from period high with spiking volatility (${s.volPercentile > 0.9 ? 'top 10%' : 'top 25%'} of its historical range). Capitulation selling can mark bottoms, but wait for vol to peak and start declining before adding. Catching a falling knife is risky.`,
      };
    }

    // Low vol + near highs + strong momentum = ride the trend but tighten stops
    if (volContracted && nearHigh && strongMomentum) {
      return {
        signal: 'Trim / Tighten Stops' as const,
        badge: 'orange' as const,
        reason: `Price is near period highs with unusually low volatility (bottom 25% historically). Low-vol rallies can persist, but compressed vol often precedes a sharp move. Consider taking partial profits or tightening stop-losses to protect gains.`,
      };
    }

    // High vol + near highs = potential distribution
    if (volExpanded && nearHigh) {
      return {
        signal: 'Caution — Elevated Risk' as const,
        badge: 'red' as const,
        reason: `Price is near highs but volatility is expanding (${s.currentVol.toFixed(0)}% annualized, above median). This pattern can indicate distribution — smart money selling into strength. Watch for failed breakouts or reversal patterns before adding.`,
      };
    }

    // Low vol + near lows = coiling for a move
    if (volContracted && nearLow) {
      return {
        signal: 'Coiling — Watch for Breakout' as const,
        badge: 'blue' as const,
        reason: `Volatility is compressed (bottom 25%) while price is near period lows. This "coiling" pattern often precedes a significant directional move. Wait for a clear breakout with volume confirmation before entering. Could break either direction.`,
      };
    }

    // Neutral
    return {
      signal: 'Neutral' as const,
      badge: 'neutral' as const,
      reason: `Volatility is near its historical median (${s.currentVol.toFixed(0)}% vs ${s.medianVol.toFixed(0)}% median) with no extreme price positioning. No strong buy/sell signal from vol alone. Use fundamental analysis and macro context to guide decisions.`,
    };
  };

  // Relative strength chart — normalized to 100
  const topOutperformers = relativeStrength.slice(0, 3);
  const rsChartData: Array<{ date: string; [key: string]: string | number }> = [];
  if (topOutperformers.length > 0) {
    const symsForChart = [...topOutperformers.map((r) => r.symbol), 'SPY'];
    const bases: Record<string, number> = {};
    for (const sym of symsForChart) {
      const c = symbolData[sym]?.closes || [];
      bases[sym] = c.length > 0 ? c[0] : 1;
    }
    const minLen = Math.min(...symsForChart.map((s) => symbolData[s]?.closes?.length || 0));
    for (let i = 0; i < minLen; i++) {
      const point: { date: string; [key: string]: string | number } = { date: symbolData['SPY']?.dates[i] || '' };
      for (const sym of symsForChart) {
        point[sym] = +((((symbolData[sym]?.closes || [])[i] || 0) / bases[sym]) * 100).toFixed(2);
      }
      rsChartData.push(point);
    }
  }

  const allPeriods: AnalyticsPeriod[] = ['1M', '3M', '6M', '1Y'];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-black/85 tracking-tight">Portfolio Analytics</h2>
          <p className="text-sm text-black/45 mt-1">
            Relative strength, correlations, and volatility via Polygon.io
          </p>
        </div>
        <div className="flex items-center gap-2">
          {allPeriods.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                period === p
                  ? 'bg-accent-blue text-white shadow-sm'
                  : 'text-black/45 hover:bg-black/[0.04]'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* ─── RELATIVE STRENGTH vs BENCHMARK ─── */}
      <div>
        <h3 className="text-lg font-semibold text-black/75 tracking-tight mb-1">Relative Strength vs SPY</h3>
        <p className="text-xs text-black/40 mb-4">Holdings ranked by excess return over the S&P 500</p>
      </div>

      <Card padding="none">
        <div className="px-6 pt-6 pb-3">
          <CardTitle>Relative Performance ({period})</CardTitle>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-black/[0.06]">
                {['Symbol', 'Category', 'Holding', 'SPY', 'Relative'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-black/40 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {relativeStrength.map((r) => (
                <tr key={r.symbol} className="border-b border-black/[0.03] hover:bg-black/[0.02] transition-colors">
                  <td className="px-4 py-3">
                    <span className="text-sm font-semibold text-black/85">{r.symbol}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-black/55">{r.category}</td>
                  <td className="px-4 py-3">
                    <span className={`text-sm font-semibold tabular-nums ${r.holdingReturn >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                      {r.holdingReturn > 0 ? '+' : ''}{r.holdingReturn.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-sm tabular-nums ${r.spyReturn >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                      {r.spyReturn > 0 ? '+' : ''}{r.spyReturn.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-semibold tabular-nums ${
                      r.relStrength > 5 ? 'bg-accent-green/15 text-green-700' :
                      r.relStrength > 0 ? 'bg-accent-green/[0.06] text-green-600' :
                      r.relStrength > -5 ? 'bg-accent-red/[0.06] text-red-600' :
                      'bg-accent-red/15 text-red-700'
                    }`}>
                      {r.relStrength > 0 ? '+' : ''}{r.relStrength.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* RS Chart */}
      {rsChartData.length > 0 && (
        <Card>
          <CardTitle>Top Outperformers vs SPY — Indexed ({period})</CardTitle>
          <p className="text-xs text-black/40 mt-1 mb-4">Normalized to 100 at start of period</p>
          <MultiSeriesChart
            data={rsChartData}
            series={[
              ...topOutperformers.map((r, i) => ({
                key: r.symbol,
                color: ['#007AFF', '#AF52DE', '#FF9500'][i],
                name: r.symbol,
              })),
              { key: 'SPY', color: '#8E8E93', name: 'SPY (benchmark)' },
            ]}
            height={300}
          />
        </Card>
      )}

      {/* ─── CORRELATION MATRIX ─── */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold text-black/75 tracking-tight mb-1">Correlation Matrix</h3>
        <p className="text-xs text-black/40 mb-4">
          Pairwise correlations of daily returns over {period}. High correlation means positions move together (less diversification).
        </p>
      </div>

      <Card padding="none">
        <div className="px-6 pt-6 pb-3">
          <CardTitle>Daily Return Correlations</CardTitle>
          <div className="flex items-center gap-4 mt-2">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded bg-accent-red/20" />
              <span className="text-xs text-black/40">High (&gt;0.7)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded bg-accent-orange/15" />
              <span className="text-xs text-black/40">Medium (0.4-0.7)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded bg-black/[0.04]" />
              <span className="text-xs text-black/40">Low (-0.1 to 0.1)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-3 h-3 rounded bg-accent-blue/15" />
              <span className="text-xs text-black/40">Negative (&lt;-0.4)</span>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto pb-4">
          <table className="mx-4">
            <thead>
              <tr>
                <th className="px-2 py-2 text-xs font-medium text-black/40 w-16" />
                {corrMatrixSymbols.map((sym) => (
                  <th key={sym} className="px-1 py-2 text-xs font-semibold text-black/65 text-center min-w-[48px]">
                    {sym}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {corrMatrixSymbols.map((rowSym, i) => (
                <tr key={rowSym}>
                  <td className="px-2 py-1 text-xs font-semibold text-black/65">{rowSym}</td>
                  {corrMatrixSymbols.map((colSym, j) => {
                    const val = corrMatrix[i][j];
                    return (
                      <td key={colSym} className="px-1 py-1 text-center">
                        <span className={`inline-block w-full px-1 py-1 rounded text-[10px] font-semibold tabular-nums ${
                          i === j ? 'bg-black/[0.06] text-black/30' : corrColor(val)
                        }`}>
                          {i === j ? '1.00' : val.toFixed(2)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Diversification insight */}
      {(() => {
        // Find the average off-diagonal correlation
        let totalCorr = 0;
        let count = 0;
        for (let i = 0; i < corrSymbols.length; i++) {
          for (let j = i + 1; j < corrSymbols.length; j++) {
            totalCorr += corrMatrix[i][j];
            count++;
          }
        }
        const avgCorr = count > 0 ? totalCorr / count : 0;
        const badge = avgCorr > 0.6 ? 'red' : avgCorr > 0.35 ? 'orange' : avgCorr > 0.1 ? 'green' : 'blue';
        const text = avgCorr > 0.6
          ? 'High average correlation suggests concentrated risk. Consider adding uncorrelated assets.'
          : avgCorr > 0.35
            ? 'Moderate correlation — decent diversification but room to improve with uncorrelated assets.'
            : 'Low average correlation indicates strong diversification across holdings.';

        return (
          <Card>
            <div className="flex items-center gap-3 mb-2">
              <CardTitle>Diversification Score</CardTitle>
              <Badge variant={badge as 'red' | 'orange' | 'green' | 'blue'}>Avg Corr: {avgCorr.toFixed(2)}</Badge>
            </div>
            <p className="text-sm text-black/55 leading-relaxed">{text}</p>
          </Card>
        );
      })()}

      {/* ─── VOLATILITY CONTEXT ─── */}
      <div className="mt-8">
        <h3 className="text-lg font-semibold text-black/75 tracking-tight mb-1">Volatility Context</h3>
        <p className="text-xs text-black/40 mb-4">
          Annualized volatility from daily returns. Higher = wider price swings = more risk (and opportunity).
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <MetricCard
          label="VIX"
          value={macroData?.vix?.length ? macroData.vix[macroData.vix.length - 1].value.toFixed(1) : '—'}
          change={(() => {
            const v = macroData?.vix;
            if (!v || v.length < 2) return '';
            const chg = v[v.length - 1].value - v[v.length - 2].value;
            return `${chg > 0 ? '+' : ''}${chg.toFixed(1)}`;
          })()}
          trend={(() => {
            const v = macroData?.vix;
            if (!v || v.length < 2) return 'neutral' as const;
            return v[v.length - 1].value > v[v.length - 2].value ? 'up' as const : 'down' as const;
          })()}
        />
        <MetricCard
          label="SPY Volatility"
          value={`${spyAnnualizedVol.toFixed(1)}%`}
          change="annualized"
        />
        <MetricCard
          label="Highest Vol"
          value={volatility[0]?.symbol || '—'}
          change={`${volatility[0]?.annualized.toFixed(1)}%`}
          trend="down"
        />
        <MetricCard
          label="Lowest Vol"
          value={volatility[volatility.length - 1]?.symbol || '—'}
          change={`${volatility[volatility.length - 1]?.annualized.toFixed(1)}%`}
          trend="up"
        />
        <MetricCard
          label="Avg Portfolio Vol"
          value={`${(volatility.reduce((s, v) => s + v.annualized, 0) / (volatility.length || 1)).toFixed(1)}%`}
          change={`vs SPY ${spyAnnualizedVol.toFixed(1)}%`}
        />
      </div>

      {/* Volatility bar chart (as table) */}
      <Card padding="none">
        <div className="px-6 pt-6 pb-3">
          <CardTitle>Annualized Volatility by Holding</CardTitle>
        </div>
        <div className="px-6 pb-6 space-y-2">
          {volatility.map((v) => {
            const maxVol = Math.max(...volatility.map((x) => x.annualized), spyAnnualizedVol);
            const pct = maxVol > 0 ? (v.annualized / maxVol) * 100 : 0;
            const spyPct = maxVol > 0 ? (spyAnnualizedVol / maxVol) * 100 : 0;
            return (
              <div key={v.symbol} className="flex items-center gap-3">
                <span className="text-sm font-semibold text-black/75 w-12 shrink-0">{v.symbol}</span>
                <div className="flex-1 relative h-7 bg-black/[0.03] rounded-lg overflow-hidden">
                  <div
                    className={`absolute inset-y-0 left-0 rounded-lg transition-all ${
                      v.annualized > spyAnnualizedVol * 1.5
                        ? 'bg-accent-red/20'
                        : v.annualized > spyAnnualizedVol
                          ? 'bg-accent-orange/20'
                          : 'bg-accent-green/20'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                  {/* SPY reference line */}
                  <div
                    className="absolute inset-y-0 w-px bg-black/20"
                    style={{ left: `${spyPct}%` }}
                    title={`SPY: ${spyAnnualizedVol.toFixed(1)}%`}
                  />
                  <span className="absolute inset-0 flex items-center pl-2 text-xs font-semibold text-black/65">
                    {v.annualized.toFixed(1)}%
                  </span>
                </div>
                <span className="text-xs text-black/35 w-20 shrink-0">
                  {v.annualized > spyAnnualizedVol ? `${((v.annualized / spyAnnualizedVol)).toFixed(1)}x SPY` : 'Below SPY'}
                </span>
              </div>
            );
          })}
          {/* SPY reference row */}
          <div className="flex items-center gap-3 pt-2 border-t border-black/[0.06]">
            <span className="text-sm font-semibold text-black/50 w-12 shrink-0">SPY</span>
            <div className="flex-1 relative h-7 bg-black/[0.03] rounded-lg overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-lg bg-accent-blue/15"
                style={{ width: `${(spyAnnualizedVol / Math.max(...volatility.map((x) => x.annualized), spyAnnualizedVol)) * 100}%` }}
              />
              <span className="absolute inset-0 flex items-center pl-2 text-xs font-semibold text-black/55">
                {spyAnnualizedVol.toFixed(1)}%
              </span>
            </div>
            <span className="text-xs text-black/35 w-20 shrink-0">Benchmark</span>
          </div>
        </div>
      </Card>

      {/* Rolling volatility chart for highest vol holding */}
      {volatility.length > 0 && volatility[0].rollingVol.length > 0 && (
        <Card>
          <CardTitle>{volatility[0].symbol} — 20-Day Rolling Volatility (Annualized)</CardTitle>
          <p className="text-xs text-black/40 mt-1 mb-4">Shows how volatility evolves over time. Spikes indicate stress periods.</p>
          <TimeSeriesChart
            data={volatility[0].rollingVol}
            color="#FF3B30"
            height={250}
            gradientId="rolling-vol"
            valueFormatter={(v) => `${v.toFixed(1)}%`}
          />
        </Card>
      )}

      {/* ─── VOLATILITY-BASED BUY/SELL SIGNALS ─── */}
      {volSignals.length > 0 && (
        <>
          <div className="mt-4">
            <h3 className="text-lg font-semibold text-black/75 tracking-tight mb-1">Volatility Signals — Buy vs Sell Context</h3>
            <p className="text-xs text-black/40 mb-4">
              Combines each holding&apos;s current volatility regime (vs its own history) with price position to flag potential opportunities and risks.
            </p>
          </div>

          <Card padding="none">
            <div className="px-6 pt-6 pb-3">
              <CardTitle>Per-Holding Signals ({period})</CardTitle>
              <p className="text-xs text-black/40 mt-1">
                Based on 20-day rolling vol percentile, drawdown from high, and price position in the period range
              </p>
            </div>
            <div className="divide-y divide-black/[0.04]">
              {volSignals.map((s) => {
                const signal = getVolSignal(s);
                const showBottomScore = signal.signal === 'Capitulation Watch' || signal.signal === 'Potential Buy Zone';

                // Compute bottom score for eligible stocks
                const bottomScore = showBottomScore ? (() => {
                  const series = aggData?.find((a) => a.symbol === s.symbol)?.data || [];
                  const sliced = series.filter((d) => d.date >= periodCutoff);
                  const volumes = sliced.map((d) => d.volume);
                  const closes = sliced.map((d) => d.close);

                  // Compute rolling vols for mean reversion
                  const rollingVols: number[] = [];
                  for (let i = 20; i < closes.length; i++) {
                    const w = computeReturns(closes.slice(i - 20, i + 1));
                    rollingVols.push(stdDev(w) * Math.sqrt(252) * 100);
                  }

                  const vixLevel = macroData?.vix?.length ? macroData.vix[macroData.vix.length - 1].value : null;
                  const hySpread = macroData?.highYieldSpread?.length ? macroData.highYieldSpread[macroData.highYieldSpread.length - 1].value : null;

                  return computeBottomScore(s, volumes, vixLevel, hySpread, rollingVols);
                })() : null;

                return (
                  <div key={s.symbol} className="px-6 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="text-sm font-semibold text-black/85">{s.symbol}</span>
                          <Badge variant={signal.badge}>{signal.signal}</Badge>
                          <span className="text-xs text-black/35">{s.category}</span>
                        </div>
                        <p className="text-sm text-black/55 leading-relaxed max-w-2xl">
                          {signal.reason}
                        </p>

                        {/* Bottom Timing Score */}
                        {bottomScore && (
                          <div className={`mt-3 rounded-xl border p-4 ${bottomScore.gradeColor}`}>
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold uppercase tracking-wider">Bottom Timing Score</span>
                                <span className="text-lg font-black tabular-nums">{bottomScore.total}</span>
                                <span className="text-xs font-medium opacity-60">/ 100</span>
                              </div>
                              <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-white/40">{bottomScore.grade}</span>
                            </div>
                            {/* Score bar */}
                            <div className="w-full h-2.5 rounded-full bg-black/[0.08] mb-3 overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all ${
                                  bottomScore.total >= 75 ? 'bg-accent-red' :
                                  bottomScore.total >= 55 ? 'bg-accent-orange' :
                                  bottomScore.total >= 35 ? 'bg-accent-blue' :
                                  'bg-black/25'
                                }`}
                                style={{ width: `${bottomScore.total}%` }}
                              />
                            </div>
                            {/* Component breakdown */}
                            <div className="grid grid-cols-4 md:grid-cols-7 gap-2 text-[10px]">
                              <div className="text-center">
                                <p className="opacity-60 uppercase tracking-wider mb-0.5">Drawdown</p>
                                <p className="font-bold tabular-nums">{bottomScore.drawdownPts}/20</p>
                              </div>
                              <div className="text-center">
                                <p className="opacity-60 uppercase tracking-wider mb-0.5">Vol Spike</p>
                                <p className="font-bold tabular-nums">{bottomScore.volSpikePts}/15</p>
                              </div>
                              <div className="text-center">
                                <p className="opacity-60 uppercase tracking-wider mb-0.5">Volume</p>
                                <p className="font-bold tabular-nums">{bottomScore.volumePts}/15</p>
                              </div>
                              <div className="text-center">
                                <p className="opacity-60 uppercase tracking-wider mb-0.5">VIX</p>
                                <p className="font-bold tabular-nums">{bottomScore.vixPts}/15</p>
                              </div>
                              <div className="text-center">
                                <p className="opacity-60 uppercase tracking-wider mb-0.5">HY Spread</p>
                                <p className="font-bold tabular-nums">{bottomScore.hySpreadPts}/10</p>
                              </div>
                              <div className="text-center">
                                <p className="opacity-60 uppercase tracking-wider mb-0.5">Price Pos</p>
                                <p className="font-bold tabular-nums">{bottomScore.pricePositionPts}/10</p>
                              </div>
                              <div className="text-center">
                                <p className="opacity-60 uppercase tracking-wider mb-0.5">Vol Revert</p>
                                <p className="font-bold tabular-nums">{bottomScore.volMeanReversionPts}/15</p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 text-right space-y-1">
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-black/35">Vol Percentile</p>
                          <p className={`text-sm font-semibold tabular-nums ${
                            s.volPercentile > 0.75 ? 'text-accent-red' : s.volPercentile < 0.25 ? 'text-accent-green' : 'text-black/65'
                          }`}>
                            {(s.volPercentile * 100).toFixed(0)}th
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-black/35">From High</p>
                          <p className={`text-sm font-semibold tabular-nums ${
                            s.drawdown < -10 ? 'text-accent-red' : s.drawdown < -5 ? 'text-accent-orange' : 'text-black/65'
                          }`}>
                            {s.drawdown.toFixed(1)}%
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-black/35">20d Momentum</p>
                          <p className={`text-sm font-semibold tabular-nums ${
                            s.momentum20d > 0 ? 'text-accent-green' : 'text-accent-red'
                          }`}>
                            {s.momentum20d > 0 ? '+' : ''}{s.momentum20d.toFixed(1)}%
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Bottom Timing Score Methodology */}
          <Card>
            <CardTitle>Bottom Timing Score — Methodology</CardTitle>
            <p className="text-xs text-black/40 mt-1 mb-4">
              An evidence-based composite score (0-100) for gauging how close a stock may be to a capitulation bottom. Shown for stocks in &quot;Capitulation Watch&quot; or &quot;Potential Buy Zone.&quot;
            </p>
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="rounded-lg border border-black/[0.06] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-black/50 mb-1">Drawdown Severity (0-20)</p>
                  <p className="text-xs text-black/55 leading-relaxed">
                    How far the stock has fallen from its period high. Deeper drawdowns score higher: &gt;30% = 20pts, &gt;25% = 17pts, &gt;20% = 14pts, &gt;15% = 10pts.
                  </p>
                </div>
                <div className="rounded-lg border border-black/[0.06] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-black/50 mb-1">Volatility Spike (0-15)</p>
                  <p className="text-xs text-black/55 leading-relaxed">
                    Current 20-day rolling vol percentile vs history. Top 5% = 15pts, top 10% = 12pts, top 25% = 8pts. Extreme vol spikes historically coincide with capitulation selling.
                  </p>
                </div>
                <div className="rounded-lg border border-black/[0.06] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-black/50 mb-1">Volume Capitulation (0-15)</p>
                  <p className="text-xs text-black/55 leading-relaxed">
                    Recent 5-day max volume vs prior average. &gt;3x average = 15pts, &gt;2x = 10pts, &gt;1.5x = 5pts. Volume spikes indicate forced selling or panic liquidation.
                  </p>
                </div>
                <div className="rounded-lg border border-black/[0.06] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-black/50 mb-1">VIX Level (0-15)</p>
                  <p className="text-xs text-black/55 leading-relaxed">
                    Market-wide fear gauge from CBOE options. &gt;40 = 15pts (extreme panic), &gt;30 = 12pts, &gt;25 = 8pts, &gt;20 = 4pts. High VIX confirms broad market stress, not just stock-specific.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-lg border border-black/[0.06] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-black/50 mb-1">HY Credit Spread (0-10)</p>
                  <p className="text-xs text-black/55 leading-relaxed">
                    High yield bond spread over Treasuries. &gt;8% = 10pts (credit crisis), &gt;6% = 7pts, &gt;5% = 5pts. Widening spreads confirm systemic stress — credit markets lead equities.
                  </p>
                </div>
                <div className="rounded-lg border border-black/[0.06] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-black/50 mb-1">Price Position (0-10)</p>
                  <p className="text-xs text-black/55 leading-relaxed">
                    Where the current price sits in the period range. Bottom 10% = 10pts, bottom 20% = 7pts, bottom 30% = 4pts. Near the absolute low of the range adds conviction.
                  </p>
                </div>
                <div className="rounded-lg border border-black/[0.06] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-black/50 mb-1">Vol Mean Reversion (0-15)</p>
                  <p className="text-xs text-black/55 leading-relaxed">
                    Has volatility peaked and started declining? Vol peaked then dropped &gt;10% = 15pts, at extreme = 8pts, starting to decline = 5pts. The best entries are when vol peaks and turns — not while it&apos;s still rising.
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-2">
              <div className="text-center py-2 rounded-lg bg-accent-red/10 border border-accent-red/15">
                <p className="text-[10px] font-bold text-red-700">75-100</p>
                <p className="text-[10px] text-red-600">Extreme Capitulation</p>
              </div>
              <div className="text-center py-2 rounded-lg bg-accent-orange/10 border border-accent-orange/15">
                <p className="text-[10px] font-bold text-orange-700">55-74</p>
                <p className="text-[10px] text-orange-600">Heavy Selling</p>
              </div>
              <div className="text-center py-2 rounded-lg bg-accent-blue/10 border border-accent-blue/15">
                <p className="text-[10px] font-bold text-blue-700">35-54</p>
                <p className="text-[10px] text-blue-600">Moderate Distress</p>
              </div>
              <div className="text-center py-2 rounded-lg bg-black/[0.04] border border-black/[0.06]">
                <p className="text-[10px] font-bold text-black/60">20-34</p>
                <p className="text-[10px] text-black/45">Mild Weakness</p>
              </div>
              <div className="text-center py-2 rounded-lg bg-black/[0.02] border border-black/[0.04]">
                <p className="text-[10px] font-bold text-black/40">0-19</p>
                <p className="text-[10px] text-black/30">No Signal</p>
              </div>
            </div>
            <p className="text-xs text-black/35 mt-4 italic leading-relaxed">
              This score is a probabilistic framework, not a prediction. Scores above 75 are historically rare and have clustered around major market bottoms (2008-09, March 2020, Q4 2018). A high score means conditions are <span className="font-medium">consistent</span> with capitulation — it does not guarantee the bottom is in. Always scale into positions rather than going all-in, and confirm with fundamental thesis before acting. The strongest signal is when the score peaks and then starts declining (vol mean reversion turning positive).
            </p>
          </Card>

          {/* Framework explanation */}
          <Card>
            <CardTitle>How to Read Volatility Signals</CardTitle>
            <p className="text-xs text-black/40 mt-1 mb-4">A framework for using volatility to time entries and exits</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-accent-green/20 rounded-xl p-4 bg-accent-green/[0.03]">
                <p className="text-xs font-semibold text-accent-green uppercase tracking-wider mb-2">When to Consider Buying</p>
                <ul className="text-xs text-black/55 space-y-1.5 leading-relaxed">
                  <li><span className="font-medium text-black/70">High vol + price near lows:</span> Fear is elevated and the stock has sold off. If your fundamental thesis is intact, this is often the best risk/reward entry.</li>
                  <li><span className="font-medium text-black/70">Vol starting to decline from a spike:</span> The panic is subsiding. A &quot;vol crush&quot; after a spike often coincides with a price recovery.</li>
                  <li><span className="font-medium text-black/70">Low vol coiling near support:</span> Compressed volatility suggests a big move is brewing. If it breaks upward with volume, it can run.</li>
                </ul>
              </div>
              <div className="border border-accent-red/20 rounded-xl p-4 bg-accent-red/[0.03]">
                <p className="text-xs font-semibold text-accent-red uppercase tracking-wider mb-2">When to Consider Selling / Trimming</p>
                <ul className="text-xs text-black/55 space-y-1.5 leading-relaxed">
                  <li><span className="font-medium text-black/70">Low vol + price at highs:</span> Complacency. The market is pricing in a best-case scenario. Small catalysts can trigger outsized drops.</li>
                  <li><span className="font-medium text-black/70">Rising vol + price at highs:</span> Distribution pattern. Volatility expanding near tops suggests large players are selling. Take partial profits.</li>
                  <li><span className="font-medium text-black/70">Vol &gt;1.5x its median for extended periods:</span> Persistent high vol erodes compounding. If a position stays volatile for weeks, reassess your conviction level.</li>
                </ul>
              </div>
            </div>
            <p className="text-xs text-black/35 mt-4 italic leading-relaxed">
              Volatility signals work best as a complement to fundamental analysis, not a replacement. They tell you about market sentiment and positioning, not intrinsic value. Always size positions inversely to volatility — smaller positions in high-vol names.
            </p>
          </Card>
        </>
      )}
    </div>
  );
}
