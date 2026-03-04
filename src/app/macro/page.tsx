'use client';

import { useState } from 'react';
import { Card, CardTitle, MetricCard, StatRow } from '@/components/ui/Card';
import { LoadingPage, ErrorState } from '@/components/ui/Loading';
import { RegimeBadge } from '@/components/ui/Badge';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import { YieldCurveChart } from '@/components/charts/YieldCurveChart';
import { useApi, useYieldCurve } from '@/lib/hooks';
import { formatPercent, formatNumber } from '@/lib/format';
import { FRED_SERIES_NAMES } from '@/lib/fred';

interface MacroDashboard {
  fedFunds: Array<{ date: string; value: number }>;
  t2y: Array<{ date: string; value: number }>;
  t10y: Array<{ date: string; value: number }>;
  t10y2y: Array<{ date: string; value: number }>;
  cpi: Array<{ date: string; value: number }>;
  cpiYoY: Array<{ date: string; value: number }>;
  unemployment: Array<{ date: string; value: number }>;
  highYieldSpread: Array<{ date: string; value: number }>;
  industrialProduction: Array<{ date: string; value: number }>;
  regime: {
    regime: string;
    label: string;
    description: string;
    inflationTrend: string;
    growthTrend: string;
    latestInflation: number;
    latestUnemployment: number;
  };
}

type ChartPeriod = '1Y' | '3Y' | '5Y' | '10Y' | 'MAX';

const periodMap: Record<ChartPeriod, number> = {
  '1Y': 12,
  '3Y': 36,
  '5Y': 60,
  '10Y': 120,
  MAX: 999,
};

function filterByPeriod(
  data: Array<{ date: string; value: number }>,
  period: ChartPeriod
): Array<{ date: string; value: number }> {
  if (period === 'MAX') return data;
  const months = periodMap[period];
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return data.filter((d) => new Date(d.date) >= cutoff);
}

function getLatest(data: Array<{ date: string; value: number }>): number {
  return data.length > 0 ? data[data.length - 1].value : 0;
}

function getChange(data: Array<{ date: string; value: number }>, periods = 1): number {
  if (data.length < periods + 1) return 0;
  return data[data.length - 1].value - data[data.length - 1 - periods].value;
}

