'use client';

type BadgeVariant = 'green' | 'red' | 'orange' | 'blue' | 'purple' | 'neutral' | 'yellow';

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
}

const variantStyles: Record<BadgeVariant, string> = {
  green: 'bg-accent-green/10 text-accent-green',
  red: 'bg-accent-red/10 text-accent-red',
  orange: 'bg-accent-orange/10 text-accent-orange',
  blue: 'bg-accent-blue/10 text-accent-blue',
  purple: 'bg-accent-purple/10 text-accent-purple',
  yellow: 'bg-accent-yellow/15 text-yellow-700',
  neutral: 'bg-black/[0.05] text-black/55',
};

export function Badge({ children, variant = 'neutral', size = 'sm' }: BadgeProps) {
  return (
    <span
      className={`
        inline-flex items-center font-medium rounded-full
        ${variantStyles[variant]}
        ${size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'}
      `}
    >
      {children}
    </span>
  );
}

export function RegimeBadge({ regime }: { regime: string }) {
  const variantMap: Record<string, BadgeVariant> = {
    goldilocks: 'green',
    reflation: 'orange',
    stagflation: 'red',
    deflation: 'blue',
    unknown: 'neutral',
  };

  // Classic nickname for the season; the full plain-English label sits next to it.
  const nickname: Record<string, string> = { goldilocks: 'Goldilocks', reflation: 'Reflation', stagflation: 'Stagflation', deflation: 'Slowdown', unknown: 'Mixed' };
  return (
    <Badge variant={variantMap[regime] || 'neutral'} size="md">
      {nickname[regime] ?? regime.charAt(0).toUpperCase() + regime.slice(1)}
    </Badge>
  );
}

export function TrendIndicator({
  value,
  suffix = '%',
  showArrow = true,
}: {
  value: number;
  suffix?: string;
  showArrow?: boolean;
}) {
  const isPositive = value > 0;
  const isNeutral = value === 0;

  return (
    <span
      className={`inline-flex items-center text-sm font-medium ${
        isNeutral
          ? 'text-black/45'
          : isPositive
            ? 'text-accent-green'
            : 'text-accent-red'
      }`}
    >
      {showArrow && !isNeutral && (
        <svg
          className={`w-3.5 h-3.5 mr-0.5 ${isPositive ? '' : 'rotate-180'}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z"
            clipRule="evenodd"
          />
        </svg>
      )}
      {isPositive ? '+' : ''}
      {value.toFixed(2)}
      {suffix}
    </span>
  );
}
