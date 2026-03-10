'use client';

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { format, parseISO } from 'date-fns';

interface TimeSeriesChartProps {
  data: Array<{ date: string; value: number }>;
  color?: string;
  height?: number;
  showGrid?: boolean;
  showAxis?: boolean;
  gradientId?: string;
  valueFormatter?: (value: number) => string;
  dateFormatter?: (date: string) => string;
  xAxisFormatter?: (date: string) => string;
  compact?: boolean;
  autoScale?: boolean;
}

export function TimeSeriesChart({
  data,
  color = '#007AFF',
  height = 200,
  showGrid = true,
  showAxis = true,
  gradientId = 'chartGradient',
  valueFormatter = (v) => v.toFixed(2),
  dateFormatter,
  xAxisFormatter,
  compact = false,
  autoScale = false,
}: TimeSeriesChartProps) {
  if (!data || data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-black/25 text-sm"
        style={{ height }}
      >
        No data available
      </div>
    );
  }

  const formatDate = dateFormatter || ((d: string) => {
    try {
      return format(parseISO(d), compact ? 'MMM yy' : 'MMM d, yyyy');
    } catch {
      return d;
    }
  });

  const formatXAxis = xAxisFormatter || ((d: string) => {
    try {
      return format(parseISO(d), 'MMM yy');
    } catch {
      return d;
    }
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: compact ? 0 : 4 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.12} />
            <stop offset="100%" stopColor={color} stopOpacity={0.01} />
          </linearGradient>
        </defs>

        {showGrid && (
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(0,0,0,0.04)"
            vertical={false}
          />
        )}

        {showAxis && (
          <XAxis
            dataKey="date"
            tickFormatter={formatXAxis}
            tick={{ fontSize: 11, fill: 'rgba(0,0,0,0.35)' }}
            axisLine={{ stroke: 'rgba(0,0,0,0.06)' }}
            tickLine={false}
            minTickGap={50}
          />
        )}

        {showAxis && (
          <YAxis
            domain={autoScale ? ['auto', 'auto'] : undefined}
            tick={{ fontSize: 11, fill: 'rgba(0,0,0,0.35)' }}
            axisLine={false}
            tickLine={false}
            width={compact ? 40 : 50}
            tickFormatter={(v) => {
              if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(0)}B`;
              if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
              if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
              return v.toFixed(1);
            }}
          />
        )}

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
          labelFormatter={(label) => formatDate(String(label))}
          formatter={(value) => [valueFormatter(Number(value)), '']}
          cursor={{ stroke: 'rgba(0,0,0,0.1)', strokeWidth: 1 }}
        />

        <Area
          type="monotone"
          dataKey="value"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{
            r: 4,
            fill: color,
            stroke: '#fff',
            strokeWidth: 2,
          }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// Multi-line chart for overlaying series
interface MultiSeriesData {
  date: string;
  [key: string]: string | number;
}

interface SeriesConfig {
  key: string;
  color: string;
  name: string;
}

export function MultiSeriesChart({
  data,
  series,
  height = 300,
}: {
  data: MultiSeriesData[];
  series: SeriesConfig[];
  height?: number;
}) {
  if (!data || data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-black/25 text-sm"
        style={{ height }}
      >
        No data available
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.04)" vertical={false} />

        <XAxis
          dataKey="date"
          tickFormatter={(d) => {
            try { return format(parseISO(d), 'MMM yy'); } catch { return d; }
          }}
          tick={{ fontSize: 11, fill: 'rgba(0,0,0,0.35)' }}
          axisLine={{ stroke: 'rgba(0,0,0,0.06)' }}
          tickLine={false}
          minTickGap={50}
        />

        <YAxis
          tick={{ fontSize: 11, fill: 'rgba(0,0,0,0.35)' }}
          axisLine={false}
          tickLine={false}
          width={50}
        />

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
          labelFormatter={(d) => {
            try { return format(parseISO(d as string), 'MMM d, yyyy'); } catch { return d as string; }
          }}
        />

        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            strokeWidth={1.5}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
