'use client';

import type { RegimeStatus } from '@/lib/hooks';

// Shown wherever regime-adjusted targets are drawn, so "still loading" or "failed to load"
// is never mistaken for the economy's regime genuinely being unclear.
export function RegimeStatusNote({
  status,
  error,
  onRetry,
}: {
  status: RegimeStatus;
  error?: string | null;
  onRetry?: () => void;
}) {
  if (status === 'ready') return null;
  if (status === 'loading') {
    return (
      <p role="status" className="mt-3 text-xs text-black/50 flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full bg-accent-blue animate-pulse shrink-0" />
        Loading the current economic regime — regime-adjusted targets appear when it arrives.
      </p>
    );
  }
  return (
    <div role="alert" className="mt-3 text-xs text-black/60 bg-accent-orange/10 rounded-lg px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <span>
        Couldn&apos;t load the economic regime{error ? ` (${error})` : ''}. Targets below are the baseline bands, not adjusted for the current season.
      </span>
      {onRetry && (
        <button onClick={onRetry} className="font-medium text-accent-blue hover:text-accent-blue/80">
          Try again
        </button>
      )}
    </div>
  );
}