export default function MacroPage() {
  const { data, error, loading, refresh } = useApi<MacroDashboard>('/api/fred?action=dashboard');
  const { data: yieldCurve } = useYieldCurve();
  const [period, setPeriod] = useState<ChartPeriod>('3Y');

  if (loading) return <LoadingPage />;
  if (error) return <ErrorState message={error} onRetry={refresh} />;
  if (!data) return null;

  const regime = data.regime;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-black/85 tracking-tight">Macro Overview</h2>
          <p className="text-sm text-black/45 mt-1">
            Economic indicators and macro regime analysis
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(['1Y', '3Y', '5Y', '10Y', 'MAX'] as ChartPeriod[]).map((p) => (
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

      {/* Macro Regime Banner */}
      <Card className="bg-gradient-to-r from-white/80 to-white/60">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-black/45 uppercase tracking-wider mb-2">
              Current Macro Regime
            </p>
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-xl font-semibold text-black/85">{regime.label}</h3>
              <RegimeBadge regime={regime.regime} />
            </div>
            <p className="text-sm text-black/55 max-w-xl leading-relaxed">
              {regime.description}
            </p>
          </div>
          <div className="text-right space-y-2 shrink-0 ml-8">
            <div>
              <p className="text-xxs text-black/35 uppercase">Inflation (YoY)</p>
              <p className="text-lg font-semibold tabular-nums text-black/85">
                {formatPercent(regime.latestInflation)}
              </p>
            </div>
            <div>
              <p className="text-xxs text-black/35 uppercase">Unemployment</p>
              <p className="text-lg font-semibold tabular-nums text-black/85">
                {regime.latestUnemployment.toFixed(1)}%
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Key metrics row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="Fed Funds Rate"
          value={`${getLatest(data.fedFunds).toFixed(2)}%`}
          change={formatPercent(getChange(data.fedFunds))}
          trend={getChange(data.fedFunds) > 0 ? 'up' : getChange(data.fedFunds) < 0 ? 'down' : 'neutral'}
        />
        <MetricCard
          label="10Y Treasury"
          value={`${getLatest(data.t10y).toFixed(2)}%`}
          change={formatPercent(getChange(data.t10y))}
          trend={getChange(data.t10y) > 0 ? 'up' : 'down'}
        />
        <MetricCard
          label="CPI YoY"
          value={formatPercent(getLatest(data.cpiYoY))}
          change={formatPercent(getChange(data.cpiYoY))}
          changeLabel="vs prev"
          trend={getChange(data.cpiYoY) > 0 ? 'up' : 'down'}
        />
        <MetricCard
          label="HY Spread"
          value={`${getLatest(data.highYieldSpread).toFixed(2)}%`}
          change={formatPercent(getChange(data.highYieldSpread))}
          trend={getChange(data.highYieldSpread) > 0 ? 'up' : 'down'}
        />
      </div>

      {/* Yield Curve */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardTitle>Yield Curve (Live)</CardTitle>
          {yieldCurve && <YieldCurveChart data={yieldCurve} height={280} />}
        </Card>

        <Card>
          <CardTitle>10Y-2Y Spread (Historical)</CardTitle>
          <TimeSeriesChart
            data={filterByPeriod(data.t10y2y, period)}
            color="#5856D6"
            height={280}
            gradientId="t10y2y"
            valueFormatter={(v) => `${v.toFixed(2)}%`}
          />
        </Card>
      </div>

      {/* Inflation */}
      <Card>
        <CardTitle>Inflation — CPI Year-over-Year</CardTitle>
        <TimeSeriesChart
          data={filterByPeriod(data.cpiYoY, period)}
          color="#FF9500"
          height={280}
          gradientId="cpiYoY"
          valueFormatter={(v) => `${v.toFixed(2)}%`}
        />
      </Card>

      {/* Rates + Labor */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardTitle>Fed Funds Rate</CardTitle>
          <TimeSeriesChart
            data={filterByPeriod(data.fedFunds, period)}
            color="#007AFF"
            height={250}
            gradientId="fedFunds"
            valueFormatter={(v) => `${v.toFixed(2)}%`}
          />
        </Card>

        <Card>
          <CardTitle>Unemployment Rate</CardTitle>
          <TimeSeriesChart
            data={filterByPeriod(data.unemployment, period)}
            color="#FF3B30"
            height={250}
            gradientId="unemployment"
            valueFormatter={(v) => `${v.toFixed(1)}%`}
          />
        </Card>
      </div>

      {/* Credit + Industrial Production */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardTitle>High Yield Credit Spread</CardTitle>
          <TimeSeriesChart
            data={filterByPeriod(data.highYieldSpread, period)}
            color="#AF52DE"
            height={250}
            gradientId="hySpread"
            valueFormatter={(v) => `${v.toFixed(2)}%`}
          />
        </Card>

        <Card>
          <CardTitle>Industrial Production Index</CardTitle>
          <TimeSeriesChart
            data={filterByPeriod(data.industrialProduction, period)}
            color="#34C759"
            height={250}
            gradientId="indProd"
            valueFormatter={(v) => formatNumber(v, { decimals: 1 })}
          />
        </Card>
      </div>

      {/* Macro Indicators Table */}
      <Card>
        <CardTitle>Key Indicators Summary</CardTitle>
        <div className="mt-2">
          {[
            { label: FRED_SERIES_NAMES['FEDFUNDS'], data: data.fedFunds, suffix: '%' },
            { label: FRED_SERIES_NAMES['DGS2'], data: data.t2y, suffix: '%' },
            { label: FRED_SERIES_NAMES['DGS10'], data: data.t10y, suffix: '%' },
            { label: FRED_SERIES_NAMES['T10Y2Y'], data: data.t10y2y, suffix: '%' },
            { label: 'CPI YoY Inflation', data: data.cpiYoY, suffix: '%' },
            { label: FRED_SERIES_NAMES['UNRATE'], data: data.unemployment, suffix: '%' },
            { label: FRED_SERIES_NAMES['BAMLH0A0HYM2'], data: data.highYieldSpread, suffix: '%' },
          ].map((indicator) => {
            const latest = getLatest(indicator.data);
            const change = getChange(indicator.data);
            return (
              <StatRow
                key={indicator.label}
                label={indicator.label}
                value={`${latest.toFixed(2)}${indicator.suffix}`}
                valueColor={
                  change > 0.1
                    ? 'text-accent-red'
                    : change < -0.1
                      ? 'text-accent-green'
                      : 'text-black/85'
                }
              />
            );
          })}
        </div>
      </Card>
    </div>
  );
}
