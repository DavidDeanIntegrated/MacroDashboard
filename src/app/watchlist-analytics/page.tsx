'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardTitle, MetricCard } from '@/components/ui/Card';
import { LoadingPage } from '@/components/ui/Loading';
import { Badge } from '@/components/ui/Badge';
import { FundamentalsScoreSection } from '@/components/FundamentalsScoreCard';
import { TimeSeriesChart, MultiSeriesChart } from '@/components/charts/TimeSeriesChart';
import { useMultiAggregates, useApi, useFundamentalsScores } from '@/lib/hooks';
import { WATCHLIST, WATCHLIST_CATEGORY_CONFIG } from '@/lib/holdings';
import {
  computeReturns, stdDev, correlation, corrColor,
  computeVolStats, getVolSignal, computeBottomScore,
  type Bar,
} from '@/lib/vol-signals';
import { BottomScorePanel, BottomScoreMethodologyCard, VolSignalGuideCard } from '@/components/BottomScoreCard';

type AnalyticsPeriod = '1M' | '3M' | '6M' | '1Y';

const PERIOD_DAYS: Record<AnalyticsPeriod, number> = {
  '1M': 30,
  '3M': 90,
  '6M': 180,
  '1Y': 365,
};

const WATCH_STOCKS = WATCHLIST;

// Fundamentals grade → badge color (quality gate on entry signals)
function fundGradeBadge(grade: string): 'green' | 'orange' | 'red' | 'neutral' {
  if (grade === 'Excellent' || grade === 'Good') return 'green';
  if (grade === 'Fair') return 'neutral';
  if (grade === 'Weak') return 'orange';
  return 'red';
}

