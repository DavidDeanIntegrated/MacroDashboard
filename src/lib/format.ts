// Formatting utilities for the dashboard

export function formatCurrency(
  value: number,
  options?: { compact?: boolean; decimals?: number }
): string {
  if (!Number.isFinite(value)) return '—';
  const { compact = false, decimals } = options || {};

  if (compact) {
    if (Math.abs(value) >= 1e12) return `$${(value / 1e12).toFixed(1)}T`;
    if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals ?? 2,
    maximumFractionDigits: decimals ?? 2,
  }).format(value);
}

export function formatPercent(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

export function formatNumber(
  value: number,
  options?: { compact?: boolean; decimals?: number }
): string {
  if (!Number.isFinite(value)) return '—';
  const { compact = false, decimals = 2 } = options || {};

  if (compact) {
    if (Math.abs(value) >= 1e12) return `${(value / 1e12).toFixed(1)}T`;
    if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
    if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
    if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  }

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatDate(dateStr: string, style: 'short' | 'medium' | 'long' = 'medium'): string {
  const date = new Date(dateStr);
  const options: Intl.DateTimeFormatOptions =
    style === 'short'
      ? { month: 'numeric', day: 'numeric' }
      : style === 'long'
        ? { year: 'numeric', month: 'long', day: 'numeric' }
        : { year: 'numeric', month: 'short', day: 'numeric' };

  return date.toLocaleDateString('en-US', options);
}

export function timeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp * 1000;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return formatDate(new Date(timestamp * 1000).toISOString(), 'short');
}

export function classNames(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
