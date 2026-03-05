'use client';

import { useState, useMemo } from 'react';
import { Card, CardTitle } from '@/components/ui/Card';
import { LoadingPage } from '@/components/ui/Loading';
import { Badge } from '@/components/ui/Badge';
import { MultiSeriesChart } from '@/components/charts/TimeSeriesChart';
import { useMultiAggregates } from '@/lib/hooks';

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

      {/* Regime Context */}
      <Card>
        <CardTitle>Sector Rotation & Macro Regimes</CardTitle>
        <p className="text-xs text-black/45 mt-1 mb-4">
          Which sectors tend to lead in each macro environment
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-accent-green/20 rounded-xl p-4 bg-accent-green/[0.03]">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="green">Goldilocks</Badge>
            </div>
            <p className="text-xs text-black/55 mb-1">Moderate growth, low inflation, easy policy.</p>
            <p className="text-xs text-black/75 font-medium">Leaders: XLK, XLY, XLC (growth & consumer)</p>
          </div>
          <div className="border border-accent-orange/20 rounded-xl p-4 bg-accent-orange/[0.03]">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="orange">Reflation</Badge>
            </div>
            <p className="text-xs text-black/55 mb-1">Rising inflation, strong growth, tightening.</p>
            <p className="text-xs text-black/75 font-medium">Leaders: XLE, XLB, XLF (commodities & financials)</p>
          </div>
          <div className="border border-accent-red/20 rounded-xl p-4 bg-accent-red/[0.03]">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="red">Stagflation</Badge>
            </div>
            <p className="text-xs text-black/55 mb-1">High inflation, slowing growth.</p>
            <p className="text-xs text-black/75 font-medium">Leaders: XLE, XLP, XLU (energy & defensives)</p>
          </div>
          <div className="border border-accent-blue/20 rounded-xl p-4 bg-accent-blue/[0.03]">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="blue">Deflation / Contraction</Badge>
            </div>
            <p className="text-xs text-black/55 mb-1">Falling prices, demand collapsing, rate cuts.</p>
            <p className="text-xs text-black/75 font-medium">Leaders: XLU, XLP, XLRE (defensives & duration)</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
