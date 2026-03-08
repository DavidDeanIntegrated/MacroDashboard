'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { Card, CardTitle, MetricCard } from '@/components/ui/Card';
import { LoadingPage, ErrorState, EmptyState } from '@/components/ui/Loading';
import { Badge, TrendIndicator } from '@/components/ui/Badge';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { AllocationPieChart } from '@/components/charts/AllocationPieChart';
import { FundamentalsScoreSection } from '@/components/FundamentalsScoreCard';
import { usePortfolio, usePortfolioChart, usePolygonAggregates, usePolygonRSI, usePortfolioDividends, useWatchlist, useFundamentalsScores } from '@/lib/hooks';
import { formatCurrency, formatPercent, formatNumber } from '@/lib/format';
import { CATEGORY_CONFIG, HOLDINGS, WATCHLIST, WATCHLIST_CATEGORY_CONFIG } from '@/lib/holdings';
import type { PolygonTimeframe } from '@/lib/polygon';

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

const FREQ_LABELS: Record<number, string> = {
  1: 'Annual',
  2: 'Semi-Annual',
  4: 'Quarterly',
  12: 'Monthly',
};

const PORTFOLIO_CHART_PERIODS = ['1D', '1M', '3M', '6M', '1Y'] as const;

const CHART_TIMEFRAMES: { label: string; value: PolygonTimeframe }[] = [
  { label: '1D', value: '1min' },
  { label: '1W', value: '5min' },
  { label: '1M', value: '15min' },
  { label: '3M', value: '1hour' },
  { label: '1Y', value: '1day' },
];

function getRSIBadge(rsiData: Array<{ date: string; value: number }> | null) {
  if (!rsiData || rsiData.length === 0) return null;
  const latest = rsiData[rsiData.length - 1].value;
  if (latest >= 70) return { label: `RSI ${latest.toFixed(0)} · Overbought`, variant: 'red' as const };
  if (latest <= 30) return { label: `RSI ${latest.toFixed(0)} · Oversold`, variant: 'green' as const };
  return { label: `RSI ${latest.toFixed(0)}`, variant: 'neutral' as const };
}

