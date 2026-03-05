'use client';

import { useState, useCallback } from 'react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
} from 'recharts';

interface AllocationEntry {
  name: string;
  value: number;
  color: string;
}

interface AllocationPieChartProps {
  data: AllocationEntry[];
  height?: number;
}

export function AllocationPieChart({ data, height = 280 }: AllocationPieChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);

  const onEnter = useCallback((_: unknown, index: number) => {
    setActiveIndex(index);
  }, []);

  const onLeave = useCallback(() => {
    setActiveIndex(undefined);
  }, []);

  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center text-black/25 text-sm" style={{ height }}>
        No data available
      </div>
    );
  }

  return (
    <div className="flex flex-col md:flex-row items-center gap-6">
      {/* Pie chart */}
      <div className="w-full md:w-1/2" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={2}
              dataKey="value"
              onMouseEnter={onEnter}
              onMouseLeave={onLeave}
              stroke="none"
            >
              {data.map((entry, index) => (
                <Cell
                  key={index}
                  fill={entry.color}
                  opacity={activeIndex === undefined || activeIndex === index ? 1 : 0.4}
                  style={{
                    transform: activeIndex === index ? 'scale(1.05)' : 'scale(1)',
                    transformOrigin: 'center',
                    transition: 'transform 0.2s ease, opacity 0.2s ease',
                  }}
                />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload || !payload[0]) return null;
                const d = payload[0].payload as AllocationEntry;
                return (
                  <div className="bg-white/95 backdrop-blur-xl border border-black/[0.06] rounded-xl shadow-lg px-3 py-2">
                    <p className="text-sm font-semibold text-black/85">{d.name}</p>
                    <p className="text-sm text-black/55 tabular-nums">{d.value.toFixed(1)}%</p>
                  </div>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="w-full md:w-1/2 grid grid-cols-2 gap-x-4 gap-y-2">
        {data.map((entry, index) => (
          <button
            key={entry.name}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors text-left ${
              activeIndex === index ? 'bg-black/[0.04]' : 'hover:bg-black/[0.02]'
            }`}
            onMouseEnter={() => setActiveIndex(index)}
            onMouseLeave={() => setActiveIndex(undefined)}
          >
            <div
              className="w-3 h-3 rounded-sm shrink-0"
              style={{ backgroundColor: entry.color }}
            />
            <div className="min-w-0">
              <p className="text-xs font-medium text-black/70 truncate">{entry.name}</p>
              <p className="text-xs text-black/40 tabular-nums">{entry.value.toFixed(1)}%</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
