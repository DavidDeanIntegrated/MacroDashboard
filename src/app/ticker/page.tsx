'use client';

import { useState } from 'react';
import { Card, CardTitle, MetricCard, StatRow } from '@/components/ui/Card';
import { LoadingCard, ErrorState, EmptyState } from '@/components/ui/Loading';
import { Badge, TrendIndicator } from '@/components/ui/Badge';
import { TimeSeriesChart } from '@/components/charts/TimeSeriesChart';
import {
  useFinnhubQuote,
  useCompanyProfile,
  useCompanyNews,
  useCompanyFundamentals,
  useCompanyFilings,
  useEarnings,
  useStockBars,
} from '@/lib/hooks';
import { formatCurrency, formatPercent, formatDate, timeAgo } from '@/lib/format';

export default function TickerPage() {
  const [ticker, setTicker] = useState('');
  const [activeTicker, setActiveTicker] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'fundamentals' | 'filings' | 'news'>('overview');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (ticker.trim()) {
      setActiveTicker(ticker.trim().toUpperCase());
    }
  };

  const quickTickers = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'TSLA', 'META', 'SPY'];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header + Search */}
      <div>
        <h2 className="text-2xl font-semibold text-black/85 tracking-tight">Ticker Analysis</h2>
        <p className="text-sm text-black/45 mt-1">
          Deep dive into any public company — price, fundamentals, filings, news
        </p>
      </div>

      <Card>
        <form onSubmit={handleSearch} className="flex items-center gap-3">
          <div className="relative flex-1 max-w-md">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black/30"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              placeholder="Enter ticker symbol (e.g., AAPL)"
              className="w-full pl-10 pr-4 py-2.5 text-sm bg-black/[0.03] border border-black/[0.06] rounded-xl focus:outline-none focus:ring-2 focus:ring-accent-blue/30 focus:border-accent-blue/50"
            />
          </div>
          <button
            type="submit"
            className="px-5 py-2.5 text-sm font-medium text-white bg-accent-blue rounded-xl hover:bg-blue-600 transition-colors"
          >
            Analyze
          </button>
        </form>

        {/* Quick picks */}
        <div className="flex flex-wrap gap-2 mt-4">
          {quickTickers.map((t) => (
            <button
              key={t}
              onClick={() => {
                setTicker(t);
                setActiveTicker(t);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                activeTicker === t
                  ? 'bg-accent-blue text-white'
                  : 'bg-black/[0.04] text-black/55 hover:bg-black/[0.08]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </Card>

      {activeTicker ? (
        <TickerDetail
          symbol={activeTicker}
          activeTab={activeTab}
          onTabChange={setActiveTab}
        />
      ) : (
        <EmptyState
          title="Search for a ticker"
          description="Enter a stock symbol above to see pricing, fundamentals, SEC filings, and news."
        />
      )}
    </div>
  );
}

function TickerDetail({
  symbol,
  activeTab,
  onTabChange,
}: {
  symbol: string;
  activeTab: string;
  onTabChange: (tab: 'overview' | 'fundamentals' | 'filings' | 'news') => void;
}) {
  const { data: quote, loading: quoteLoading } = useFinnhubQuote(symbol);
  const { data: profile, loading: profileLoading } = useCompanyProfile(symbol);
  const { data: chartData } = useStockBars(symbol);
  const { data: fundamentals, loading: fundLoading } = useCompanyFundamentals(symbol);
  const { data: filings, loading: filingsLoading } = useCompanyFilings(symbol);
  const { data: news, loading: newsLoading } = useCompanyNews(symbol);
  const { data: earnings } = useEarnings(symbol);

  const tabs = [
    { id: 'overview' as const, label: 'Overview' },
    { id: 'fundamentals' as const, label: 'Fundamentals' },
    { id: 'filings' as const, label: 'SEC Filings' },
    { id: 'news' as const, label: 'News' },
  ];

  return (
    <div className="space-y-6">
      {/* Company Header */}
      <Card className="bg-gradient-to-r from-white/80 to-white/60">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            {profile?.logo && (
              <img
                src={profile.logo}
                alt={profile.name}
                className="w-12 h-12 rounded-xl object-contain bg-white p-1 shadow-subtle"
              />
            )}
            <div>
              <div className="flex items-center gap-3">
                <h3 className="text-xl font-semibold text-black/85">{symbol}</h3>
                {profile && (
                  <Badge variant="neutral">{profile.exchange}</Badge>
                )}
              </div>
              {profileLoading ? (
                <div className="h-4 w-40 bg-black/[0.06] rounded animate-pulse mt-1" />
              ) : profile ? (
                <p className="text-sm text-black/55 mt-0.5">{profile.name}</p>
              ) : null}
              {profile && (
                <div className="flex items-center gap-4 mt-2">
                  <span className="text-xs text-black/35">{profile.finnhubIndustry}</span>
                  <span className="text-xs text-black/35">
                    MCap: {formatCurrency(profile.marketCapitalization * 1e6, { compact: true })}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Quote */}
          <div className="text-right">
            {quoteLoading ? (
              <div className="space-y-2">
                <div className="h-8 w-24 bg-black/[0.06] rounded animate-pulse ml-auto" />
                <div className="h-4 w-16 bg-black/[0.06] rounded animate-pulse ml-auto" />
              </div>
            ) : quote ? (
              <>
                <p className="text-3xl font-semibold text-black/85 tabular-nums">
                  {formatCurrency(quote.price)}
                </p>
                <TrendIndicator value={quote.changePercent} />
                <p className="text-xs text-black/35 mt-1">
                  {formatCurrency(quote.change)} today
                </p>
              </>
            ) : null}
          </div>
        </div>

        {/* Quick stats */}
        {quote && (
          <div className="grid grid-cols-4 gap-4 mt-6 pt-4 border-t border-black/[0.04]">
            <div>
              <p className="text-xxs text-black/35 uppercase">Open</p>
              <p className="text-sm font-medium text-black/75 tabular-nums">{formatCurrency(quote.open)}</p>
            </div>
            <div>
              <p className="text-xxs text-black/35 uppercase">High</p>
              <p className="text-sm font-medium text-black/75 tabular-nums">{formatCurrency(quote.high)}</p>
            </div>
            <div>
              <p className="text-xxs text-black/35 uppercase">Low</p>
              <p className="text-sm font-medium text-black/75 tabular-nums">{formatCurrency(quote.low)}</p>
            </div>
            <div>
              <p className="text-xxs text-black/35 uppercase">Prev Close</p>
              <p className="text-sm font-medium text-black/75 tabular-nums">{formatCurrency(quote.prevClose)}</p>
            </div>
          </div>
        )}
      </Card>

      {/* Tab Navigation */}
      <div className="flex items-center gap-1 p-1 bg-black/[0.03] rounded-xl w-fit">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === tab.id
                ? 'bg-white text-black/85 shadow-subtle'
                : 'text-black/45 hover:text-black/65'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Price Chart */}
          <Card>
            <CardTitle>{symbol} — Daily Price</CardTitle>
            {chartData ? (
              <TimeSeriesChart
                data={chartData.map((d) => ({ date: d.date, value: d.close }))}
                color="#007AFF"
                height={350}
                gradientId={`price-${symbol}`}
                valueFormatter={(v) => formatCurrency(v)}
              />
            ) : (
              <div className="h-[350px] flex items-center justify-center text-sm text-black/35">
                Loading chart...
              </div>
            )}
          </Card>

          {/* Key Metrics */}
          {fundamentals && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {fundamentals.metrics.ttmRevenue && (
                <MetricCard
                  label="TTM Revenue"
                  value={formatCurrency(fundamentals.metrics.ttmRevenue, { compact: true })}
                />
              )}
              {fundamentals.metrics.ttmEPS && (
                <MetricCard
                  label="TTM EPS"
                  value={formatCurrency(fundamentals.metrics.ttmEPS)}
                />
              )}
              {fundamentals.metrics.grossMargin && (
                <MetricCard
                  label="Gross Margin"
                  value={formatPercent(fundamentals.metrics.grossMargin)}
                />
              )}
              {fundamentals.metrics.debtToEquity !== null && (
                <MetricCard
                  label="Debt/Equity"
                  value={fundamentals.metrics.debtToEquity!.toFixed(2)}
                />
              )}
            </div>
          )}

          {/* Earnings */}
          {earnings && earnings.length > 0 && (
            <Card>
              <CardTitle>Recent Earnings</CardTitle>
              <div className="mt-3 space-y-0">
                {earnings.slice(0, 6).map((e, i) => (
                  <div key={i} className="flex items-center justify-between py-2.5 border-b border-black/[0.04] last:border-0">
                    <div>
                      <span className="text-sm font-medium text-black/75">{e.period}</span>
                    </div>
                    <div className="flex items-center gap-6">
                      <div className="text-right">
                        <p className="text-xxs text-black/35">Estimate</p>
                        <p className="text-sm tabular-nums text-black/55">
                          {e.estimate !== null ? formatCurrency(e.estimate) : '—'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xxs text-black/35">Actual</p>
                        <p className="text-sm tabular-nums font-medium text-black/85">
                          {e.actual !== null ? formatCurrency(e.actual) : '—'}
                        </p>
                      </div>
                      <div className="text-right w-20">
                        {e.surprisePercent !== null && (
                          <Badge
                            variant={e.surprisePercent >= 0 ? 'green' : 'red'}
                          >
                            {e.surprisePercent >= 0 ? '+' : ''}
                            {e.surprisePercent.toFixed(1)}%
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {activeTab === 'fundamentals' && (
        <FundamentalsTab symbol={symbol} data={fundamentals} loading={fundLoading} />
      )}

      {activeTab === 'filings' && (
        <FilingsTab data={filings} loading={filingsLoading} />
      )}

      {activeTab === 'news' && (
        <NewsTab data={news} loading={newsLoading} />
      )}
    </div>
  );
}

function FundamentalsTab({
  symbol,
  data,
  loading,
}: {
  symbol: string;
  data: ReturnType<typeof useCompanyFundamentals>['data'];
  loading: boolean;
}) {
  if (loading) return <LoadingCard />;
  if (!data) return <ErrorState message="Could not load fundamentals" />;

  const { fundamentals, metrics } = data;

  // Get last 20 periods for charts
  const revenueData = fundamentals.revenue.slice(-20).map((d) => ({
    date: d.endDate,
    value: d.value,
  }));

  const netIncomeData = fundamentals.netIncome.slice(-20).map((d) => ({
    date: d.endDate,
    value: d.value,
  }));

  const epsData = fundamentals.eps.slice(-20).map((d) => ({
    date: d.endDate,
    value: d.value,
  }));

  return (
    <div className="space-y-6">
      {/* Metrics summary */}
      <Card>
        <CardTitle>Financial Metrics ({fundamentals.entityName})</CardTitle>
        <div className="mt-2">
          {metrics.ttmRevenue !== null && (
            <StatRow label="TTM Revenue" value={formatCurrency(metrics.ttmRevenue, { compact: true })} />
          )}
          {metrics.ttmNetIncome !== null && (
            <StatRow label="TTM Net Income" value={formatCurrency(metrics.ttmNetIncome, { compact: true })} />
          )}
          {metrics.ttmEPS !== null && (
            <StatRow label="TTM EPS" value={formatCurrency(metrics.ttmEPS)} />
          )}
          {metrics.grossMargin !== null && (
            <StatRow label="Gross Margin" value={formatPercent(metrics.grossMargin)} />
          )}
          {metrics.operatingMargin !== null && (
            <StatRow label="Operating Margin" value={formatPercent(metrics.operatingMargin)} />
          )}
          {metrics.netMargin !== null && (
            <StatRow label="Net Margin" value={formatPercent(metrics.netMargin)} />
          )}
          {metrics.debtToEquity !== null && (
            <StatRow label="Debt / Equity" value={metrics.debtToEquity.toFixed(2)} />
          )}
        </div>
      </Card>

      {/* Revenue chart */}
      {revenueData.length > 0 && (
        <Card>
          <CardTitle>Revenue History</CardTitle>
          <TimeSeriesChart
            data={revenueData}
            color="#34C759"
            height={280}
            gradientId={`rev-${symbol}`}
            valueFormatter={(v) => formatCurrency(v, { compact: true })}
          />
        </Card>
      )}

      {/* Net income chart */}
      {netIncomeData.length > 0 && (
        <Card>
          <CardTitle>Net Income History</CardTitle>
          <TimeSeriesChart
            data={netIncomeData}
            color="#007AFF"
            height={280}
            gradientId={`ni-${symbol}`}
            valueFormatter={(v) => formatCurrency(v, { compact: true })}
          />
        </Card>
      )}

      {/* EPS chart */}
      {epsData.length > 0 && (
        <Card>
          <CardTitle>EPS History</CardTitle>
          <TimeSeriesChart
            data={epsData}
            color="#AF52DE"
            height={250}
            gradientId={`eps-${symbol}`}
            valueFormatter={(v) => formatCurrency(v)}
          />
        </Card>
      )}
    </div>
  );
}

function FilingsTab({
  data,
  loading,
}: {
  data: ReturnType<typeof useCompanyFilings>['data'];
  loading: boolean;
}) {
  if (loading) return <LoadingCard />;
  if (!data || data.length === 0) return <EmptyState title="No filings found" />;

  const formColors: Record<string, string> = {
    '10-K': 'blue',
    '10-Q': 'purple',
    '8-K': 'orange',
    '4': 'neutral',
  };

  return (
    <Card padding="none">
      <div className="px-6 pt-6 pb-3">
        <CardTitle>SEC Filings</CardTitle>
      </div>
      <div className="divide-y divide-black/[0.04]">
        {data.map((filing) => (
          <a
            key={filing.accessionNumber}
            href={filing.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between px-6 py-4 hover:bg-black/[0.02] transition-colors"
          >
            <div className="flex items-center gap-4">
              <Badge variant={(formColors[filing.form] as 'blue' | 'purple' | 'orange' | 'neutral') || 'neutral'}>
                {filing.form}
              </Badge>
              <div>
                <p className="text-sm font-medium text-black/75">
                  {filing.primaryDocDescription || filing.form}
                </p>
                <p className="text-xs text-black/35">
                  Filed: {formatDate(filing.filingDate)} | Period: {formatDate(filing.reportDate)}
                </p>
              </div>
            </div>
            <svg className="w-4 h-4 text-black/25" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </a>
        ))}
      </div>
    </Card>
  );
}

function NewsTab({
  data,
  loading,
}: {
  data: ReturnType<typeof useCompanyNews>['data'];
  loading: boolean;
}) {
  if (loading) return <LoadingCard />;
  if (!data || data.length === 0) return <EmptyState title="No recent news" />;

  return (
    <div className="space-y-3">
      {data.slice(0, 20).map((item, i) => (
        <a
          key={i}
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
        >
          <Card hover>
            <div className="flex gap-4">
              {item.image && (
                <img
                  src={item.image}
                  alt=""
                  className="w-20 h-20 rounded-xl object-cover shrink-0"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              )}
              <div className="min-w-0">
                <h4 className="text-sm font-semibold text-black/85 line-clamp-2 leading-snug">
                  {item.headline}
                </h4>
                <p className="text-xs text-black/45 mt-1 line-clamp-2">
                  {item.summary}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-xxs text-black/35">{item.source}</span>
                  <span className="text-xxs text-black/20">|</span>
                  <span className="text-xxs text-black/35">{timeAgo(item.datetime)}</span>
                </div>
              </div>
            </div>
          </Card>
        </a>
      ))}
    </div>
  );
}
