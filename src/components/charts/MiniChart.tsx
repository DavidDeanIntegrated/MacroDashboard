'use client';

import { ResponsiveContainer, AreaChart, Area } from 'recharts';

interface MiniChartProps {
  data: Array<{ value: number }>;
  color?: string;
  height?: number;
  width?: number;
}

export function MiniChart({
  data,
  color = '#007AFF',
  height = 32,
  width = 80,
}: MiniChartProps) {
  if (!data || data.length < 2) return null;

  // Determine color from trend
  const first = data[0].value;
  const last = data[data.length - 1].value;
  const trendColor = color === 'auto'
    ? (last >= first ? '#34C759' : '#FF3B30')
    : color;

  return (
    <div style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
          <defs>
            <linearGradient id={`mini-${trendColor}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={trendColor} stopOpacity={0.15} />
              <stop offset="100%" stopColor={trendColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={trendColor}
            strokeWidth={1.5}
            fill={`url(#mini-${trendColor})`}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
