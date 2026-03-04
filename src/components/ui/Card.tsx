'use client';

import { ReactNode } from 'react';

interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hover?: boolean;
  onClick?: () => void;
}

const paddingMap = {
  none: '',
  sm: 'p-4',
  md: 'p-6',
  lg: 'p-8',
};

export function Card({
  children,
  className = '',
  padding = 'md',
  hover = false,
  onClick,
}: CardProps) {
  return (
    <div
      className={`
        bg-white/72 backdrop-blur-xl rounded-2xl border border-black/[0.06]
        shadow-card
        ${paddingMap[padding]}
        ${hover ? 'transition-all duration-200 hover:shadow-elevated hover:scale-[1.01] cursor-pointer' : ''}
        ${className}
      `}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mb-4 ${className}`}>
      {children}
    </div>
  );
}

export function CardTitle({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <h3 className={`text-sm font-semibold text-black/55 uppercase tracking-wider ${className}`}>
      {children}
    </h3>
  );
}

export function MetricCard({
  label,
  value,
  change,
  changeLabel,
  trend,
  className = '',
}: {
  label: string;
  value: string;
  change?: string;
  changeLabel?: string;
  trend?: 'up' | 'down' | 'neutral';
  className?: string;
}) {
  const trendColor =
    trend === 'up'
      ? 'text-accent-green'
      : trend === 'down'
        ? 'text-accent-red'
        : 'text-black/55';

  return (
    <Card className={className}>
      <p className="text-xs font-medium text-black/45 uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className="text-2xl font-semibold text-black/85 tracking-tight">
        {value}
      </p>
      {change && (
        <p className={`text-sm font-medium mt-1 ${trendColor}`}>
          {change}
          {changeLabel && (
            <span className="text-black/35 ml-1 font-normal">{changeLabel}</span>
          )}
        </p>
      )}
    </Card>
  );
}

export function StatRow({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-black/[0.04] last:border-0">
      <span className="text-sm text-black/55">{label}</span>
      <span className={`text-sm font-medium ${valueColor || 'text-black/85'}`}>
        {value}
      </span>
    </div>
  );
}
