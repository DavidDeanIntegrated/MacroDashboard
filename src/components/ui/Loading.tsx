'use client';

export function LoadingSpinner({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizeMap = {
    sm: 'h-4 w-4',
    md: 'h-6 w-6',
    lg: 'h-10 w-10',
  };

  return (
    <div className="flex items-center justify-center">
      <div
        className={`${sizeMap[size]} animate-spin rounded-full border-2 border-black/10 border-t-accent-blue`}
      />
    </div>
  );
}

export function LoadingCard() {
  return (
    <div className="bg-white/72 backdrop-blur-xl rounded-2xl border border-black/[0.06] shadow-card p-6">
      <div className="animate-pulse space-y-4">
        <div className="h-3 bg-black/[0.06] rounded-full w-1/3" />
        <div className="h-8 bg-black/[0.06] rounded-lg w-2/3" />
        <div className="h-3 bg-black/[0.06] rounded-full w-1/2" />
      </div>
    </div>
  );
}

export function LoadingPage() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 animate-fade-in">
      {Array.from({ length: 8 }).map((_, i) => (
        <LoadingCard key={i} />
      ))}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="bg-white/72 backdrop-blur-xl rounded-2xl border border-accent-red/20 shadow-card p-8 text-center">
      <div className="w-12 h-12 rounded-full bg-accent-red/10 flex items-center justify-center mx-auto mb-4">
        <svg className="w-6 h-6 text-accent-red" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      </div>
      <p className="text-sm text-black/55 mb-4">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 text-sm font-medium text-accent-blue bg-accent-blue/10 rounded-lg hover:bg-accent-blue/20 transition-colors"
        >
          Try Again
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="bg-white/72 backdrop-blur-xl rounded-2xl border border-black/[0.06] shadow-card p-12 text-center">
      <div className="w-16 h-16 rounded-full bg-black/[0.03] flex items-center justify-center mx-auto mb-4">
        <svg className="w-8 h-8 text-black/20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
      </div>
      <h3 className="text-base font-semibold text-black/85 mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-black/45">{description}</p>
      )}
    </div>
  );
}
