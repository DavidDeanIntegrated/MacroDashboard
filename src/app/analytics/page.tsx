'use client';

import { useState, useMemo } from 'react';
import { Card, CardTitle, MetricCard } from '@/components/ui/Card';
import { LoadingPage } from '@/components/ui/Loading';
import { Badge } from '@/components/ui/Badge';
import { TimeSeriesChart, MultiSeriesChart } from '@/components/charts/TimeSeriesChart';
import { useMultiAggregates } from '@/lib/hooks';
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

  if (loading) return <LoadingPage />;

  const days = PERIOD_DAYS[period];

  // Get sliced close prices for each symbol
  const symbolData: Record<string, { closes: number[]; dates: string[] }> = {};
  for (const sym of allSymbols) {
    const series = aggData?.find((s) => s.symbol === sym)?.data || [];
    const sliced = series.slice(-days);
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
    </div>
  );
}