export default function WatchlistAnalyticsPage() {
  const [period, setPeriod] = useState<AnalyticsPeriod>('3M');

  const fromDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 370); // Always fetch 1Y, slice for shorter
    return d.toISOString().split('T')[0];
  }, []);

  const allSymbols = useMemo(() => {
    const syms = WATCH_STOCKS.map((h) => h.symbol);
    if (!syms.includes('SPY')) syms.push('SPY');
    return syms;
  }, []);

  const { data: aggData, loading } = useMultiAggregates(allSymbols, '1day', fromDate);

  // Fetch macro context for bottom scoring
  const { data: macroData } = useApi<{
    vix: Array<{ date: string; value: number }>;
    highYieldSpread: Array<{ date: string; value: number }>;
  }>('/api/fred?action=dashboard');

  // Fundamentals scores for watchlist stocks
  const watchFundSymbols = useMemo(() => WATCH_STOCKS.map((h) => h.symbol), []);
  const { data: watchFundScores, loading: fundScoresLoading, error: fundScoresError } = useFundamentalsScores(watchFundSymbols);

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

  // Get sliced close prices for each symbol (period-scoped sections: returns,
  // correlations, vol table, charts)
  const symbolData: Record<string, { closes: number[]; dates: string[] }> = {};
  // Full unsliced ~1Y bars — signal math always runs over the full lookback,
  // regardless of the display period.
  const symbolFullBars: Record<string, Bar[]> = {};
  for (const sym of allSymbols) {
    const series = aggData?.find((s) => s.symbol === sym)?.data || [];
    symbolFullBars[sym] = series;
    const sliced = series.filter((d) => d.date >= periodCutoff);
    symbolData[sym] = {
      closes: sliced.map((d) => d.close),
      dates: sliced.map((d) => d.date),
    };
  }

  const spyCloses = symbolData['SPY']?.closes || [];
  const spyDates = symbolData['SPY']?.dates || [];
  const spyReturns = computeReturns(spyCloses);

  // SPY close keyed by date, so each holding can be benchmarked over its OWN window
  // (a recent IPO's return must be compared to SPY over the same dates, not the full period).
  const spyByDate = new Map<string, number>();
  for (let i = 0; i < spyCloses.length; i++) spyByDate.set(spyDates[i], spyCloses[i]);

  // A holding "covers the full period" if it has data for ~all of SPY's trading days.
  // Short-history names (recent IPOs) are flagged so they can't distort the indexed chart.
  const fullPeriodThreshold = spyCloses.length * 0.9;

  // ─── RELATIVE STRENGTH ───
  const relativeStrength = WATCH_STOCKS.map((h) => {
    const closes = symbolData[h.symbol]?.closes || [];
    const dates = symbolData[h.symbol]?.dates || [];
    if (closes.length < 2 || spyCloses.length < 2) {
      return { symbol: h.symbol, category: h.category, currentPrice: 0, holdingReturn: 0, spyReturn: 0, relStrength: 0, hasFullPeriod: false };
    }
    const currentPrice = closes[closes.length - 1];
    const holdingReturn = ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100;
    // Benchmark SPY over the same window: from the holding's first date to the end.
    const spyStart = spyByDate.get(dates[0]) ?? spyCloses[0];
    const spyReturn = ((spyCloses[spyCloses.length - 1] - spyStart) / spyStart) * 100;
    return {
      symbol: h.symbol,
      category: h.category,
      currentPrice,
      holdingReturn,
      spyReturn,
      relStrength: holdingReturn - spyReturn,
      hasFullPeriod: closes.length >= fullPeriodThreshold,
    };
  }).sort((a, b) => b.relStrength - a.relStrength);

  // ─── CORRELATION MATRIX ───
  const corrSymbols = WATCH_STOCKS.map((h) => h.symbol);
  const dailyReturns: Record<string, number[]> = {};
  for (const sym of corrSymbols) {
    dailyReturns[sym] = computeReturns(symbolData[sym]?.closes || []);
  }
  dailyReturns['SPY'] = spyReturns;
  const corrMatrixSymbols = [...corrSymbols, 'SPY'];

  const corrMatrix: number[][] = corrMatrixSymbols.map((a) =>
    corrMatrixSymbols.map((b) => correlation(dailyReturns[a] || [], dailyReturns[b] || []))
  );

  // ─── VOLATILITY ───
  const volatility = WATCH_STOCKS.map((h) => {
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
  // Always computed over the FULL ~1Y lookback via lib/vol-signals.ts.
  const volSignals = WATCH_STOCKS
    .map((h) => computeVolStats(h.symbol, h.category, symbolFullBars[h.symbol] || []))
    .filter((s): s is NonNullable<typeof s> => s !== null);

  // Fundamentals lookup for the quality gate on entry signals
  const fundBySymbol = new Map((watchFundScores ?? []).map((f) => [f.symbol, f]));

  // Relative strength chart — each series indexed to 100 at its first close.
  // Only full-period holdings are eligible so a recent IPO can't hijack the y-axis.
  const topOutperformers = relativeStrength.filter((r) => r.hasFullPeriod).slice(0, 3);
  const rsChartData: Array<{ date: string; [key: string]: string | number | null }> = [];
  if (topOutperformers.length > 0 && spyCloses.length > 0) {
    const symsForChart = [...topOutperformers.map((r) => r.symbol), 'SPY'];

    // Build a date->close lookup and a base (first close) for each symbol.
    const closeByDate: Record<string, Map<string, number>> = {};
    const bases: Record<string, number> = {};
    for (const sym of symsForChart) {
      const closes = symbolData[sym]?.closes || [];
      const dates = symbolData[sym]?.dates || [];
      const m = new Map<string, number>();
      for (let i = 0; i < dates.length; i++) m.set(dates[i], closes[i]);
      closeByDate[sym] = m;
      bases[sym] = closes.length > 0 ? closes[0] : 0;
    }

    // Walk SPY's date axis (full period) so all series stay aligned by calendar date.
    // Dates a symbol hasn't traded yet are left null, so its line simply starts later.
    for (const date of spyDates) {
      const point: { date: string; [key: string]: string | number | null } = { date };
      for (const sym of symsForChart) {
        const close = closeByDate[sym].get(date);
        const base = bases[sym];
        point[sym] = close != null && base > 0 ? +((close / base) * 100).toFixed(2) : null;
      }
      rsChartData.push(point);
    }
  }

  const categoryBadge = (category: string) => {
    return WATCHLIST_CATEGORY_CONFIG[category]?.badge ?? 'neutral';
  };

  const allPeriods: AnalyticsPeriod[] = ['1M', '3M', '6M', '1Y'];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-1 p-0.5 mb-3 rounded-xl bg-black/[0.04]">
            <Link
              href="/analytics"
              className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all text-black/45 hover:bg-black/[0.04]"
            >
              My Holdings
            </Link>
            <Link
              href="/watchlist-analytics"
              className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all bg-accent-blue text-white shadow-sm"
            >
              Watchlist
            </Link>
          </div>
          <h2 className="text-2xl font-semibold text-black/85 tracking-tight">Watchlist Analytics</h2>
          <p className="text-sm text-black/45 mt-1">
            Relative strength, correlations, and volatility for watched stocks
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
        <p className="text-xs text-black/40 mb-4">Watchlist stocks ranked by excess return over the S&P 500</p>
      </div>

      <Card padding="none">
        <div className="px-6 pt-6 pb-3">
          <CardTitle>Relative Performance ({period})</CardTitle>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-black/[0.06]">
                {['Symbol', 'Category', 'Price', 'Stock', 'SPY', 'Relative'].map((h) => (
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
                    <Link
                      href={`/ticker?symbol=${r.symbol}`}
                      className="text-sm font-semibold text-black/85 hover:text-accent-blue transition-colors"
                    >
                      {r.symbol}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={categoryBadge(r.category)}>{r.category}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm font-semibold tabular-nums text-black/75">
                      ${r.currentPrice < 1 ? r.currentPrice.toFixed(4) : r.currentPrice.toFixed(2)}
                    </span>
                  </td>
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
          Pairwise correlations of daily returns over {period}. High correlation means stocks move together.
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
          ? 'High average correlation among watchlist stocks. They tend to move together — entering multiple may not provide diversification.'
          : avgCorr > 0.35
            ? 'Moderate average correlation — some diversification benefit from holding multiple names, but clusters exist.'
            : 'Low average correlation indicates the watchlist spans distinct market segments with genuine diversification potential.';

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
          label="Avg Watchlist Vol"
          value={`${(volatility.reduce((s, v) => s + v.annualized, 0) / (volatility.length || 1)).toFixed(1)}%`}
          change={`vs SPY ${spyAnnualizedVol.toFixed(1)}%`}
        />
      </div>

      {/* Volatility bar chart */}
      <Card padding="none">
        <div className="px-6 pt-6 pb-3">
          <CardTitle>Annualized Volatility by Stock</CardTitle>
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

      {/* Rolling volatility chart for highest vol stock */}
      {volatility.length > 0 && volatility[0].rollingVol.length > 0 && (
        <Card>
          <CardTitle>{volatility[0].symbol} — 20-Day Rolling Volatility (Annualized)</CardTitle>
          <p className="text-xs text-black/40 mt-1 mb-4">Shows how volatility evolves over time. Spikes indicate stress periods.</p>
          <TimeSeriesChart
            data={volatility[0].rollingVol}
            color="#FF3B30"
            height={250}
            gradientId="watch-rolling-vol"
            valueFormatter={(v) => `${v.toFixed(1)}%`}
          />
        </Card>
      )}

      {/* ─── VOLATILITY-BASED BUY/SELL SIGNALS ─── */}
      {volSignals.length > 0 && (
        <>
          <div className="mt-4">
            <h3 className="text-lg font-semibold text-black/75 tracking-tight mb-1">Volatility Signals — Entry Timing</h3>
            <p className="text-xs text-black/40 mb-4">
              Combines each stock&apos;s volatility regime (vs its own 1Y history), price position, vol mean-reversion state, and 200-day trend to flag potential entry points — gated by the fundamentals quality grade, because a great entry price on a weak business is still a weak business.
            </p>
          </div>

          <Card padding="none">
            <div className="px-6 pt-6 pb-3">
              <CardTitle>Per-Stock Signals (1Y lookback)</CardTitle>
              <p className="text-xs text-black/40 mt-1">
                Fixed 1-year window regardless of the period selector — rolling vol percentile, drawdown, price position, vol mean-reversion, 200-day trend, and the fundamentals quality gate
              </p>
            </div>
            <div className="divide-y divide-black/[0.04]">
              {volSignals.map((s) => {
                const signal = getVolSignal(s, 'watchlist');
                const bottomScore = signal.isBottomCandidate
                  ? computeBottomScore(s, symbolFullBars[s.symbol] || [], macroData?.vix, macroData?.highYieldSpread)
                  : null;

                // Quality gate: an entry-flavored signal on a fundamentally weak
                // name is flagged, not celebrated.
                const fund = fundBySymbol.get(s.symbol);
                const fundGrade = fund && !fund.unavailable ? fund.grade : null;
                const entryFlavored = signal.badge === 'green';
                const qualityVeto = entryFlavored && (fundGrade === 'Weak' || fundGrade === 'Poor');

                return (
                  <div key={s.symbol} className="px-6 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2 flex-wrap">
                          <span className="text-sm font-semibold text-black/85">{s.symbol}</span>
                          <span className="text-sm font-semibold tabular-nums text-black/55">
                            ${s.currentPrice < 1 ? s.currentPrice.toFixed(4) : s.currentPrice.toFixed(2)}
                          </span>
                          <Badge variant={qualityVeto ? 'orange' : signal.badge}>{signal.signal}</Badge>
                          {fundGrade && (
                            <Badge variant={fundGradeBadge(fundGrade)}>Fundamentals: {fundGrade}{fund ? ` · ${fund.total}` : ''}</Badge>
                          )}
                          <Badge variant={categoryBadge(s.category)}>{s.category}</Badge>
                        </div>
                        <p className="text-sm text-black/55 leading-relaxed max-w-2xl">
                          {signal.reason}
                        </p>
                        {qualityVeto && (
                          <p className="text-sm text-orange-700/80 leading-relaxed max-w-2xl mt-1.5">
                            Quality gate: fundamentals grade is <span className="font-semibold">{fundGrade}</span> ({fund?.total}/100) — the timing setup doesn&apos;t fix the business. Treat any entry as speculative and small, or wait for the fundamentals to improve.
                          </p>
                        )}
                        {entryFlavored && !qualityVeto && (fundGrade === 'Excellent' || fundGrade === 'Good') && (
                          <p className="text-sm text-green-700/80 leading-relaxed max-w-2xl mt-1.5">
                            Passes the quality gate: fundamentals grade {fundGrade} ({fund?.total}/100) — timing and quality align.
                          </p>
                        )}

                        {/* Bottom Timing Score */}
                        {bottomScore && <BottomScorePanel score={bottomScore} />}
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
                          <p className="text-[10px] uppercase tracking-wider text-black/35">From 1Y High</p>
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
                            {s.momentum20d > 0 ? '+' : ''}{s.momentum20d.toFixed(1)}% <span className="text-black/35 font-normal">({s.momentumSigma >= 0 ? '+' : ''}{s.momentumSigma.toFixed(1)}σ)</span>
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-black/35">vs 200d MA</p>
                          <p className={`text-sm font-semibold tabular-nums ${
                            s.trendPct === null ? 'text-black/35' : s.trendPct >= 0 ? 'text-accent-green' : 'text-accent-red'
                          }`}>
                            {s.trendPct === null ? '—' : `${s.trendPct >= 0 ? '+' : ''}${s.trendPct.toFixed(1)}%`}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <BottomScoreMethodologyCard />
          <VolSignalGuideCard mode="watchlist" />

      {/* ─── FUNDAMENTAL ANALYSIS SCORES ─── */}
      <FundamentalsScoreSection
        scores={watchFundScores}
        loading={fundScoresLoading}
        error={fundScoresError}
        title="Fundamental Analysis Scores"
        subtitle="Composite score (0-100) for each watchlist stock based on profitability, growth, valuation, financial health, and earnings quality"
      />

        </>
      )}
    </div>
  );
}
