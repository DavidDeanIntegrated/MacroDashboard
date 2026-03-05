'use client';

import { useState } from 'react';
import { Card, CardTitle, MetricCard } from '@/components/ui/Card';
import { LoadingPage, ErrorState, EmptyState } from '@/components/ui/Loading';
import { Badge, TrendIndicator } from '@/components/ui/Badge';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { AllocationPieChart } from '@/components/charts/AllocationPieChart';
import { usePortfolio, useStockBars } from '@/lib/hooks';
import { formatCurrency, formatPercent, formatNumber } from '@/lib/format';
import { CATEGORY_CONFIG } from '@/lib/holdings';

// Map badge variants to hex colors for the pie chart
const BADGE_COLORS: Record<string, string> = {
  blue: '#007AFF',
  purple: '#AF52DE',
  orange: '#FF9500',
  green: '#34C759',
  yellow: '#E6A700',
  red: '#FF3B30',
  neutral: '#8E8E93',
};

const categoryBadge = (category: string) => {
  const config = CATEGORY_CONFIG[category];
  return config?.badge ?? 'neutral';
};

export default function PortfolioPage() {
  const { data: portfolio, error, loading, refresh } = usePortfolio();
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const { data: chartData } = useStockBars(selectedSymbol);

  if (loading) return <LoadingPage />;
  if (error) return <ErrorState message={error} onRetry={refresh} />;
  if (!portfolio) return null;

  // Group positions by category for the allocation breakdown
  const categoryAllocations = Object.entries(
    portfolio.positions.reduce<Record<string, number>>((acc, pos) => {
      acc[pos.category] = (acc[pos.category] || 0) + pos.weight;
      return acc;
    }, {})
  ).sort(([a], [b]) => {
    const orderA = CATEGORY_CONFIG[a]?.order ?? 99;
    const orderB = CATEGORY_CONFIG[b]?.order ?? 99;
    return orderA - orderB;
  });

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold text-black/85 tracking-tight">Portfolio</h2>
        <p className="text-sm text-black/45 mt-1">Holdings, allocation, and live pricing</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <MetricCard
          label="Portfolio Value"
          value={formatCurrency(portfolio.portfolioValue)}
          change={formatCurrency(portfolio.dayChange)}
          changeLabel="today"
          trend={portfolio.dayChange >= 0 ? 'up' : 'down'}
        />
        <MetricCard
          label="Day Change"
          value={formatPercent(portfolio.dayChangePercent)}
          trend={portfolio.dayChange >= 0 ? 'up' : 'down'}
        />
        <MetricCard
          label="Positions"
          value={portfolio.positions.length.toString()}
        />
      </div>

      {/* Allocation Breakdown */}
      <Card>
        <CardTitle>Allocation by Category</CardTitle>
        <div className="mt-4">
          <AllocationPieChart
            data={categoryAllocations.map(([category, weight]) => ({
              name: category,
              value: weight,
              color: BADGE_COLORS[categoryBadge(category)] || '#8E8E93',
            }))}
          />
        </div>
      </Card>

      {/* Positions Table */}
      <Card padding="none">
        <div className="px-6 pt-6 pb-3">
          <CardTitle>Positions</CardTitle>
        </div>
        {portfolio.positions.length === 0 ? (
          <div className="px-6 pb-6">
            <EmptyState
              title="No positions"
              description="Add holdings in src/lib/holdings.ts to see your portfolio."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-black/[0.06]">
                  {['Symbol', 'Category', 'Qty', 'Price', 'Mkt Value', 'Weight', 'Day Chg'].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs font-medium text-black/40 uppercase tracking-wider"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {portfolio.positions.map((pos) => (
                  <tr
                    key={pos.symbol}
                    onClick={() => setSelectedSymbol(pos.symbol === selectedSymbol ? null : pos.symbol)}
                    className={`border-b border-black/[0.03] cursor-pointer transition-colors ${
                      selectedSymbol === pos.symbol
                        ? 'bg-accent-blue/[0.04]'
                        : 'hover:bg-black/[0.02]'
                    }`}
                  >
                    <td className="px-4 py-3">
                      <span className="font-semibold text-sm text-black/85">{pos.symbol}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={categoryBadge(pos.category)}>{pos.category}</Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-black/75 tabular-nums">
                      {formatNumber(pos.qty, { decimals: pos.qty < 1 ? 6 : 2 })}
                    </td>
                    <td className="px-4 py-3 text-sm text-black/85 font-medium tabular-nums">
                      {formatCurrency(pos.currentPrice)}
                    </td>
                    <td className="px-4 py-3 text-sm text-black/75 tabular-nums">
                      {formatCurrency(pos.marketValue)}
                    </td>
                    <td className="px-4 py-3 text-sm text-black/55 tabular-nums">
                      {pos.weight.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3">
                      <TrendIndicator value={pos.dayChangePercent} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Selected Position Chart */}
      {selectedSymbol && chartData && (
        <Card>
          <CardTitle>{selectedSymbol} — Daily Price</CardTitle>
          <TimeSeriesChart
            data={chartData.map((d) => ({ date: d.date, value: d.close }))}
            color="auto"
            height={300}
            gradientId={`pos-${selectedSymbol}`}
            valueFormatter={(v) => formatCurrency(v)}
          />
        </Card>
      )}
    </div>
  );
}