export default function PortfolioPage() {
  const { data: portfolio, error, loading, refresh } = usePortfolio();
  const [portfolioChartPeriod, setPortfolioChartPeriod] = useState<string>('1D');
  const { data: portfolioChartData } = usePortfolioChart(portfolioChartPeriod);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [chartTimeframe, setChartTimeframe] = useState<PolygonTimeframe>('1day');
  const { data: chartData } = usePolygonAggregates(selectedSymbol, chartTimeframe);
  const { data: rsiData } = usePolygonRSI(selectedSymbol && selectedSymbol !== 'BTC' ? selectedSymbol : null);
  const { data: dividends } = usePortfolioDividends(HOLDINGS.map((h) => h.symbol));

  // Fundamentals scores for portfolio holdings
  const portfolioSymbols = useMemo(() => HOLDINGS.map((h) => h.symbol), []);
  const { data: portfolioScores, loading: scoresLoading, error: scoresError } = useFundamentalsScores(portfolioSymbols);

  // Watchlist
  const { data: watchlist } = useWatchlist();
  const [watchSelectedSymbol, setWatchSelectedSymbol] = useState<string | null>(null);
  const [watchChartTimeframe, setWatchChartTimeframe] = useState<PolygonTimeframe>('1day');
  const { data: watchChartData } = usePolygonAggregates(watchSelectedSymbol, watchChartTimeframe);
  const { data: watchRsiData } = usePolygonRSI(watchSelectedSymbol);

  // Fundamentals scores for watchlist stocks
  const watchlistSymbols = useMemo(() => WATCHLIST.map((w) => w.symbol), []);
  const { data: watchlistScores, loading: watchScoresLoading, error: watchScoresError } = useFundamentalsScores(watchlistSymbols);

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

  const selectedPosition = portfolio.positions.find((p) => p.symbol === selectedSymbol);
  const rsiBadge = getRSIBadge(rsiData);

  const watchSelectedPosition = watchlist?.find((p) => p.symbol === watchSelectedSymbol);
  const watchRsiBadge = getRSIBadge(watchRsiData);
  const watchCategoryBadge = (category: string) => {
    const config = WATCHLIST_CATEGORY_CONFIG[category];
    return config?.badge ?? 'neutral';
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold text-black/85 tracking-tight">Portfolio</h2>
        <p className="text-sm text-black/45 mt-1">Holdings, allocation, and live pricing via Polygon.io</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
        <MetricCard
          label="Top Holding"
          value={portfolio.positions[0]?.symbol || '—'}
          change={`${portfolio.positions[0]?.weight.toFixed(1)}%`}
          changeLabel="weight"
        />
      </div>

      {/* Portfolio Value Chart */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <CardTitle>Portfolio Value</CardTitle>
            {portfolioChartData && portfolioChartData.length >= 2 && (() => {
              const first = portfolioChartData[0].value;
              const last = portfolioChartData[portfolioChartData.length - 1].value;
              const change = last - first;
              const changePct = first > 0 ? (change / first) * 100 : 0;
              const isUp = change >= 0;
              return (
                <p className={`text-sm font-medium mt-1 ${isUp ? 'text-accent-green' : 'text-accent-red'}`}>
                  {isUp ? '+' : ''}{formatCurrency(change)} ({isUp ? '+' : ''}{changePct.toFixed(2)}%) · {portfolioChartPeriod}
                </p>
              );
            })()}
          </div>
          <div className="flex gap-1">
            {PORTFOLIO_CHART_PERIODS.map((p) => (
              <button
                key={p}
                onClick={() => setPortfolioChartPeriod(p)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  portfolioChartPeriod === p
                    ? 'bg-black/[0.08] text-black/85'
                    : 'text-black/40 hover:text-black/65 hover:bg-black/[0.03]'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        {portfolioChartData && portfolioChartData.length > 0 ? (
          <TimeSeriesChart
            data={portfolioChartData}
            color="#007AFF"
            height={300}
            gradientId="portfolio-value"
            valueFormatter={(v) => formatCurrency(v)}
            autoScale
            {...(portfolioChartPeriod === '1D' ? {
              xAxisFormatter: (d: string) => {
                try { return new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); } catch { return d; }
              },
              dateFormatter: (d: string) => {
                try { return new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' }); } catch { return d; }
              },
            } : {})}
          />
        ) : (
          <div className="flex items-center justify-center h-[300px] text-black/25 text-sm">
            {portfolioChartData ? 'No chart data available' : 'Loading portfolio chart...'}
          </div>
        )}
      </Card>

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
                  {['Symbol', 'Category', 'Qty', 'Price', 'Mkt Value', 'Weight', 'Volume', 'Day Chg'].map(
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
                      <Link
                        href={`/ticker?symbol=${pos.symbol}`}
                        onClick={(e) => e.stopPropagation()}
                        className="font-semibold text-sm text-black/85 hover:text-accent-blue transition-colors"
                        title={`View ${pos.symbol} details`}
                      >
                        {pos.symbol}
                      </Link>
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
                    <td className="px-4 py-3 text-sm text-black/45 tabular-nums">
                      {pos.volume > 0 ? formatNumber(pos.volume, { compact: true }) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <TrendIndicator value={pos.dayChangePercent} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-black/[0.08] bg-black/[0.02]">
                  <td className="px-4 py-3 text-sm font-semibold text-black/85">Total</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3 text-sm font-semibold text-black/85 tabular-nums">
                    {formatCurrency(portfolio.portfolioValue)}
                  </td>
                  <td className="px-4 py-3 text-sm text-black/55 tabular-nums">100%</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <TrendIndicator value={portfolio.dayChangePercent} />
                      <span className={`text-xs tabular-nums ${portfolio.dayChange >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                        ({portfolio.dayChange >= 0 ? '+' : ''}{formatCurrency(portfolio.dayChange)})
                      </span>
                    </div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* Selected Position Detail */}
      {selectedSymbol && selectedPosition && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <CardTitle>{selectedSymbol} — Price Chart</CardTitle>
              {rsiBadge && (
                <Badge variant={rsiBadge.variant}>{rsiBadge.label}</Badge>
              )}
            </div>
            <div className="flex gap-1">
              {CHART_TIMEFRAMES.map((tf) => (
                <button
                  key={tf.value}
                  onClick={() => setChartTimeframe(tf.value)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                    chartTimeframe === tf.value
                      ? 'bg-black/[0.08] text-black/85'
                      : 'text-black/40 hover:text-black/65 hover:bg-black/[0.03]'
                  }`}
                >
                  {tf.label}
                </button>
              ))}
            </div>
          </div>

          {/* Intraday stats row */}
          {selectedPosition.open > 0 && (
            <div className="grid grid-cols-4 gap-4 mb-4 p-3 bg-black/[0.02] rounded-lg">
              <div>
                <p className="text-xs text-black/40">Open</p>
                <p className="text-sm font-medium text-black/75 tabular-nums">{formatCurrency(selectedPosition.open)}</p>
              </div>
              <div>
                <p className="text-xs text-black/40">High</p>
                <p className="text-sm font-medium text-black/75 tabular-nums">{formatCurrency(selectedPosition.high)}</p>
              </div>
              <div>
                <p className="text-xs text-black/40">Low</p>
                <p className="text-sm font-medium text-black/75 tabular-nums">{formatCurrency(selectedPosition.low)}</p>
              </div>
              <div>
                <p className="text-xs text-black/40">Volume</p>
                <p className="text-sm font-medium text-black/75 tabular-nums">{formatNumber(selectedPosition.volume, { compact: true })}</p>
              </div>
            </div>
          )}

          {chartData ? (
            <TimeSeriesChart
              data={chartData.map((d) => ({ date: d.date, value: d.close }))}
              color="auto"
              height={300}
              gradientId={`pos-${selectedSymbol}`}
              valueFormatter={(v) => formatCurrency(v)}
            />
          ) : (
            <div className="flex items-center justify-center h-[300px] text-black/25 text-sm">
              Loading chart data...
            </div>
          )}
        </Card>
      )}

      {/* Fundamentals Score — Portfolio */}
      <FundamentalsScoreSection
        scores={portfolioScores}
        loading={scoresLoading}
        error={scoresError}
        title="Portfolio Fundamental Scores"
        subtitle="Composite fundamental analysis for your held positions — ranked by score"
      />

      {/* Dividend Calendar */}
      {dividends && dividends.length > 0 && (
        <Card padding="none">
          <div className="px-6 pt-6 pb-3">
            <CardTitle>Dividend Calendar</CardTitle>
            <p className="text-xs text-black/40 mt-1">Recent and upcoming dividends for your holdings</p>
          </div>
          <div className="divide-y divide-black/[0.04]">
            {dividends.slice(0, 20).map((div, i) => {
              const isUpcoming = new Date(div.exDate) >= new Date();
              return (
                <div
                  key={`${div.ticker}-${div.exDate}-${i}`}
                  className="flex items-center justify-between px-6 py-3.5"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-black/85 w-12">{div.ticker}</span>
                    <div>
                      <p className="text-sm text-black/65">
                        {formatCurrency(div.amount)}/share
                      </p>
                      <p className="text-xs text-black/35">
                        {FREQ_LABELS[div.frequency] || 'Other'} {div.type !== 'CD' ? `(${div.type})` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-2">
                      {isUpcoming && (
                        <Badge variant="green">Upcoming</Badge>
                      )}
                      <p className="text-xs text-black/55">Ex: {div.exDate}</p>
                    </div>
                    {div.payDate && (
                      <p className="text-xs text-black/35 mt-0.5">Pay: {div.payDate}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* ═══ Watching Section ═══ */}
      {watchlist && watchlist.length > 0 && (
        <>
          <div className="pt-4 border-t border-black/[0.06] flex items-end justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-black/85 tracking-tight">Watching</h2>
              <p className="text-sm text-black/45 mt-1">Stocks you&apos;re tracking — no position held</p>
            </div>
            <Link
              href="/watchlist-analytics"
              className="text-sm font-medium text-accent-blue hover:text-accent-blue/80 transition-colors"
            >
              Watchlist Analytics &rarr;
            </Link>
          </div>

          {/* Watchlist Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {(() => {
              const gainers = [...watchlist].sort((a, b) => b.dayChangePercent - a.dayChangePercent);
              const topGainer = gainers[0];
              const topLoser = gainers[gainers.length - 1];
              const avgChange = watchlist.reduce((s, w) => s + w.dayChangePercent, 0) / watchlist.length;
              const categories = new Set(watchlist.map((w) => w.category));
              return (
                <>
                  <MetricCard
                    label="Stocks Watched"
                    value={watchlist.length.toString()}
                    change={`${categories.size} sectors`}
                    changeLabel=""
                  />
                  <MetricCard
                    label="Avg Day Change"
                    value={formatPercent(avgChange)}
                    trend={avgChange >= 0 ? 'up' : 'down'}
                  />
                  <MetricCard
                    label="Top Gainer"
                    value={topGainer.symbol}
                    change={formatPercent(topGainer.dayChangePercent)}
                    trend="up"
                  />
                  <MetricCard
                    label="Top Loser"
                    value={topLoser.symbol}
                    change={formatPercent(topLoser.dayChangePercent)}
                    trend="down"
                  />
                </>
              );
            })()}
          </div>

          {/* Watchlist Table */}
          <Card padding="none">
            <div className="px-6 pt-6 pb-3">
              <CardTitle>Watchlist Positions</CardTitle>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-black/[0.06]">
                    {['Symbol', 'Category', 'Price', 'Open', 'High', 'Low', 'Volume', 'Day Chg'].map(
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
                  {watchlist.map((pos) => (
                    <tr
                      key={pos.symbol}
                      onClick={() => setWatchSelectedSymbol(pos.symbol === watchSelectedSymbol ? null : pos.symbol)}
                      className={`border-b border-black/[0.03] cursor-pointer transition-colors ${
                        watchSelectedSymbol === pos.symbol
                          ? 'bg-accent-blue/[0.04]'
                          : 'hover:bg-black/[0.02]'
                      }`}
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/ticker?symbol=${pos.symbol}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-semibold text-sm text-black/85 hover:text-accent-blue transition-colors"
                          title={`View ${pos.symbol} details`}
                        >
                          {pos.symbol}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={watchCategoryBadge(pos.category)}>{pos.category}</Badge>
                      </td>
                      <td className="px-4 py-3 text-sm text-black/85 font-medium tabular-nums">
                        {formatCurrency(pos.currentPrice)}
                      </td>
                      <td className="px-4 py-3 text-sm text-black/55 tabular-nums">
                        {pos.open > 0 ? formatCurrency(pos.open) : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-black/55 tabular-nums">
                        {pos.high > 0 ? formatCurrency(pos.high) : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-black/55 tabular-nums">
                        {pos.low > 0 ? formatCurrency(pos.low) : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-black/45 tabular-nums">
                        {pos.volume > 0 ? formatNumber(pos.volume, { compact: true }) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <TrendIndicator value={pos.dayChangePercent} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Watchlist Selected Detail */}
          {watchSelectedSymbol && watchSelectedPosition && (
            <Card>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <CardTitle>{watchSelectedSymbol} — Price Chart</CardTitle>
                  {watchRsiBadge && (
                    <Badge variant={watchRsiBadge.variant}>{watchRsiBadge.label}</Badge>
                  )}
                </div>
                <div className="flex gap-1">
                  {CHART_TIMEFRAMES.map((tf) => (
                    <button
                      key={tf.value}
                      onClick={() => setWatchChartTimeframe(tf.value)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                        watchChartTimeframe === tf.value
                          ? 'bg-black/[0.08] text-black/85'
                          : 'text-black/40 hover:text-black/65 hover:bg-black/[0.03]'
                      }`}
                    >
                      {tf.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Intraday stats row */}
              {watchSelectedPosition.open > 0 && (
                <div className="grid grid-cols-4 gap-4 mb-4 p-3 bg-black/[0.02] rounded-lg">
                  <div>
                    <p className="text-xs text-black/40">Open</p>
                    <p className="text-sm font-medium text-black/75 tabular-nums">{formatCurrency(watchSelectedPosition.open)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-black/40">High</p>
                    <p className="text-sm font-medium text-black/75 tabular-nums">{formatCurrency(watchSelectedPosition.high)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-black/40">Low</p>
                    <p className="text-sm font-medium text-black/75 tabular-nums">{formatCurrency(watchSelectedPosition.low)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-black/40">Volume</p>
                    <p className="text-sm font-medium text-black/75 tabular-nums">{formatNumber(watchSelectedPosition.volume, { compact: true })}</p>
                  </div>
                </div>
              )}

              {watchChartData ? (
                <TimeSeriesChart
                  data={watchChartData.map((d) => ({ date: d.date, value: d.close }))}
                  color="auto"
                  height={300}
                  gradientId={`watch-${watchSelectedSymbol}`}
                  valueFormatter={(v) => formatCurrency(v)}
                />
              ) : (
                <div className="flex items-center justify-center h-[300px] text-black/25 text-sm">
                  Loading chart data...
                </div>
              )}
            </Card>
          )}

          {/* Fundamentals Score — Watchlist */}
          <FundamentalsScoreSection
            scores={watchlistScores}
            loading={watchScoresLoading}
            error={watchScoresError}
            title="Watchlist Fundamental Scores"
            subtitle="Composite fundamental analysis for watched stocks — ranked by score"
          />
        </>
      )}
    </div>
  );
}
