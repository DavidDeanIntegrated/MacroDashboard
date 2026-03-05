'use client';

import { useState } from 'react';
import { Card, CardTitle, MetricCard } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { LoadingPage, ErrorState } from '@/components/ui/Loading';
import { TimeSeriesChart, MultiSeriesChart } from '@/components/charts/TimeSeriesChart';
import { useApi } from '@/lib/hooks';

// ─── Types ───

interface TeachingData {
  fedFunds: Array<{ date: string; value: number }>;
  t2y: Array<{ date: string; value: number }>;
  t10y: Array<{ date: string; value: number }>;
  t10y2y: Array<{ date: string; value: number }>;
  cpiYoY: Array<{ date: string; value: number }>;
  unemployment: Array<{ date: string; value: number }>;
}

// ─── Case Studies ───

interface CaseStudy {
  id: string;
  title: string;
  period: string;
  dateRange: [string, string];
  teaching: string;
  bullets: string[];
  color: string;
}

const CASE_STUDIES: CaseStudy[] = [
  {
    id: 'volcker',
    title: 'Volcker Disinflation',
    period: 'Late 1970s \u2013 Early 1980s',
    dateRange: ['1977-01-01', '1985-01-01'],
    teaching:
      'When the Fed goes to war with inflation, curve inversion is often signaling "policy is tighter than the real economy can stand."',
    bullets: [
      'Fed funds was pushed to nearly 18% in 1980 to crush double-digit inflation.',
      'The yield curve repeatedly flattened and inverted as short rates spiked above long rates.',
      'Recessions in 1980 and 1981\u201382 followed, with unemployment reaching 10.8%.',
      'This era proved the Fed can break inflation \u2014 but the cost is severe economic pain and deep curve inversion.',
    ],
    color: '#FF3B30',
  },
  {
    id: 'dotcom',
    title: 'Dot-Com Cycle',
    period: '1998 \u2013 2003',
    dateRange: ['1997-01-01', '2004-01-01'],
    teaching:
      'Inversions don\u2019t tell you what will break (tech bubble vs something else), just that the odds of some break have gone up.',
    bullets: [
      'Late 1990s: Fed funds rose to about 6.5% by 2000; the curve flattened and briefly inverted.',
      'The tech-heavy Nasdaq fell ~78% from peak to trough as the bubble burst.',
      'Recession followed in 2001; Fed then cut Fed funds down to near 1% by 2003, re-steepening the curve.',
      'The inversion warned of fragility even though the specific trigger (tech bust) was hard to predict.',
    ],
    color: '#5856D6',
  },
  {
    id: 'gfc',
    title: 'Housing Bubble & GFC',
    period: '2004 \u2013 2010',
    dateRange: ['2003-01-01', '2011-01-01'],
    teaching:
      'The inversion was the warning; the steepening during the crash was the response \u2014 a steep curve doesn\u2019t always mean "all clear" if you are already in the recession.',
    bullets: [
      '2004\u201306: Fed hiked in 17 small steps to 5.25%; the 2Y followed while the 10Y lagged \u2192 curve inverted in 2006.',
      'The 2007\u201309 Great Recession was the deepest downturn since the 1930s.',
      'Fed cut to 0\u20130.25% and launched QE; the curve steepened sharply as short rates collapsed.',
      'Housing prices fell ~33% nationally; unemployment peaked at 10%. The inversion gave a 12\u201318 month heads-up.',
    ],
    color: '#FF9500',
  },
  {
    id: 'covid',
    title: '2019 Inversion & Pandemic',
    period: '2019 \u2013 2020',
    dateRange: ['2018-01-01', '2021-06-01'],
    teaching:
      'The curve doesn\u2019t predict what the shock will be; it tells you how vulnerable the system is to shocks.',
    bullets: [
      '2019: Curve briefly inverted as the Fed had hiked to 2.25\u20132.50%, then started cutting amid slowing global growth.',
      'COVID-19 struck in early 2020 \u2014 the inversion didn\u2019t "cause" the pandemic, but signaled a fragile backdrop.',
      'The Fed cut to zero and launched massive QE and emergency facilities within weeks.',
      'S&P 500 fell 34% in 23 trading days, then recovered to new highs within 5 months \u2014 the fastest bear market and recovery in history.',
    ],
    color: '#007AFF',
  },
  {
    id: 'post2020',
    title: 'Post-2020 Ultra-Long Inversion',
    period: '2022 \u2013 2024',
    dateRange: ['2021-01-01', '2025-03-01'],
    teaching:
      'Structural forces (fiscal deficits, QE/QT, global demand for safe assets) can stretch the timing and shape of the signal; use the curve with other macro data, not alone.',
    bullets: [
      'After zero-rate COVID policy, the Fed hiked aggressively starting 2022 to fight the inflation spike.',
      'The 2Y surged and the 10Y\u20132Y spread fell deeply negative for the longest inversion on record.',
      'This challenged simplistic timing rules \u2014 the economy remained resilient far longer than historical patterns suggested.',
      'The episode highlighted that fiscal stimulus, excess savings, and immigration can delay the recessionary signal.',
    ],
    color: '#34C759',
  },
];

