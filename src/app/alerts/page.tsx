'use client';

import { useState, useEffect } from 'react';
import { Card, CardTitle } from '@/components/ui/Card';
import { LoadingCard, EmptyState } from '@/components/ui/Loading';
import { Badge, RegimeBadge } from '@/components/ui/Badge';
import { useMacroRegime, useMarketNews } from '@/lib/hooks';
import { timeAgo } from '@/lib/format';

interface WatchlistItem {
  symbol: string;
}

export default function AlertsPage() {
  const { data: regime, loading: regimeLoading } = useMacroRegime();
  const { data: marketNews, loading: newsLoading } = useMarketNews();
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([
    { symbol: 'AAPL' },
    { symbol: 'MSFT' },
    { symbol: 'GOOGL' },
    { symbol: 'AMZN' },
    { symbol: 'SPY' },
  ]);
  const [newSymbol, setNewSymbol] = useState('');
  const [watchlistFilings, setWatchlistFilings] = useState<Record<string, FilingAlert[]>>({});
  const [loadingFilings, setLoadingFilings] = useState(false);

  // Fetch filings for watchlist
  useEffect(() => {
    async function fetchFilings() {
      setLoadingFilings(true);
      const results: Record<string, FilingAlert[]> = {};

      await Promise.all(
        watchlist.map(async (item) => {
          try {
            const res = await fetch(
              `/api/edgar?action=filings&ticker=${item.symbol}&forms=10-K,10-Q,8-K&count=3`
            );
            if (res.ok) {
              const filings = await res.json();
              results[item.symbol] = filings.map((f: Record<string, string>) => ({
                symbol: item.symbol,
                form: f.form,
                filingDate: f.filingDate,
                description: f.primaryDocDescription,
                url: f.fileUrl,
              }));
            }
          } catch {
            // Skip failed fetches silently
          }
        })
      );

      setWatchlistFilings(results);
      setLoadingFilings(false);
    }

    if (watchlist.length > 0) {
      fetchFilings();
    }
  }, [watchlist]);

  const addToWatchlist = (e: React.FormEvent) => {
    e.preventDefault();
    const sym = newSymbol.trim().toUpperCase();
    if (sym && !watchlist.find((w) => w.symbol === sym)) {
      setWatchlist([...watchlist, { symbol: sym }]);
      setNewSymbol('');
    }
  };

  const removeFromWatchlist = (symbol: string) => {
    setWatchlist(watchlist.filter((w) => w.symbol !== symbol));
  };

  // Flatten and sort all filings by date
  const allFilings: FilingAlert[] = Object.values(watchlistFilings)
    .flat()
    .sort((a, b) => new Date(b.filingDate).getTime() - new Date(a.filingDate).getTime());

  // Regime-based signals
  const regimeSignals = regime
    ? getRegimeSignals(regime.regime, regime.inflationTrend, regime.growthTrend)
    : [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h2 className="text-2xl font-semibold text-black/85 tracking-tight">Signals & Alerts</h2>
        <p className="text-sm text-black/45 mt-1">
          Macro regime signals, filing alerts, and market news
        </p>
      </div>

      {/* Macro Regime Signal */}
      <Card className="bg-gradient-to-r from-white/80 to-white/60">
        <CardTitle>Macro Regime Signal</CardTitle>
        {regimeLoading ? (
          <div className="animate-pulse space-y-3 mt-4">
            <div className="h-6 bg-black/[0.06] rounded w-1/4" />
            <div className="h-4 bg-black/[0.06] rounded w-3/4" />
          </div>
        ) : regime ? (
          <div className="mt-4">
            <div className="flex items-center gap-3 mb-3">
              <h3 className="text-lg font-semibold text-black/85">{regime.label}</h3>
              <RegimeBadge regime={regime.regime} />
            </div>
            <p className="text-sm text-black/55 mb-4">{regime.description}</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="p-3 bg-black/[0.02] rounded-xl">
                <p className="text-xs font-medium text-black/45 uppercase mb-1">Inflation Trend</p>
                <Badge
                  variant={
                    regime.inflationTrend === 'rising' ? 'red' : regime.inflationTrend === 'falling' ? 'green' : 'neutral'
                  }
                >
                  {regime.inflationTrend.charAt(0).toUpperCase() + regime.inflationTrend.slice(1)}
                </Badge>
              </div>
              <div className="p-3 bg-black/[0.02] rounded-xl">
                <p className="text-xs font-medium text-black/45 uppercase mb-1">Growth Trend</p>
                <Badge
                  variant={
                    regime.growthTrend === 'accelerating' ? 'green' : regime.growthTrend === 'decelerating' ? 'red' : 'neutral'
                  }
                >
                  {regime.growthTrend.charAt(0).toUpperCase() + regime.growthTrend.slice(1)}
                </Badge>
              </div>
            </div>

            {/* Regime-based asset recommendations */}
            {regimeSignals.length > 0 && (
              <div className="mt-4 pt-4 border-t border-black/[0.04]">
                <p className="text-xs font-medium text-black/45 uppercase mb-3">Regime Tilts</p>
                <div className="space-y-2">
                  {regimeSignals.map((signal, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div
                        className={`w-2 h-2 rounded-full ${
                          signal.sentiment === 'positive'
                            ? 'bg-accent-green'
                            : signal.sentiment === 'negative'
                              ? 'bg-accent-red'
                              : 'bg-accent-orange'
                        }`}
                      />
                      <span className="text-sm text-black/65">{signal.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </Card>

      {/* Watchlist Management */}
      <Card>
        <CardTitle>Watchlist</CardTitle>
        <form onSubmit={addToWatchlist} className="flex items-center gap-2 mt-3 mb-4">
          <input
            type="text"
            value={newSymbol}
            onChange={(e) => setNewSymbol(e.target.value)}
            placeholder="Add ticker..."
            className="px-3 py-2 text-sm bg-black/[0.03] border border-black/[0.06] rounded-lg focus:outline-none focus:ring-2 focus:ring-accent-blue/30 w-32"
          />
          <button
            type="submit"
            className="px-3 py-2 text-sm font-medium text-accent-blue bg-accent-blue/10 rounded-lg hover:bg-accent-blue/20 transition-colors"
          >
            Add
          </button>
        </form>
        <div className="flex flex-wrap gap-2">
          {watchlist.map((item) => (
            <div
              key={item.symbol}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-black/[0.03] rounded-lg group"
            >
              <span className="text-sm font-medium text-black/75">{item.symbol}</span>
              <button
                onClick={() => removeFromWatchlist(item.symbol)}
                className="text-black/20 hover:text-accent-red transition-colors opacity-0 group-hover:opacity-100"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      </Card>

      {/* Filing Alerts */}
      <Card padding="none">
        <div className="px-6 pt-6 pb-3">
          <CardTitle>Recent Filings (Watchlist)</CardTitle>
        </div>
        {loadingFilings ? (
          <div className="px-6 pb-6">
            <LoadingCard />
          </div>
        ) : allFilings.length === 0 ? (
          <div className="px-6 pb-6">
            <EmptyState title="No recent filings" description="Add tickers to your watchlist to monitor filings." />
          </div>
        ) : (
          <div className="divide-y divide-black/[0.04]">
            {allFilings.slice(0, 15).map((filing, i) => (
              <a
                key={i}
                href={filing.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between px-6 py-3.5 hover:bg-black/[0.02] transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-black/85 w-14">{filing.symbol}</span>
                  <Badge
                    variant={
                      filing.form === '10-K' ? 'blue' : filing.form === '10-Q' ? 'purple' : 'orange'
                    }
                  >
                    {filing.form}
                  </Badge>
                  <span className="text-sm text-black/55">{filing.description || filing.form}</span>
                </div>
                <span className="text-xs text-black/35 shrink-0 ml-4">
                  {filing.filingDate}
                </span>
              </a>
            ))}
          </div>
        )}
      </Card>

      {/* Market News */}
      <Card padding="none">
        <div className="px-6 pt-6 pb-3">
          <CardTitle>Market News</CardTitle>
        </div>
        {newsLoading ? (
          <div className="px-6 pb-6">
            <LoadingCard />
          </div>
        ) : !marketNews || marketNews.length === 0 ? (
          <div className="px-6 pb-6">
            <EmptyState title="No market news" />
          </div>
        ) : (
          <div className="divide-y divide-black/[0.04]">
            {marketNews.slice(0, 15).map((item, i) => (
              <a
                key={i}
                href={item.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 px-6 py-4 hover:bg-black/[0.02] transition-colors"
              >
                {item.image && (
                  <img
                    src={item.image}
                    alt=""
                    className="w-16 h-12 rounded-lg object-cover shrink-0"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <h4 className="text-sm font-medium text-black/75 line-clamp-2 leading-snug">
                    {item.headline}
                  </h4>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xxs text-black/35">{item.source}</span>
                    <span className="text-xxs text-black/35">{timeAgo(item.datetime)}</span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Helpers ───

interface FilingAlert {
  symbol: string;
  form: string;
  filingDate: string;
  description: string;
  url: string;
}

interface RegimeSignal {
  text: string;
  sentiment: 'positive' | 'negative' | 'neutral';
}

function getRegimeSignals(
  regime: string,
  inflationTrend: string,
  growthTrend: string
): RegimeSignal[] {
  const signals: RegimeSignal[] = [];

  switch (regime) {
    case 'goldilocks':
      signals.push({ text: 'Favorable for broad equity exposure (SPY, QQQ)', sentiment: 'positive' });
      signals.push({ text: 'Growth stocks likely outperform value', sentiment: 'positive' });
      signals.push({ text: 'Credit spreads likely to tighten — corporate bonds attractive', sentiment: 'positive' });
      break;
    case 'reflation':
      signals.push({ text: 'Commodities & real assets likely outperform (GLD, DBC)', sentiment: 'positive' });
      signals.push({ text: 'TIPS and short-duration bonds preferred over long bonds', sentiment: 'neutral' });
      signals.push({ text: 'Value & cyclical sectors may outperform growth', sentiment: 'positive' });
      signals.push({ text: 'Long-duration treasuries face headwinds (TLT)', sentiment: 'negative' });
      break;
    case 'stagflation':
      signals.push({ text: 'Defensive positioning recommended — consider reducing equity exposure', sentiment: 'negative' });
      signals.push({ text: 'Gold and commodities as inflation hedge (GLD)', sentiment: 'positive' });
      signals.push({ text: 'Avoid long-duration bonds and high-growth equities', sentiment: 'negative' });
      signals.push({ text: 'Utilities and consumer staples may provide relative stability', sentiment: 'neutral' });
      break;
    case 'deflation':
      signals.push({ text: 'Long-duration treasuries attractive (TLT, IEF)', sentiment: 'positive' });
      signals.push({ text: 'Quality & defensive equities preferred', sentiment: 'positive' });
      signals.push({ text: 'Commodities and cyclicals likely underperform', sentiment: 'negative' });
      signals.push({ text: 'Watch for potential rate cuts — beneficial for duration', sentiment: 'neutral' });
      break;
  }

  if (inflationTrend === 'rising') {
    signals.push({ text: 'Rising inflation: monitor TIPS and breakeven spreads', sentiment: 'neutral' });
  }
  if (growthTrend === 'decelerating') {
    signals.push({ text: 'Decelerating growth: watch initial claims and PMI for confirmation', sentiment: 'negative' });
  }

  return signals;
}
