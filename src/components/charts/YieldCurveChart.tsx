'use client';

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';

interface YieldCurvePoint {
  maturity: string;
  yield: number;
}

const MATURITY_LABELS: Record<string, string> = {
  DGS3MO: '3M',
  DGS2: '2Y',
  DGS5: '5Y',
  DGS10: '10Y',
  DGS30: '30Y',
};

export function YieldCurveChart({
  data,
  height = 250,
}: {
  data: Array<{ id: string; value: number | null }>;
  height?: number;
}) {
  const chartData: YieldCurvePoint[] = data
    .filter((d) => d.value !== null)
    .map((d) => ({
      maturity: MATURITY_LABELS[d.id] || d.id,
      yield: d.value!,
    }));

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center text-black/25 text-sm" style={{ height }}>
        No yield curve data
      </div>
    );
  }

  // Detect inversion
  const shortYield = chartData[0]?.yield || 0;
  const longYield = chartData[chartData.length - 1]?.yield || 0;
  const isInverted = shortYield > longYield;

  return (
    <div>
      {isInverted && (
        <div className="mb-2 px-3 py-1.5 bg-accent-red/8 rounded-lg inline-flex items-center">
          <div className="w-1.5 h-1.5 rounded-full bg-accent-red mr-2" />
          <span className="text-xs font-medium text-accent-red">Yield Curve Inverted</span>
        </div>
      )}

      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="yieldGradient" x1="0" y1="0" x2="0" y2="1">
              <stop
                offset="0%"
                stopColor={isInverted ? '#FF3B30' : '#007AFF'}
                stopOpacity={0.15}
              />
              <stop
                offset="100%"
                stopColor={isInverted ? '#FF3B30' : '#007AFF'}
                stopOpacity={0.02}
              />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />

          <XAxis
            dataKey="maturity"
            tick={{ fontSize: 12, fill: 'rgba(0,0,0,0.45)', fontWeight: 500 }}
            axisLine={{ stroke: 'rgba(0,0,0,0.06)' }}
            tickLine={false}
          />

          <YAxis
            tick={{ fontSize: 11, fill: 'rgba(0,0,0,0.35)' }}
            axisLine={false}
            tickLine={false}
            width={40}
            tickFormatter={(v) => `${v.toFixed(1)}%`}
          />

          <ReferenceLine y={0} stroke="rgba(0,0,0,0.1)" strokeDasharray="4 4" />

          <Tooltip
            contentStyle={{
              backgroundColor: 'rgba(255,255,255,0.95)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(0,0,0,0.06)',
              borderRadius: '12px',
              boxShadow: '0 8px 30px rgba(0,0,0,0.08)',
              padding: '8px 12px',
              fontSize: '13px',
            }}
            formatter={(value) => [`${Number(value).toFixed(3)}%`, 'Yield']}
          />

          <Area
            type="monotone"
            dataKey="yield"
            stroke={isInverted ? '#FF3B30' : '#007AFF'}
            strokeWidth={2}
            fill="url(#yieldGradient)"
            dot={{
              fill: isInverted ? '#FF3B30' : '#007AFF',
              stroke: '#fff',
              strokeWidth: 2,
              r: 4,
            }}
            activeDot={{
              fill: isInverted ? '#FF3B30' : '#007AFF',
              stroke: '#fff',
              strokeWidth: 2,
              r: 6,
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