// ─── Regime Matrix ───

const REGIME_MATRIX = [
  {
    curve: 'Steep, Fed cutting',
    regime: 'Early recovery',
    bias: 'Risk-on but watch inflation',
    color: 'green' as const,
  },
  {
    curve: 'Steep, Fed hiking from low',
    regime: 'Early expansion',
    bias: 'Constructive but rising rate risk',
    color: 'green' as const,
  },
  {
    curve: 'Flat, Fed near peak',
    regime: 'Late cycle',
    bias: 'Cautious, focus on quality',
    color: 'orange' as const,
  },
  {
    curve: 'Inverted, Fed still tight',
    regime: 'Pre-recession risk',
    bias: 'Defensive, stress-test portfolios',
    color: 'red' as const,
  },
  {
    curve: 'Re-steepening, Fed cutting hard',
    regime: 'In/just after recession',
    bias: 'Opportunities in beaten-down risk assets',
    color: 'blue' as const,
  },
];

// ─── Helpers ───

function filterDateRange(
  data: Array<{ date: string; value: number }>,
  start: string,
  end: string
): Array<{ date: string; value: number }> {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  return data.filter((d) => {
    const t = new Date(d.date).getTime();
    return t >= s && t <= e;
  });
}

function getLatest(data: Array<{ date: string; value: number }>): number {
  return data.length > 0 ? data[data.length - 1].value : 0;
}

function getCurveShape(spread: number): { label: string; color: 'green' | 'orange' | 'red' } {
  if (spread > 0.75) return { label: 'Normal (Healthy)', color: 'green' };
  if (spread > 0) return { label: 'Flat (Late Cycle)', color: 'orange' };
  return { label: 'Inverted (Warning)', color: 'red' };
}

function mergeForMultiSeries(
  fedFunds: Array<{ date: string; value: number }>,
  t2y: Array<{ date: string; value: number }>,
  t10y: Array<{ date: string; value: number }>,
  start?: string
): Array<{ date: string; fedFunds: number; t2y: number; t10y: number }> {
  // Build a map of dates to values — use the 10Y dates as the base
  const dateMap = new Map<string, { fedFunds?: number; t2y?: number; t10y?: number }>();

  for (const d of t10y) {
    if (start && d.date < start) continue;
    dateMap.set(d.date, { ...dateMap.get(d.date), t10y: d.value });
  }
  for (const d of t2y) {
    if (start && d.date < start) continue;
    if (dateMap.has(d.date)) {
      dateMap.get(d.date)!.t2y = d.value;
    }
  }
  for (const d of fedFunds) {
    if (start && d.date < start) continue;
    if (dateMap.has(d.date)) {
      dateMap.get(d.date)!.fedFunds = d.value;
    }
  }

  // For fed funds (monthly) we need to fill forward into daily dates
  let lastFedFunds: number | undefined;
  const sortedDates = Array.from(dateMap.keys()).sort();
  for (const date of sortedDates) {
    const entry = dateMap.get(date)!;
    if (entry.fedFunds !== undefined) lastFedFunds = entry.fedFunds;
    else if (lastFedFunds !== undefined) entry.fedFunds = lastFedFunds;
  }

  return sortedDates
    .map((date) => {
      const e = dateMap.get(date)!;
      if (e.fedFunds === undefined || e.t2y === undefined || e.t10y === undefined) return null;
      return { date, fedFunds: e.fedFunds, t2y: e.t2y, t10y: e.t10y };
    })
    .filter(Boolean) as Array<{ date: string; fedFunds: number; t2y: number; t10y: number }>;
}

