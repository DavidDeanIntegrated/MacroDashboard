'use client';

import { useState, useMemo } from 'react';
import { Card, CardTitle } from '@/components/ui/Card';
import { LoadingPage } from '@/components/ui/Loading';
import { Badge } from '@/components/ui/Badge';
import { MultiSeriesChart } from '@/components/charts/TimeSeriesChart';
import { useMultiAggregates, useMacroRegime } from '@/lib/hooks';
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

  // Regime hints based on sector leadership
  const topSectors = sorted.slice(0, 3).map((s) => s.symbol);
  const regimeHint = (() => {
    if (topSectors.includes('XLE') && topSectors.includes('XLB'))
      return { label: 'Reflation', badge: 'orange' as const, text: 'Energy & Materials leading suggests rising commodity prices and inflation expectations.' };
    if (topSectors.includes('XLU') && topSectors.includes('XLP'))
      return { label: 'Defensive / Late Cycle', badge: 'red' as const, text: 'Utilities & Staples leading suggests risk-off positioning and potential slowdown.' };
    if (topSectors.includes('XLK') && topSectors.includes('XLC'))
      return { label: 'Growth / Risk-On', badge: 'green' as const, text: 'Tech & Communication leading suggests growth optimism and risk appetite.' };
    if (topSectors.includes('XLF') && topSectors.includes('XLI'))
      return { label: 'Early Cycle', badge: 'blue' as const, text: 'Financials & Industrials leading suggests economic expansion and rising rates.' };
    return { label: 'Mixed', badge: 'neutral' as const, text: 'No clear sector leadership pattern. Markets may be in transition.' };
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
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
