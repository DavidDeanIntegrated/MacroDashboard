'use client';

import { useState, useEffect } from 'react';
import { Card, CardTitle } from '@/components/ui/Card';
import { LoadingCard, EmptyState } from '@/components/ui/Loading';
import { Badge, RegimeBadge } from '@/components/ui/Badge';
import { useMacroRegime, useMarketNews, useApi, usePortfolio } from '@/lib/hooks';
import { timeAgo } from '@/lib/format';
import { HOLDINGS, WATCHLIST, type HoldingPosition } from '@/lib/holdings';
import { computeSleeveData, getSleeveStatus } from '@/lib/sleeves';

interface WatchlistItem {
  symbol: string;
}

// Default filing watchlist derived from the app's real tickers (HOLDINGS + WATCHLIST),
// excluding non-equity symbols (BTC) and the cash-equivalent SGOV which adds no filing signal.
const DEFAULT_WATCHLIST: WatchlistItem[] = Array.from(
  new Set([...HOLDINGS.map((h) => h.symbol), ...WATCHLIST.map((w) => w.symbol)])
)
  .filter((symbol) => symbol !== 'BTC' && symbol !== 'SGOV')
  .map((symbol) => ({ symbol }));

export default function AlertsPage() {
  const { data: regime, loading: regimeLoading } = useMacroRegime();
  const { data: marketNews, loading: newsLoading } = useMarketNews();
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(DEFAULT_WATCHLIST);
  const [newSymbol, setNewSymbol] = useState('');
  const [expandedTilt, setExpandedTilt] = useState<number | null>(null);
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

  // Regime-aware compound alerts (macro regime × portfolio sleeve drift)
  const { data: dashboard } = useApi<DashboardData>('/api/fred?action=dashboard');
  const { data: portfolio } = usePortfolio();
  const compoundAlerts = getCompoundAlerts(dashboard?.regime, portfolio?.positions);

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
                <div className="space-y-1">
                  {regimeSignals.map((signal, i) => {
                    const isExpanded = expandedTilt === i;
                    return (
                      <div key={i}>
                        <button
                          onClick={() => setExpandedTilt(isExpanded ? null : i)}
                          className="w-full flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-black/[0.02] transition-colors cursor-pointer text-left"
                        >
                          <svg
                            className={`w-3 h-3 text-black/25 transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                          <div
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              signal.sentiment === 'positive'
                                ? 'bg-accent-green'
                                : signal.sentiment === 'negative'
                                  ? 'bg-accent-red'
                                  : 'bg-accent-orange'
                            }`}
                          />
                          <span className="text-sm text-black/65">{signal.text}</span>
                        </button>
                        {isExpanded && (
                          <div className={`ml-8 mr-2 mb-2 mt-1 p-3 rounded-lg border animate-fade-in ${
                            signal.sentiment === 'positive'
                              ? 'bg-accent-green/[0.04] border-accent-green/15'
                              : signal.sentiment === 'negative'
                                ? 'bg-accent-red/[0.04] border-accent-red/15'
                                : 'bg-accent-orange/[0.04] border-accent-orange/15'
                          }`}>
                            <p className="text-xs text-black/55 leading-relaxed">
                              {signal.explanation}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </Card>

      {/* Regime-Aware Signals — macro regime combined with portfolio sleeve drift */}
      <Card>
        <CardTitle>Regime-Aware Signals</CardTitle>
        <p className="text-sm text-black/45 mt-1">
          Compound alerts where the current macro regime meets your sleeve allocation.
        </p>
        {compoundAlerts.length === 0 ? (
          <div className="mt-4 p-3 bg-black/[0.02] rounded-xl">
            <p className="text-sm text-black/55">
              No compound macro/portfolio signals — sleeves aligned with the current regime.
            </p>
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {compoundAlerts.map((alert, i) => (
              <div
                key={i}
                className="flex items-start gap-3 p-3 bg-black/[0.02] rounded-xl"
              >
                <Badge variant={alert.variant}>{alert.tag}</Badge>
                <p className="text-sm text-black/65 leading-relaxed">{alert.text}</p>
              </div>
            ))}
          </div>
        )}
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
  explanation: string;
}

// ─── Regime-Aware Compound Alerts ───

interface DashboardRegime {
  regime: string;
  label: string;
  description: string;
  inflationTrend: string;
  growthTrend: string;
  latestInflation: number;
  latestUnemployment: number;
}

interface DashboardData {
  regime?: DashboardRegime;
}

interface CompoundAlert {
  tag: string;
  variant: 'red' | 'orange' | 'blue';
  text: string;
}

function getCompoundAlerts(
  regime: DashboardRegime | undefined,
  positions: HoldingPosition[] | undefined
): CompoundAlert[] {
  if (!regime || !positions || positions.length === 0) return [];

  const sleeves = computeSleeveData(positions);
  const statusOf = (name: string) => {
    const s = sleeves.find((sl) => sl.name === name);
    return s ? getSleeveStatus(s.weight, s.targetMin, s.targetMax) : 'in-range';
  };

  const alerts: CompoundAlert[] = [];

  // Inflation hedge underweight while inflation accelerates
  if (statusOf('Real Assets') === 'under' && regime.inflationTrend === 'rising') {
    alerts.push({
      tag: 'High',
      variant: 'red',
      text: 'Inflation accelerating while your inflation hedge is underweight — add to GLD/BCI.',
    });
  }

  // Equities overweight into a defensive regime
  if (
    statusOf('Equities') === 'over' &&
    (regime.regime === 'stagflation' || regime.regime === 'deflation')
  ) {
    alerts.push({
      tag: 'Caution',
      variant: 'orange',
      text: 'Equities overweight into a defensive regime — consider trimming high-beta toward target.',
    });
  }

  // Dry powder light while growth slows
  if (statusOf('Dry Powder') === 'under' && regime.growthTrend === 'decelerating') {
    alerts.push({
      tag: 'Caution',
      variant: 'orange',
      text: 'Growth slowing and dry powder is light — rebuild SGOV for optionality.',
    });
  }

  // Crypto overweight outside a benign backdrop
  if (statusOf('Crypto') === 'over' && regime.regime !== 'goldilocks') {
    alerts.push({
      tag: 'Note',
      variant: 'blue',
      text: 'Crypto overweight outside a Goldilocks backdrop — size the satellite carefully given liquidity risk.',
    });
  }

  return alerts;
}

function getRegimeSignals(
  regime: string,
  inflationTrend: string,
  growthTrend: string
): RegimeSignal[] {
  const signals: RegimeSignal[] = [];

  switch (regime) {
    case 'goldilocks':
      signals.push({ text: 'Favorable for broad equity exposure (SPY, QQQ)', sentiment: 'positive', explanation: 'In a Goldilocks regime, moderate growth and contained inflation create ideal conditions for equities. Broad index funds capture upside without excessive sector concentration risk.' });
      signals.push({ text: 'Growth stocks likely outperform value', sentiment: 'positive', explanation: 'Low and stable interest rates keep discount rates low, boosting the present value of future earnings. This disproportionately benefits high-growth companies with cash flows further out in the future.' });
      signals.push({ text: 'Credit spreads likely to tighten — corporate bonds attractive', sentiment: 'positive', explanation: 'When the economy is growing steadily without inflation pressure, corporate default risk falls. Investors accept lower premiums for credit risk, pushing spreads tighter and bond prices higher.' });
      break;
    case 'reflation':
      signals.push({ text: 'Commodities & real assets likely outperform (GLD, DBC)', sentiment: 'positive', explanation: 'Rising inflation erodes the value of financial assets but boosts the nominal value of real assets. Commodities, gold, and real estate act as natural inflation hedges in this environment.' });
      signals.push({ text: 'TIPS and short-duration bonds preferred over long bonds', sentiment: 'neutral', explanation: 'TIPS adjust principal for inflation, protecting real returns. Short-duration bonds reduce interest rate risk — critical when the Fed is hiking. Long bonds lose value as rates rise.' });
      signals.push({ text: 'Value & cyclical sectors may outperform growth', sentiment: 'positive', explanation: 'Rising rates compress the multiples of high-growth stocks while cyclical sectors (energy, materials, financials) benefit from pricing power and wider net interest margins.' });
      signals.push({ text: 'Long-duration treasuries face headwinds (TLT)', sentiment: 'negative', explanation: 'Long bonds have the highest sensitivity to interest rate changes. In a rising rate environment, TLT can lose 15-25% in a single year as yields increase and bond prices fall inversely.' });
      break;
    case 'stagflation':
      signals.push({ text: 'Defensive positioning recommended — consider reducing equity exposure', sentiment: 'negative', explanation: 'Stagflation is the worst environment for traditional portfolios. Both stocks and bonds can decline simultaneously as inflation prevents the Fed from cutting rates to support growth.' });
      signals.push({ text: 'Gold and commodities as inflation hedge (GLD)', sentiment: 'positive', explanation: 'Gold has historically outperformed during stagflation because it holds value when currencies weaken and real rates are negative. It is one of the few assets that benefits from both inflation and fear.' });
      signals.push({ text: 'Avoid long-duration bonds and high-growth equities', sentiment: 'negative', explanation: 'High inflation erodes the fixed coupons of long bonds, while rising costs and slowing revenue crush high-multiple growth stocks. Both ends of the duration spectrum suffer.' });
      signals.push({ text: 'Utilities and consumer staples may provide relative stability', sentiment: 'neutral', explanation: 'Defensive sectors with pricing power and stable demand hold up better than the broad market. Consumers still buy electricity and groceries even in downturns, providing resilient cash flows.' });
      break;
    case 'deflation':
      signals.push({ text: 'Long-duration treasuries attractive (TLT, IEF)', sentiment: 'positive', explanation: 'When the economy contracts and the Fed cuts rates, long-duration bonds rally sharply as yields fall. TLT gained over 40% during the 2008-2009 crisis. Treasuries also benefit from flight-to-safety flows.' });
      signals.push({ text: 'Quality & defensive equities preferred', sentiment: 'positive', explanation: 'Companies with strong balance sheets, consistent earnings, and low debt survive deflationary periods. They can acquire competitors cheaply and emerge stronger. Think large-cap healthcare, staples, and utilities.' });
      signals.push({ text: 'Commodities and cyclicals likely underperform', sentiment: 'negative', explanation: 'Falling demand and excess capacity drive commodity prices down. Cyclical sectors (industrials, materials, discretionary) see revenue declines as consumers and businesses cut spending.' });
      signals.push({ text: 'Watch for potential rate cuts — beneficial for duration', sentiment: 'neutral', explanation: 'The Fed typically cuts aggressively during deflationary scares, pushing short rates toward zero. Positioning in duration assets before cuts can capture significant price appreciation as the yield curve steepens.' });
      break;
  }

  if (inflationTrend === 'rising') {
    signals.push({ text: 'Rising inflation: monitor TIPS and breakeven spreads', sentiment: 'neutral', explanation: 'TIPS breakeven rates reflect the market\'s inflation expectations. Rising breakevens confirm inflation is not just transitory and may warrant increasing real asset allocation.' });
  }
  if (growthTrend === 'decelerating') {
    signals.push({ text: 'Decelerating growth: watch initial claims and PMI for confirmation', sentiment: 'negative', explanation: 'Initial jobless claims and PMI are leading indicators. Rising claims above 300K or PMI below 50 confirm contraction is underway. This would strengthen the case for defensive positioning.' });
  }

  return signals;
}