// ─── Component ───

export default function TeachingPage() {
  const { data, error, loading, refresh } = useApi<TeachingData>('/api/fred?action=dashboard');
  const [expandedCase, setExpandedCase] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  if (loading) return <LoadingPage />;
  if (error) return <ErrorState message={error} onRetry={refresh} />;
  if (!data) return null;

  const latestSpread = getLatest(data.t10y2y);
  const latestFedFunds = getLatest(data.fedFunds);
  const latestT2Y = getLatest(data.t2y);
  const latestT10Y = getLatest(data.t10y);
  const curveShape = getCurveShape(latestSpread);

  // Multi-series data for Graph 2
  const multiSeriesData = mergeForMultiSeries(data.fedFunds, data.t2y, data.t10y, '1980-01-01');

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div>
        <h2 className="text-2xl font-semibold text-black/85 tracking-tight">
          Yield Curve &amp; Fed Policy
        </h2>
        <p className="text-sm text-black/45 mt-1">
          Understanding the most important signals in macro investing
        </p>
      </div>

      {/* What this tab teaches */}
      <Card className="bg-gradient-to-r from-accent-blue/[0.04] to-transparent">
        <CardTitle>What You&apos;ll Learn</CardTitle>
        <div className="mt-3 space-y-2">
          <div className="flex items-start gap-2">
            <span className="w-5 h-5 rounded-full bg-accent-blue/10 text-accent-blue text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
            <p className="text-sm text-black/65">What is the yield curve, the 10Y&ndash;2Y spread, and the Fed funds rate?</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="w-5 h-5 rounded-full bg-accent-blue/10 text-accent-blue text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
            <p className="text-sm text-black/65">How have they behaved around past recessions, booms, and false alarms?</p>
          </div>
          <div className="flex items-start gap-2">
            <span className="w-5 h-5 rounded-full bg-accent-blue/10 text-accent-blue text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">3</span>
            <p className="text-sm text-black/65">How do you translate today&apos;s curve and policy into practical risk management?</p>
          </div>
        </div>
      </Card>

      {/* At a Glance — Current readings */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          label="10Y-2Y Spread"
          value={`${latestSpread >= 0 ? '+' : ''}${latestSpread.toFixed(2)}%`}
        />
        <MetricCard
          label="Fed Funds Rate"
          value={`${latestFedFunds.toFixed(2)}%`}
        />
        <MetricCard
          label="2Y Treasury"
          value={`${latestT2Y.toFixed(2)}%`}
        />
        <MetricCard
          label="10Y Treasury"
          value={`${latestT10Y.toFixed(2)}%`}
        />
      </div>

      {/* Curve shape badge */}
      <Card>
        <div className="flex items-center gap-4">
          <div>
            <p className="text-xs font-medium text-black/45 uppercase tracking-wider mb-1">Curve Shape</p>
            <Badge variant={curveShape.color} size="md">{curveShape.label}</Badge>
          </div>
          <div className="h-8 w-px bg-black/[0.06]" />
          <p className="text-sm text-black/55 leading-relaxed">
            {latestSpread < 0
              ? `The curve is inverted by ${Math.abs(latestSpread).toFixed(2)}%. Historically, this has preceded every U.S. recession since 1955. Watch for the un-inversion \u2014 that\u2019s often when recession actually begins.`
              : latestSpread < 0.75
                ? `The curve is nearly flat at +${latestSpread.toFixed(2)}%. This is typical of late-cycle conditions where the Fed has tightened significantly. Remain cautious.`
                : `The curve has a healthy positive slope of +${latestSpread.toFixed(2)}%. This is supportive of bank lending and economic growth.`}
          </p>
        </div>
      </Card>

      {/* Key Concepts */}
      <Card>
        <CardTitle>Key Concepts</CardTitle>
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-black/[0.02] rounded-xl">
            <h4 className="text-sm font-semibold text-black/75 mb-2">Yield Curve</h4>
            <p className="text-xs text-black/55 leading-relaxed">
              A line showing yields of U.S. Treasuries across different maturities at one point in time. Normally <strong>upward-sloping</strong>: longer maturities pay more to compensate investors for tying up money longer and bearing more inflation risk.
            </p>
          </div>
          <div className="p-4 bg-black/[0.02] rounded-xl">
            <h4 className="text-sm font-semibold text-black/75 mb-2">10Y&ndash;2Y Spread</h4>
            <p className="text-xs text-black/55 leading-relaxed">
              The yield on the 10-year Treasury minus the 2-year (10Y &minus; 2Y). <strong>Positive = &ldquo;normal&rdquo;</strong> curve. <strong>Negative = inverted</strong> &mdash; this has preceded every U.S. recession since the mid-1950s with only a few false positives.
            </p>
          </div>
          <div className="p-4 bg-black/[0.02] rounded-xl">
            <h4 className="text-sm font-semibold text-black/75 mb-2">Fed Funds Rate</h4>
            <p className="text-xs text-black/55 leading-relaxed">
              The overnight rate targeted by the Federal Reserve. It heavily influences the <strong>short end</strong> (2Y) of the curve. When the Fed hikes aggressively, short rates can exceed long rates, inverting the curve.
            </p>
          </div>
        </div>
      </Card>

      {/* Graph 1: Long-run 10Y-2Y vs recessions */}
      <Card>
        <CardTitle>Graph 1: 10Y&ndash;2Y Spread (Full History)</CardTitle>
        <p className="text-xs text-black/40 mt-1 mb-2">
          Every dip below the 0% line (inversion) has preceded a U.S. recession since 1955
        </p>
        <TimeSeriesChart
          data={data.t10y2y}
          color="#5856D6"
          height={320}
          gradientId="teaching-t10y2y"
          valueFormatter={(v) => `${v.toFixed(2)}%`}
        />
        <div className="mt-4 p-4 bg-accent-purple/[0.04] rounded-xl border border-accent-purple/10">
          <p className="text-xs font-semibold text-black/65 mb-2">Key Teaching Points</p>
          <ul className="text-xs text-black/55 leading-relaxed space-y-1.5">
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-purple shrink-0 mt-1.5" />
              A negative 10Y&ndash;2Y has preceded every U.S. recession since 1955 with a typical lead of <strong>6&ndash;24 months</strong>, but sometimes longer.
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-purple shrink-0 mt-1.5" />
              The risk is greatest <strong>after</strong> the inversion, especially when the spread is moving back toward zero as growth rolls over.
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-purple shrink-0 mt-1.5" />
              The curve is a <strong>probabilistic signal</strong>, not a precise timer. Some inversions preceded recessions by over 2 years; rare false positives have occurred.
            </li>
          </ul>
        </div>
      </Card>

      {/* Graph 2: Fed Funds vs 2Y vs 10Y */}
      <Card>
        <CardTitle>Graph 2: Fed Funds vs 2Y vs 10Y (1980&ndash;Present)</CardTitle>
        <p className="text-xs text-black/40 mt-1 mb-2">
          Watch how the 2Y tracks Fed policy while the 10Y reflects growth and inflation expectations
        </p>
        <MultiSeriesChart
          data={multiSeriesData}
          series={[
            { key: 'fedFunds', color: '#007AFF', name: 'Fed Funds' },
            { key: 't2y', color: '#FF9500', name: '2Y Treasury' },
            { key: 't10y', color: '#34C759', name: '10Y Treasury' },
          ]}
          height={320}
        />
        <div className="mt-4 p-4 bg-accent-blue/[0.04] rounded-xl border border-accent-blue/10">
          <p className="text-xs font-semibold text-black/65 mb-2">Key Teaching Points</p>
          <ul className="text-xs text-black/55 leading-relaxed space-y-1.5">
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-blue shrink-0 mt-1.5" />
              The Fed directly moves overnight money; the <strong>2Y is the market&apos;s expectation</strong> of where policy will average over the next couple of years.
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-blue shrink-0 mt-1.5" />
              The 10Y embeds: expected future policy + growth expectations + inflation expectations + a <strong>term premium</strong> that varies with fiscal and risk conditions.
            </li>
            <li className="flex items-start gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-blue shrink-0 mt-1.5" />
              When the Fed hikes aggressively above inflation and growth, the short end spikes, the curve flattens/inverts, and <strong>recession risk rises</strong>.
            </li>
          </ul>
        </div>
      </Card>

      {/* Historical Case Studies */}
      <Card>
        <CardTitle>Historical Case Studies</CardTitle>
        <p className="text-xs text-black/40 mt-1 mb-4">
          Click each era to see the 10Y&ndash;2Y spread and Fed funds chart for that period
        </p>
        <div className="space-y-3">
          {CASE_STUDIES.map((cs) => {
            const isExpanded = expandedCase === cs.id;
            return (
              <div key={cs.id} className="border border-black/[0.06] rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpandedCase(isExpanded ? null : cs.id)}
                  className="w-full flex items-center justify-between p-4 hover:bg-black/[0.02] transition-colors text-left"
                >
                  <div className="flex items-center gap-3">
                    <svg
                      className={`w-4 h-4 text-black/30 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ backgroundColor: cs.color }}
                    />
                    <div>
                      <h4 className="text-sm font-semibold text-black/75">{cs.title}</h4>
                      <p className="text-xs text-black/40">{cs.period}</p>
                    </div>
                  </div>
                </button>
                {isExpanded && (
                  <div className="px-4 pb-4 animate-fade-in">
                    {/* Mini chart for this period */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                      <div>
                        <p className="text-xs font-medium text-black/45 mb-2">10Y&ndash;2Y Spread</p>
                        <TimeSeriesChart
                          data={filterDateRange(data.t10y2y, cs.dateRange[0], cs.dateRange[1])}
                          color={cs.color}
                          height={180}
                          gradientId={`cs-spread-${cs.id}`}
                          valueFormatter={(v) => `${v.toFixed(2)}%`}
                          compact
                        />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-black/45 mb-2">Fed Funds Rate</p>
                        <TimeSeriesChart
                          data={filterDateRange(data.fedFunds, cs.dateRange[0], cs.dateRange[1])}
                          color="#007AFF"
                          height={180}
                          gradientId={`cs-ff-${cs.id}`}
                          valueFormatter={(v) => `${v.toFixed(2)}%`}
                          compact
                        />
                      </div>
                    </div>
                    {/* Bullets */}
                    <ul className="text-xs text-black/55 leading-relaxed space-y-1.5 mb-3">
                      {cs.bullets.map((b, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5"
                            style={{ backgroundColor: cs.color }}
                          />
                          {b}
                        </li>
                      ))}
                    </ul>
                    {/* Teaching angle */}
                    <div
                      className="p-3 rounded-lg border"
                      style={{
                        backgroundColor: `${cs.color}08`,
                        borderColor: `${cs.color}20`,
                      }}
                    >
                      <p className="text-xs font-semibold text-black/65 mb-1">Teaching Angle</p>
                      <p className="text-xs text-black/55 leading-relaxed italic">
                        &ldquo;{cs.teaching}&rdquo;
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Advanced Insights (collapsible) */}
      <Card>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between text-left"
        >
          <CardTitle>Advanced Insights</CardTitle>
          <svg
            className={`w-4 h-4 text-black/30 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showAdvanced && (
          <div className="mt-4 space-y-4 animate-fade-in">
            <div className="p-4 bg-black/[0.02] rounded-xl">
              <h4 className="text-sm font-semibold text-black/70 mb-2">False Positives &amp; Long Lags</h4>
              <p className="text-xs text-black/55 leading-relaxed">
                The curve has had at least two notable &ldquo;near-misses&rdquo; or very delayed recessions. A negative spread raises risk but it can take a long time or require another shock to trigger the downturn. The 1966 and 1998 inversions are commonly cited examples where recession didn&apos;t follow immediately or at all.
              </p>
            </div>
            <div className="p-4 bg-black/[0.02] rounded-xl">
              <h4 className="text-sm font-semibold text-black/70 mb-2">Steepening Is Not Always Bullish</h4>
              <p className="text-xs text-black/55 leading-relaxed">
                A curve can steepen because the Fed is cutting (bullish early-cycle &ldquo;bull steepening&rdquo;), or because long yields are blowing out on fiscal/inflation worries (&ldquo;bear steepening&rdquo; &mdash; more mixed for risk assets). The 2023 bear steepening, driven by rising term premium and fiscal concerns, was not a classic risk-on signal.
              </p>
            </div>
            <div className="p-4 bg-black/[0.02] rounded-xl">
              <h4 className="text-sm font-semibold text-black/70 mb-2">Macro Is Bidirectional with the Curve</h4>
              <p className="text-xs text-black/55 leading-relaxed">
                Research from the San Francisco Fed and academic work on level/slope/curvature factors finds that macro variables affect yields <em>and</em> yields affect macro &mdash; there is clear two-way interaction, not a one-direction &ldquo;oracle.&rdquo; The curve reflects expectations, but it also shapes lending conditions and animal spirits.
              </p>
            </div>
            <div className="p-4 bg-black/[0.02] rounded-xl">
              <h4 className="text-sm font-semibold text-black/70 mb-2">Regime Dependence</h4>
              <p className="text-xs text-black/55 leading-relaxed">
                Recent work using regime-switching and machine-learning models shows the curve&apos;s predictive power is <strong>stronger when short rates are high</strong> and policy is clearly restrictive than when rates are low and pinned by QE. In a zero-rate environment, the curve loses much of its signaling power because the short end can&apos;t fall further.
              </p>
            </div>
          </div>
        )}
      </Card>

      {/* How to Read This Page */}
      <Card>
        <CardTitle>How to Read This Page in 3 Steps</CardTitle>
        <div className="mt-4 space-y-4">
          <div className="flex items-start gap-3">
            <span className="w-7 h-7 rounded-full bg-accent-blue/10 text-accent-blue text-sm font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
            <div>
              <h4 className="text-sm font-semibold text-black/75 mb-1">Start with Curve Shape</h4>
              <p className="text-xs text-black/55 leading-relaxed">
                Is 10Y&ndash;2Y &gt; +75&ndash;100 bps (healthy slope), 0&ndash;75 bps (late-cycle/neutral), or &lt; 0 (inverted, elevated recession risk)?
              </p>
              <div className="mt-2">
                <Badge variant={curveShape.color} size="md">
                  Current: {latestSpread >= 0 ? '+' : ''}{latestSpread.toFixed(0)} bps &mdash; {curveShape.label}
                </Badge>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <span className="w-7 h-7 rounded-full bg-accent-blue/10 text-accent-blue text-sm font-bold flex items-center justify-center shrink-0 mt-0.5">2</span>
            <div>
              <h4 className="text-sm font-semibold text-black/75 mb-1">Cross-Check Fed Stance</h4>
              <p className="text-xs text-black/55 leading-relaxed">
                Is Fed funds above estimated neutral and still hiking (tightening), flat at high levels (holding restrictive), or cutting (easing into/after weakness)? Currently at <strong>{latestFedFunds.toFixed(2)}%</strong>.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <span className="w-7 h-7 rounded-full bg-accent-blue/10 text-accent-blue text-sm font-bold flex items-center justify-center shrink-0 mt-0.5">3</span>
            <div>
              <h4 className="text-sm font-semibold text-black/75 mb-1">Contextualize with Macro &amp; Valuations</h4>
              <p className="text-xs text-black/55 leading-relaxed">
                Combine the curve and Fed stance with earnings growth, unemployment, and valuations. Use this tab as a <strong>risk-regime indicator</strong>, not a trading signal by itself.
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Regime Matrix */}
      <Card>
        <CardTitle>Curve &amp; Fed Stance Regime Matrix</CardTitle>
        <p className="text-xs text-black/40 mt-1 mb-4">
          A simplified framework for translating curve shape and Fed policy into risk positioning
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-black/[0.06]">
                <th className="text-left py-3 px-3 font-semibold text-black/55 uppercase tracking-wider">Curve / Fed Stance</th>
                <th className="text-left py-3 px-3 font-semibold text-black/55 uppercase tracking-wider">Typical Regime</th>
                <th className="text-left py-3 px-3 font-semibold text-black/55 uppercase tracking-wider">Risk-Asset Bias</th>
              </tr>
            </thead>
            <tbody>
              {REGIME_MATRIX.map((row, i) => (
                <tr
                  key={i}
                  className="border-b border-black/[0.04] last:border-0"
                >
                  <td className="py-3 px-3 text-black/65 font-medium">{row.curve}</td>
                  <td className="py-3 px-3">
                    <Badge variant={row.color}>{row.regime}</Badge>
                  </td>
                  <td className="py-3 px-3 text-black/55">{row.bias}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
