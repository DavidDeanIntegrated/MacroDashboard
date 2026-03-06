'use client';

import { useState, useEffect, useRef } from 'react';
import { Card, CardTitle, MetricCard } from '@/components/ui/Card';
import { LoadingPage, ErrorState } from '@/components/ui/Loading';
import { Badge, RegimeBadge } from '@/components/ui/Badge';
import { TimeSeriesChart, MultiSeriesChart } from '@/components/charts/TimeSeriesChart';
import { YieldCurveChart } from '@/components/charts/YieldCurveChart';
import { useApi, useYieldCurve, useReleaseCalendar, useMultiAggregates, usePolygonSMA } from '@/lib/hooks';
import { formatPercent, formatNumber, formatCurrency } from '@/lib/format';
import { FRED_SERIES_NAMES } from '@/lib/fred';

interface MacroDashboard {
  fedFunds: Array<{ date: string; value: number }>;
  t2y: Array<{ date: string; value: number }>;
  t10y: Array<{ date: string; value: number }>;
  t10y2y: Array<{ date: string; value: number }>;
  cpi: Array<{ date: string; value: number }>;
  cpiYoY: Array<{ date: string; value: number }>;
  unemployment: Array<{ date: string; value: number }>;
  highYieldSpread: Array<{ date: string; value: number }>;
  industrialProduction: Array<{ date: string; value: number }>;
  vix: Array<{ date: string; value: number }>;
  lei: Array<{ date: string; value: number }>;
  consumerSentiment: Array<{ date: string; value: number }>;
  buildingPermits: Array<{ date: string; value: number }>;
  ismManufacturing: Array<{ date: string; value: number }>;
  initialClaims: Array<{ date: string; value: number }>;
  m2: Array<{ date: string; value: number }>;
  regime: {
    regime: string;
    label: string;
    description: string;
    inflationTrend: string;
    growthTrend: string;
    latestInflation: number;
    latestUnemployment: number;
  };
}

type ChartPeriod = '1Y' | '3Y' | '5Y' | '10Y' | 'MAX';

const periodMap: Record<ChartPeriod, number> = {
  '1Y': 12,
  '3Y': 36,
  '5Y': 60,
  '10Y': 120,
  MAX: 999,
};

function filterByPeriod(
  data: Array<{ date: string; value: number }>,
  period: ChartPeriod
): Array<{ date: string; value: number }> {
  if (period === 'MAX') return data;
  const months = periodMap[period];
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  return data.filter((d) => new Date(d.date) >= cutoff);
}

function getLatest(data: Array<{ date: string; value: number }>): number {
  return data.length > 0 ? data[data.length - 1].value : 0;
}

function getChange(data: Array<{ date: string; value: number }>, periods = 1): number {
  if (data.length < periods + 1) return 0;
  return data[data.length - 1].value - data[data.length - 1 - periods].value;
}

// Indicator metadata for interactive dropdowns
interface IndicatorInfo {
  key: string;
  label: string;
  description: string;
  regimeSignal: (value: number) => { regime: string; badge: 'green' | 'orange' | 'red' | 'blue' | 'neutral'; explanation: string };
}

const INDICATOR_INFO: Record<string, IndicatorInfo> = {
  FEDFUNDS: {
    key: 'FEDFUNDS',
    label: FRED_SERIES_NAMES['FEDFUNDS'],
    description:
      'The interest rate at which banks lend to each other overnight. Set by the Federal Reserve, it is the most important lever for monetary policy — rippling through mortgages, corporate debt, and all borrowing costs.',
    regimeSignal: (v) => {
      if (v < 1)
        return { regime: 'Crisis / Deflation', badge: 'blue', explanation: 'Near-zero rates signal emergency conditions. The Fed has exhausted conventional tools and may be using QE.' };
      if (v < 2.5)
        return { regime: 'Goldilocks', badge: 'green', explanation: 'Moderately low rates support asset valuations and economic growth without overheating.' };
      if (v < 4.5)
        return { regime: 'Reflation', badge: 'orange', explanation: 'Rates are elevated — the Fed is tightening to combat inflation. Watch for yield curve inversion and slowing growth.' };
      return { regime: 'Restrictive / Stagflation risk', badge: 'red', explanation: 'Very high rates compress multiples and raise recession risk. This level historically precedes downturns.' };
    },
  },
  DGS2: {
    key: 'DGS2',
    label: FRED_SERIES_NAMES['DGS2'],
    description:
      'The yield on 2-year government bonds. This is the most rate-sensitive Treasury and closely tracks expectations for near-term Fed policy. It leads the curve — when the 2Y rises above the 10Y, the curve inverts.',
    regimeSignal: (v) => {
      if (v < 1)
        return { regime: 'Deflation / Crisis', badge: 'blue', explanation: 'Ultra-low short rates reflect expectations of prolonged easing or recession.' };
      if (v < 3)
        return { regime: 'Goldilocks', badge: 'green', explanation: 'Moderate 2Y yield suggests the market expects stable, accommodative policy.' };
      if (v < 4.5)
        return { regime: 'Reflation', badge: 'orange', explanation: 'Elevated 2Y yield shows the market pricing in more hikes or sustained tightness.' };
      return { regime: 'Stagflation risk', badge: 'red', explanation: 'Very high short-term yields signal aggressive tightening expectations. Often precedes inversions and recessions.' };
    },
  },
  DGS10: {
    key: 'DGS10',
    label: FRED_SERIES_NAMES['DGS10'],
    description:
      'The benchmark "risk-free" rate used to discount nearly every financial asset. Reflects long-term growth and inflation expectations. When it rises, equity multiples compress; when it falls, bonds rally.',
    regimeSignal: (v) => {
      if (v < 1.5)
        return { regime: 'Deflation / Crisis', badge: 'blue', explanation: 'Ultra-low long rates signal a flight to safety. Investors accept near-zero returns for security.' };
      if (v < 3.5)
        return { regime: 'Goldilocks', badge: 'green', explanation: 'Moderate long rates support equity valuations with a reasonable discount rate.' };
      if (v < 4.5)
        return { regime: 'Reflation', badge: 'orange', explanation: 'Elevated yields reflect inflation expectations or rising term premium. Compressing equity multiples.' };
      return { regime: 'Restrictive', badge: 'red', explanation: 'High long rates compete with equities for capital and raise government borrowing costs. Unsustainable above 5% for long.' };
    },
  },
  T10Y2Y: {
    key: 'T10Y2Y',
    label: FRED_SERIES_NAMES['T10Y2Y'],
    description:
      'The yield curve slope — the difference between 10Y and 2Y yields. The single most reliable recession predictor. Every U.S. recession since 1955 was preceded by an inversion. The un-inversion is when recession typically starts.',
    regimeSignal: (v) => {
      if (v < -0.3)
        return { regime: 'Recession warning', badge: 'red', explanation: 'Deeply inverted curve. Historically signals recession within 6-24 months. Markets may not have priced in the risk yet.' };
      if (v < 0.1)
        return { regime: 'Late cycle', badge: 'orange', explanation: 'Flat or slightly inverted curve. The economy is at a turning point — either heading into slowdown or the Fed is about to pivot.' };
      if (v < 1.5)
        return { regime: 'Goldilocks', badge: 'green', explanation: 'Normal positive slope. Banks can lend profitably, credit flows freely, and growth expectations are healthy.' };
      return { regime: 'Early recovery', badge: 'blue', explanation: 'Very steep curve typically occurs after Fed cuts — signals early recovery from recession. Bullish for cyclicals and banks.' };
    },
  },
  CPIYOY: {
    key: 'CPIYOY',
    label: 'CPI YoY Inflation',
    description:
      'The rate at which consumer prices are rising. The Fed targets 2%. Too high erodes purchasing power and forces tightening; too low (deflation) signals weak demand and can spiral into a debt crisis.',
    regimeSignal: (v) => {
      if (v < 0)
        return { regime: 'Deflation / Depression', badge: 'blue', explanation: 'Falling prices signal demand collapse. Consumers delay purchases, revenues shrink, debt burdens increase in real terms.' };
      if (v < 2.5)
        return { regime: 'Goldilocks', badge: 'green', explanation: 'Inflation in the Fed\'s comfort zone. No pressure to tighten. Supports steady growth and equity multiples.' };
      if (v < 4)
        return { regime: 'Reflation', badge: 'orange', explanation: 'Inflation above target but manageable. The Fed is likely tightening. Favors commodities and value over growth.' };
      return { regime: 'Stagflation risk', badge: 'red', explanation: 'High inflation forces aggressive tightening, compresses margins, and erodes real returns. Historically very bearish for 60/40 portfolios.' };
    },
  },
  UNRATE: {
    key: 'UNRATE',
    label: FRED_SERIES_NAMES['UNRATE'],
    description:
      'A lagging indicator — by the time unemployment rises meaningfully, recession has usually begun. The Sahm Rule triggers when the 3-month average rises 0.50% above its 12-month low. See the Sahm Rule panel on the chart below for the current 12-month low and trigger status.',
    regimeSignal: (v) => {
      if (v > 8)
        return { regime: 'Depression / Crisis', badge: 'red', explanation: 'Severe labor market deterioration. Requires massive fiscal stimulus. Historically, equities are near bottoms at these levels.' };
      if (v > 5.5)
        return { regime: 'Recession', badge: 'orange', explanation: 'Unemployment at recessionary levels. The Fed is likely cutting aggressively. Defensive positioning and duration tend to outperform.' };
      if (v > 4.3)
        return { regime: 'Late cycle / Softening', badge: 'neutral', explanation: 'Labor market softening from a strong base. Watch for Sahm Rule trigger. The cycle may be turning.' };
      return { regime: 'Expansion', badge: 'green', explanation: 'Tight labor market supports consumer spending and wage growth. Favorable for risk assets when paired with moderate inflation.' };
    },
  },
  BAMLH0A0HYM2: {
    key: 'BAMLH0A0HYM2',
    label: FRED_SERIES_NAMES['BAMLH0A0HYM2'],
    description:
      'The extra yield investors demand for risky corporate bonds over Treasuries. Measures credit stress and risk appetite in real time. Bond markets often lead equities — widening spreads are an early warning.',
    regimeSignal: (v) => {
      if (v > 8)
        return { regime: 'Crisis / Panic', badge: 'red', explanation: 'Credit markets freezing. Companies can\'t refinance, defaults spike. The Fed typically intervenes with emergency facilities at these levels.' };
      if (v > 5)
        return { regime: 'Stress / Bear', badge: 'orange', explanation: 'Growing risk aversion. Weaker companies struggle to borrow. Often precedes equity sell-offs. Reduce credit exposure.' };
      if (v > 3.5)
        return { regime: 'Neutral', badge: 'neutral', explanation: 'Credit conditions are normal. Not signaling stress, but not excessively loose either.' };
      return { regime: 'Risk-on / Bull', badge: 'green', explanation: 'Very tight spreads indicate strong risk appetite and easy credit. Supportive of equity bull markets, but can signal complacency.' };
    },
  },
  VIXCLS: {
    key: 'VIXCLS',
    label: FRED_SERIES_NAMES['VIXCLS'],
    description:
      'The CBOE Volatility Index measures 30-day expected volatility of the S&P 500, derived from options prices. Known as the "fear gauge" — it spikes during panics and crashes. Historically, VIX above 40 has coincided with major market bottoms.',
    regimeSignal: (v) => {
      if (v > 40)
        return { regime: 'Extreme Fear / Capitulation', badge: 'red', explanation: 'VIX above 40 signals panic selling and extreme fear. Historically rare and often marks major bottoms. Contrarian buy signal for long-term investors.' };
      if (v > 30)
        return { regime: 'High Fear', badge: 'orange', explanation: 'Elevated fear — markets pricing in significant downside risk. Often seen during corrections. Conditions may be ripe for a reversal if catalysts emerge.' };
      if (v > 20)
        return { regime: 'Elevated Caution', badge: 'neutral', explanation: 'Above-average volatility expectations. Market is uncertain but not panicking. Normal during mild pullbacks or ahead of major events.' };
      if (v > 12)
        return { regime: 'Calm / Normal', badge: 'green', explanation: 'Low volatility reflects complacency and confidence. Supportive of steady equity gains, but extremely low VIX can precede sharp corrections.' };
      return { regime: 'Extreme Complacency', badge: 'blue', explanation: 'VIX below 12 signals extreme complacency. Markets are pricing in near-zero risk. Historically, this level precedes volatility spikes and corrections.' };
    },
  },
  USSLIND: {
    key: 'USSLIND',
    label: FRED_SERIES_NAMES['USSLIND'],
    description:
      'The Conference Board Leading Economic Index (LEI) — a composite of 10 leading indicators including initial claims, building permits, stock prices, and the yield curve. The single most reliable composite recession predictor. 6+ consecutive monthly declines have preceded every modern recession.',
    regimeSignal: (v) => {
      // LEI is an index level; the YoY % change is what matters most, but we signal on trend direction
      // using recent absolute level relative to historical norms
      if (v < 98)
        return { regime: 'Contraction signal', badge: 'red', explanation: 'LEI well below its recent highs, signaling sustained economic weakness. Historically this precedes or confirms recession.' };
      if (v < 102)
        return { regime: 'Slowing', badge: 'orange', explanation: 'LEI has declined from peaks, suggesting the economy is losing momentum. Watch for sustained consecutive declines.' };
      if (v < 108)
        return { regime: 'Stable Growth', badge: 'green', explanation: 'LEI at a healthy level, consistent with moderate economic expansion. No recession signal.' };
      return { regime: 'Strong Expansion', badge: 'blue', explanation: 'LEI at elevated levels reflects broad economic strength across its 10 component indicators.' };
    },
  },
  UMCSENT: {
    key: 'UMCSENT',
    label: FRED_SERIES_NAMES['UMCSENT'],
    description:
      'The University of Michigan Consumer Sentiment Index measures household confidence in economic conditions. Collapses in sentiment lead consumer spending pullbacks (spending = 70% of GDP). Readings below 60 have historically coincided with recessions.',
    regimeSignal: (v) => {
      if (v < 55)
        return { regime: 'Recession-level pessimism', badge: 'red', explanation: 'Consumer sentiment at crisis levels. Consumers are pulling back, which leads to reduced spending and economic contraction.' };
      if (v < 70)
        return { regime: 'Pessimistic', badge: 'orange', explanation: 'Below-average sentiment suggests consumers feel squeezed — typically by inflation, job uncertainty, or rising rates.' };
      if (v < 90)
        return { regime: 'Neutral / Cautious', badge: 'neutral', explanation: 'Moderate sentiment. Consumers are neither euphoric nor panicking. Spending growth likely moderate.' };
      return { regime: 'Optimistic', badge: 'green', explanation: 'High consumer confidence supports robust spending growth. Often seen during strong job markets with contained inflation.' };
    },
  },
  PERMIT: {
    key: 'PERMIT',
    label: FRED_SERIES_NAMES['PERMIT'],
    description:
      'New privately-owned housing units authorized by building permits. Housing is the most interest-rate-sensitive sector and one of the earliest indicators to turn. Permits drop 12-18 months before recession as higher rates choke off demand.',
    regimeSignal: (v) => {
      // Building permits in thousands of units (SAAR)
      if (v < 1000)
        return { regime: 'Housing contraction', badge: 'red', explanation: 'Permits below 1M signal severe housing weakness. Historically seen only in recessions (2008-2009, 2020). Massive drag on GDP.' };
      if (v < 1300)
        return { regime: 'Cooling', badge: 'orange', explanation: 'Permits declining from cycle highs. Higher rates are dampening housing activity. Leading indicator of broader economic slowing.' };
      if (v < 1600)
        return { regime: 'Healthy', badge: 'green', explanation: 'Permits at healthy levels consistent with balanced housing supply. Supports construction employment and GDP growth.' };
      return { regime: 'Housing boom', badge: 'blue', explanation: 'Very high permit levels signal strong housing demand. Often driven by low rates. Watch for overbuilding risk.' };
    },
  },
  MANEMP: {
    key: 'MANEMP',
    label: 'ISM Manufacturing Employment',
    description:
      'The ISM Manufacturing Employment Index measures hiring in the manufacturing sector. Part of the broader ISM PMI suite. Above 50 signals expansion in manufacturing employment; below 50 signals contraction. Manufacturing leads the business cycle.',
    regimeSignal: (v) => {
      if (v < 45)
        return { regime: 'Deep contraction', badge: 'red', explanation: 'Manufacturing employment contracting sharply. Factories cutting workers — strong recession signal for the industrial economy.' };
      if (v < 50)
        return { regime: 'Contraction', badge: 'orange', explanation: 'Manufacturing employment shrinking. Below the critical 50 threshold. Watch for spillover into services sector.' };
      if (v < 55)
        return { regime: 'Moderate expansion', badge: 'green', explanation: 'Manufacturing employment growing modestly. Consistent with a healthy industrial sector and steady GDP growth.' };
      return { regime: 'Strong expansion', badge: 'blue', explanation: 'Robust manufacturing hiring signals strong industrial demand. Typically seen during early-to-mid cycle recoveries.' };
    },
  },
  ICSA: {
    key: 'ICSA',
    label: FRED_SERIES_NAMES['ICSA'],
    description:
      'Weekly new unemployment insurance filings — the most timely labor market indicator. Rising claims are one of the earliest recession signals. The 4-week moving average smooths volatility. Claims above 300K sustained have preceded every modern recession.',
    regimeSignal: (v) => {
      // ICSA is in thousands
      if (v > 350)
        return { regime: 'Recession warning', badge: 'red', explanation: 'Initial claims above 350K signal significant layoffs. Sustained at this level, every historical instance has coincided with recession.' };
      if (v > 260)
        return { regime: 'Rising layoffs', badge: 'orange', explanation: 'Claims trending above normal. Labor market softening — layoffs are picking up. Early warning signal for broader weakness.' };
      if (v > 200)
        return { regime: 'Healthy', badge: 'green', explanation: 'Claims in the 200-260K range signal a normal, healthy labor market with low layoff activity.' };
      return { regime: 'Very tight market', badge: 'blue', explanation: 'Claims below 200K signal extremely tight labor conditions. Very few layoffs — employers are hoarding workers.' };
    },
  },
  M2SL: {
    key: 'M2SL',
    label: FRED_SERIES_NAMES['M2SL'],
    description:
      'M2 money supply includes cash, checking deposits, savings, and money market funds. Rapid M2 growth (2020-21) preceded the inflation surge. M2 contraction in 2022-23 (first since 1930s) preceded disinflation. Money supply leads inflation by 12-18 months.',
    regimeSignal: (v) => {
      // M2 is in billions — we show it as-is but the trend matters more than the level
      // Use rough thresholds based on recent historical ranges
      if (v < 18000)
        return { regime: 'Tight liquidity', badge: 'orange', explanation: 'M2 contracting or at low levels relative to GDP. Reduced liquidity headwind for asset prices. Deflationary pressure building.' };
      if (v < 21000)
        return { regime: 'Normal', badge: 'green', explanation: 'M2 at moderate levels. Money supply growth consistent with stable prices and healthy credit conditions.' };
      return { regime: 'Excess liquidity', badge: 'blue', explanation: 'Very high M2 levels. Excess liquidity supports asset prices in the near term but may feed inflation with a 12-18 month lag.' };
    },
  },
};

export default function MacroPage() {
  const [bustCache, setBustCache] = useState(false);
  const { data, error, loading, refresh } = useApi<MacroDashboard>(
    `/api/fred?action=dashboard${bustCache ? '&bust=1' : ''}`
  );
  const { data: yieldCurve } = useYieldCurve();
  const [period, setPeriod] = useState<ChartPeriod>('3Y');
  const [expandedIndicator, setExpandedIndicator] = useState<string | null>(null);

  // Market context overlays — SPY & QQQ
  const lookbackDays = periodMap[period] * 30; // rough days from months
  const fromDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() - Math.min(lookbackDays, 365 * 3));
    return d.toISOString().split('T')[0];
  })();
  const { data: benchmarkData } = useMultiAggregates(['SPY', 'QQQ'], '1day', fromDate);
  const { data: spySma50 } = usePolygonSMA('SPY', 50);
  const { data: spySma200 } = usePolygonSMA('SPY', 200);

  // Release calendar
  const { data: releaseCalendar } = useReleaseCalendar();

  // Auto-refresh: check every 5 minutes if a release just happened (within the last 10 minutes)
  const lastAutoRefresh = useRef<string>('');
  useEffect(() => {
    if (!releaseCalendar || releaseCalendar.length === 0) return;

    const checkForNewRelease = () => {
      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const releasesToday = releaseCalendar.filter((r) => r.releaseDate === todayStr);
      if (releasesToday.length > 0) {
        // If it's after 8:30 AM ET (typical release time) and we haven't refreshed for this date
        // Use Intl to get correct ET offset (handles DST automatically)
        const etTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const etHour = etTime.getHours();
        if (etHour >= 8 && lastAutoRefresh.current !== todayStr) {
          lastAutoRefresh.current = todayStr;
          setBustCache(true); // bust cache on release day
        }
      }
    };

    checkForNewRelease();
    const interval = setInterval(checkForNewRelease, 5 * 60 * 1000); // check every 5 min
    return () => clearInterval(interval);
  }, [releaseCalendar, refresh]);

  if (loading) return <LoadingPage />;
  if (error) return <ErrorState message={error} onRetry={refresh} />;
  if (!data) return null;

  const regime = data.regime;

  // Sahm Rule computation: 3-month average vs 12-month low
  const unempData = data.unemployment || [];
  const sahmInfo = (() => {
    if (unempData.length < 12) return null;
    // Unemployment is monthly — last 12 entries = 12-month window
    const recent12 = unempData.slice(-12);
    const low12 = Math.min(...recent12.map((d: { value: number }) => d.value));
    // 3-month average = last 3 entries
    const recent3 = unempData.slice(-3);
    const avg3 = recent3.reduce((sum: number, d: { value: number }) => sum + d.value, 0) / recent3.length;
    const sahmValue = avg3 - low12;
    const triggered = sahmValue >= 0.5;
    return { low12, avg3, sahmValue, triggered };
  })();

  const indicators = [
    { info: INDICATOR_INFO['FEDFUNDS'], data: data.fedFunds, suffix: '%' },
    { info: INDICATOR_INFO['DGS2'], data: data.t2y, suffix: '%' },
    { info: INDICATOR_INFO['DGS10'], data: data.t10y, suffix: '%' },
    { info: INDICATOR_INFO['T10Y2Y'], data: data.t10y2y, suffix: '%' },
    { info: INDICATOR_INFO['CPIYOY'], data: data.cpiYoY, suffix: '%' },
    { info: INDICATOR_INFO['UNRATE'], data: data.unemployment, suffix: '%' },
    { info: INDICATOR_INFO['BAMLH0A0HYM2'], data: data.highYieldSpread, suffix: '%' },
    { info: INDICATOR_INFO['VIXCLS'], data: data.vix, suffix: '' },
    { info: INDICATOR_INFO['USSLIND'], data: data.lei, suffix: '' },
    { info: INDICATOR_INFO['UMCSENT'], data: data.consumerSentiment, suffix: '' },
    { info: INDICATOR_INFO['PERMIT'], data: data.buildingPermits, suffix: 'K' },
    { info: INDICATOR_INFO['MANEMP'], data: data.ismManufacturing, suffix: '' },
    { info: INDICATOR_INFO['ICSA'], data: data.initialClaims, suffix: 'K' },
    { info: INDICATOR_INFO['M2SL'], data: data.m2, suffix: 'B' },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-black/85 tracking-tight">Macro Overview</h2>
          <p className="text-sm text-black/45 mt-1">
            Economic indicators and macro regime analysis
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(['1Y', '3Y', '5Y', '10Y', 'MAX'] as ChartPeriod[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                period === p
                  ? 'bg-accent-blue text-white shadow-sm'
                  : 'text-black/45 hover:bg-black/[0.04]'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Economic Release Calendar */}
      {releaseCalendar && releaseCalendar.length > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <CardTitle>Upcoming Economic Releases</CardTitle>
            <p className="text-[10px] text-black/30 uppercase tracking-wider">Auto-refreshes on release day</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {releaseCalendar.map((release) => {
              const releaseDate = new Date(release.releaseDate + 'T12:00:00');
              const now = new Date();
              const todayStr = now.toISOString().split('T')[0];
              const diffMs = releaseDate.getTime() - now.getTime();
              const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
              const isToday = release.releaseDate === todayStr;
              const isPast = release.releaseDate < todayStr;
              const isSoon = diffDays <= 3 && diffDays > 0;

              return (
                <div
                  key={release.seriesId}
                  className={`rounded-lg p-3 border transition-all ${
                    isToday
                      ? 'border-accent-blue/20 bg-accent-blue/[0.04] ring-1 ring-accent-blue/10'
                      : isPast
                        ? 'border-black/[0.04] bg-black/[0.01] opacity-60'
                        : isSoon
                          ? 'border-accent-orange/15 bg-accent-orange/[0.02]'
                          : 'border-black/[0.06] bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[11px] font-semibold text-black/65">{release.name}</span>
                    {isToday && (
                      <Badge variant="blue">Today</Badge>
                    )}
                    {isPast && (
                      <Badge variant="neutral">Released</Badge>
                    )}
                    {isSoon && (
                      <Badge variant="orange">{diffDays}d</Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-black/40">
                      {releaseDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', weekday: 'short' })}
                    </span>
                    <span className="text-[10px] text-black/30">{release.source}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[10px] text-black/30">{release.frequency}</span>
                    {!isPast && !isToday && diffDays > 3 && (
                      <span className="text-[10px] text-black/25">{diffDays} days</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Macro Regime Banner */}
      <Card className="bg-gradient-to-r from-white/80 to-white/60">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-black/45 uppercase tracking-wider mb-2">
              Current Macro Regime
            </p>
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-xl font-semibold text-black/85">{regime.label}</h3>
              <RegimeBadge regime={regime.regime} />
            </div>
            <p className="text-sm text-black/55 max-w-xl leading-relaxed">
              {regime.description}
            </p>
          </div>
          <div className="text-right space-y-2 shrink-0 ml-8">
            <div>
              <p className="text-xxs text-black/35 uppercase">Inflation (YoY)</p>
              <p className="text-lg font-semibold tabular-nums text-black/85">
                {formatPercent(regime.latestInflation)}
              </p>
            </div>
            <div>
              <p className="text-xxs text-black/35 uppercase">Unemployment</p>
              <p className="text-lg font-semibold tabular-nums text-black/85">
                {regime.latestUnemployment.toFixed(1)}%
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Key metrics row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <MetricCard
          label="Fed Funds Rate"
          value={`${getLatest(data.fedFunds).toFixed(2)}%`}
          change={formatPercent(getChange(data.fedFunds))}
          trend={getChange(data.fedFunds) > 0 ? 'up' : getChange(data.fedFunds) < 0 ? 'down' : 'neutral'}
        />
        <MetricCard
          label="10Y Treasury"
          value={`${getLatest(data.t10y).toFixed(2)}%`}
          change={formatPercent(getChange(data.t10y))}
          trend={getChange(data.t10y) > 0 ? 'up' : 'down'}
        />
        <MetricCard
          label="CPI YoY"
          value={formatPercent(getLatest(data.cpiYoY))}
          change={formatPercent(getChange(data.cpiYoY))}
          changeLabel="vs prev"
          trend={getChange(data.cpiYoY) > 0 ? 'up' : 'down'}
        />
        <MetricCard
          label="HY Spread"
          value={`${getLatest(data.highYieldSpread).toFixed(2)}%`}
          change={formatPercent(getChange(data.highYieldSpread))}
          trend={getChange(data.highYieldSpread) > 0 ? 'up' : 'down'}
        />
        <MetricCard
          label="VIX"
          value={getLatest(data.vix).toFixed(1)}
          change={formatNumber(getChange(data.vix), { decimals: 1 })}
          trend={getChange(data.vix) > 0 ? 'up' : 'down'}
        />
      </div>

      {/* Yield Curve */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardTitle>Yield Curve (Live)</CardTitle>
          {yieldCurve && <YieldCurveChart data={yieldCurve} height={280} />}
          <p className="text-xs text-black/40 mt-3 leading-relaxed">
            Shows yields across Treasury maturities. A normal upward slope means markets expect growth; a flat or inverted curve (short rates above long rates) has preceded every U.S. recession since 1955.
          </p>
        </Card>

        <Card>
          <CardTitle>10Y-2Y Spread (Historical)</CardTitle>
          <TimeSeriesChart
            data={filterByPeriod(data.t10y2y, period)}
            color="#5856D6"
            height={280}
            gradientId="t10y2y"
            valueFormatter={(v) => `${v.toFixed(2)}%`}
          />
          <p className="text-xs text-black/40 mt-3 leading-relaxed">
            The most-watched recession signal. Negative values (inversion) warn of recession 6-24 months ahead. The un-inversion — when this turns positive again — is often when recession actually begins, as the Fed starts cutting.
          </p>
        </Card>
      </div>

      {/* Market Context Overlays */}
      {benchmarkData && benchmarkData.length > 0 && (() => {
        const spyData = benchmarkData.find((b) => b.symbol === 'SPY')?.data || [];
        const qqqData = benchmarkData.find((b) => b.symbol === 'QQQ')?.data || [];

        // Compute performance stats
        const perfStats = (data: typeof spyData) => {
          if (data.length < 2) return { price: 0, change1D: 0, changePeriod: 0 };
          const last = data[data.length - 1];
          const prev = data[data.length - 2];
          const first = data[0];
          return {
            price: last.close,
            change1D: ((last.close - prev.close) / prev.close) * 100,
            changePeriod: ((last.close - first.close) / first.close) * 100,
          };
        };
        const spyStats = perfStats(spyData);
        const qqqStats = perfStats(qqqData);

        // Merge SPY price + SMA into chart data
        const spyChartData = spyData.map((d) => {
          const sma50Point = spySma50?.find((s) => s.date.split('T')[0] === d.date.split('T')[0]);
          const sma200Point = spySma200?.find((s) => s.date.split('T')[0] === d.date.split('T')[0]);
          return {
            date: d.date,
            SPY: d.close,
            ...(sma50Point ? { SMA50: sma50Point.value } : {}),
            ...(sma200Point ? { SMA200: sma200Point.value } : {}),
          };
        });

        // Normalize SPY vs QQQ for comparison (base = 100)
        const spyBase = spyData.length > 0 ? spyData[0].close : 1;
        const qqqBase = qqqData.length > 0 ? qqqData[0].close : 1;
        const minLen = Math.min(spyData.length, qqqData.length);
        const comparisonData: Array<{ date: string; [k: string]: string | number }> = [];
        for (let i = 0; i < minLen; i++) {
          if (spyData[i].date.split('T')[0] === qqqData[i].date.split('T')[0]) {
            comparisonData.push({
              date: spyData[i].date,
              SPY: +((spyData[i].close / spyBase) * 100).toFixed(2),
              QQQ: +((qqqData[i].close / qqqBase) * 100).toFixed(2),
            });
          }
        }

        return (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-semibold text-black/75 tracking-tight mb-1">Market Context</h3>
              <p className="text-xs text-black/40">Benchmark performance and moving averages via Polygon.io</p>
            </div>

            {/* Benchmark metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard
                label="SPY"
                value={formatCurrency(spyStats.price)}
                change={formatPercent(spyStats.change1D)}
                changeLabel="today"
                trend={spyStats.change1D >= 0 ? 'up' : 'down'}
              />
              <MetricCard
                label="SPY Period"
                value={formatPercent(spyStats.changePeriod)}
                change={period}
                changeLabel="period"
                trend={spyStats.changePeriod >= 0 ? 'up' : 'down'}
              />
              <MetricCard
                label="QQQ"
                value={formatCurrency(qqqStats.price)}
                change={formatPercent(qqqStats.change1D)}
                changeLabel="today"
                trend={qqqStats.change1D >= 0 ? 'up' : 'down'}
              />
              <MetricCard
                label="QQQ Period"
                value={formatPercent(qqqStats.changePeriod)}
                change={period}
                changeLabel="period"
                trend={qqqStats.changePeriod >= 0 ? 'up' : 'down'}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* SPY + Moving Averages */}
              <Card>
                <CardTitle>SPY — Price + Moving Averages</CardTitle>
                {spyChartData.length > 0 && (
                  <MultiSeriesChart
                    data={spyChartData}
                    series={[
                      { key: 'SPY', color: '#007AFF', name: 'SPY' },
                      { key: 'SMA50', color: '#FF9500', name: '50-day SMA' },
                      { key: 'SMA200', color: '#FF3B30', name: '200-day SMA' },
                    ]}
                    height={280}
                  />
                )}
                <p className="text-xs text-black/40 mt-3 leading-relaxed">
                  Price above both SMAs = bullish trend. Price below 200-day SMA = bear market territory. 50-day crossing below 200-day = &quot;death cross&quot; (bearish). Crossing above = &quot;golden cross&quot; (bullish).
                </p>
              </Card>

              {/* SPY vs QQQ normalized */}
              <Card>
                <CardTitle>SPY vs QQQ — Relative Performance</CardTitle>
                {comparisonData.length > 0 && (
                  <MultiSeriesChart
                    data={comparisonData}
                    series={[
                      { key: 'SPY', color: '#007AFF', name: 'SPY (indexed)' },
                      { key: 'QQQ', color: '#AF52DE', name: 'QQQ (indexed)' },
                    ]}
                    height={280}
                  />
                )}
                <p className="text-xs text-black/40 mt-3 leading-relaxed">
                  Normalized to 100 at start of period. When QQQ leads, growth/tech is in favor (risk-on). When SPY leads, broad market / value is outperforming (risk-off rotation).
                </p>
              </Card>
            </div>
          </div>
        );
      })()}

      {/* Inflation */}
      <Card>
        <CardTitle>Inflation — CPI Year-over-Year</CardTitle>
        <TimeSeriesChart
          data={filterByPeriod(data.cpiYoY, period)}
          color="#FF9500"
          height={280}
          gradientId="cpiYoY"
          valueFormatter={(v) => `${v.toFixed(2)}%`}
        />
        <p className="text-xs text-black/40 mt-3 leading-relaxed">
          Measures how fast consumer prices are rising. The Fed targets 2%. Below 2% allows easy policy (bullish for growth stocks); above 3-4% forces tightening (bearish for multiples, favors commodities and value). Deflation (below 0%) signals crisis.
        </p>
      </Card>

      {/* Rates + Labor */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardTitle>Fed Funds Rate</CardTitle>
          <TimeSeriesChart
            data={filterByPeriod(data.fedFunds, period)}
            color="#007AFF"
            height={250}
            gradientId="fedFunds"
            valueFormatter={(v) => `${v.toFixed(2)}%`}
          />
          <p className="text-xs text-black/40 mt-3 leading-relaxed">
            The Fed&apos;s primary policy lever. Rising rates cool the economy and compress asset valuations; falling rates stimulate growth and boost risk assets. The direction matters more than the level — &quot;don&apos;t fight the Fed.&quot;
          </p>
        </Card>

        <Card>
          <CardTitle>Unemployment Rate</CardTitle>
          <TimeSeriesChart
            data={filterByPeriod(data.unemployment, period)}
            color="#FF3B30"
            height={250}
            gradientId="unemployment"
            valueFormatter={(v) => `${v.toFixed(1)}%`}
          />
          <p className="text-xs text-black/40 mt-3 leading-relaxed">
            A lagging indicator — by the time it rises, recession has usually started. Below 4.5% signals a strong economy. Watch for the Sahm Rule: a 0.5% rise from the 12-month low has a perfect track record of identifying recessions.
          </p>
          {sahmInfo && (
            <div className={`mt-2 rounded-lg p-2.5 border ${sahmInfo.triggered ? 'bg-accent-red/[0.04] border-accent-red/10' : 'bg-black/[0.02] border-black/[0.06]'}`}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-black/55">Sahm Rule Indicator</span>
                <Badge variant={sahmInfo.triggered ? 'red' : 'green'}>
                  {sahmInfo.triggered ? 'Triggered' : 'Not Triggered'}
                </Badge>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-2">
                <div>
                  <p className="text-[10px] text-black/35 uppercase tracking-wider">12-Mo Low</p>
                  <p className="text-sm font-bold tabular-nums text-black/70">{sahmInfo.low12.toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-[10px] text-black/35 uppercase tracking-wider">3-Mo Avg</p>
                  <p className="text-sm font-bold tabular-nums text-black/70">{sahmInfo.avg3.toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-[10px] text-black/35 uppercase tracking-wider">Sahm Value</p>
                  <p className={`text-sm font-bold tabular-nums ${sahmInfo.triggered ? 'text-accent-red' : 'text-black/70'}`}>
                    +{sahmInfo.sahmValue.toFixed(2)}%
                    <span className="text-[10px] font-normal text-black/35 ml-1">/ 0.50%</span>
                  </p>
                </div>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* VIX + Credit */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardTitle>VIX — Fear Gauge</CardTitle>
          <TimeSeriesChart
            data={filterByPeriod(data.vix, period)}
            color="#FF3B30"
            height={250}
            gradientId="vix"
            valueFormatter={(v) => v.toFixed(1)}
          />
          <p className="text-xs text-black/40 mt-3 leading-relaxed">
            The CBOE Volatility Index — 30-day expected S&P 500 volatility from options prices. Below 15 = calm/complacent. 20-30 = elevated caution. Above 30 = high fear. Above 40 = extreme panic (historically marks major bottoms).
          </p>
        </Card>

        <Card>
          <CardTitle>High Yield Credit Spread</CardTitle>
          <TimeSeriesChart
            data={filterByPeriod(data.highYieldSpread, period)}
            color="#AF52DE"
            height={250}
            gradientId="hySpread"
            valueFormatter={(v) => `${v.toFixed(2)}%`}
          />
          <p className="text-xs text-black/40 mt-3 leading-relaxed">
            The premium investors demand for risky corporate bonds over Treasuries. Below 3.5% signals easy credit (risk-on). Above 5-6% signals stress. Above 8% means panic — credit markets are freezing and the Fed typically intervenes.
          </p>
        </Card>
      </div>

      {/* Industrial Production */}
      <Card>
        <CardTitle>Industrial Production Index</CardTitle>
        <TimeSeriesChart
          data={filterByPeriod(data.industrialProduction, period)}
          color="#34C759"
          height={250}
          gradientId="indProd"
          valueFormatter={(v) => formatNumber(v, { decimals: 1 })}
        />
        <p className="text-xs text-black/40 mt-3 leading-relaxed">
          Measures real output from manufacturing, mining, and utilities. A rising trend confirms expansion; sustained declines signal contraction. Tends to peak before recessions and trough before recoveries.
        </p>
      </Card>

      {/* ═══ Leading Indicators Section ═══ */}
      <div className="pt-4 border-t border-black/[0.06]">
        <h3 className="text-lg font-semibold text-black/75 tracking-tight mb-1">Leading Economic Indicators</h3>
        <p className="text-xs text-black/40">Forward-looking signals that anticipate economic turning points</p>
      </div>

      {/* LEI + Consumer Sentiment */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardTitle>Conference Board LEI</CardTitle>
          <TimeSeriesChart
            data={filterByPeriod(data.lei, period)}
            color="#5856D6"
            height={250}
            gradientId="lei"
            valueFormatter={(v) => formatNumber(v, { decimals: 1 })}
          />
          <p className="text-xs text-black/40 mt-3 leading-relaxed">
            Composite of 10 leading indicators (initial claims, building permits, stock prices, yield curve, etc.). Six or more consecutive monthly declines have preceded every modern U.S. recession. The single best composite recession predictor.
          </p>
        </Card>

        <Card>
          <CardTitle>Consumer Sentiment (UMich)</CardTitle>
          <TimeSeriesChart
            data={filterByPeriod(data.consumerSentiment, period)}
            color="#FF9500"
            height={250}
            gradientId="umcsent"
            valueFormatter={(v) => formatNumber(v, { decimals: 1 })}
          />
          <p className="text-xs text-black/40 mt-3 leading-relaxed">
            University of Michigan survey measuring household confidence. Consumer spending is 70% of GDP — when sentiment collapses, spending follows. Readings below 60 have historically coincided with recessions.
          </p>
        </Card>
      </div>

      {/* ISM Manufacturing + Initial Claims */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardTitle>ISM Manufacturing Employment</CardTitle>
          <TimeSeriesChart
            data={filterByPeriod(data.ismManufacturing, period)}
            color="#007AFF"
            height={250}
            gradientId="ismMfg"
            valueFormatter={(v) => formatNumber(v, { decimals: 1 })}
          />
          <p className="text-xs text-black/40 mt-3 leading-relaxed">
            Above 50 = manufacturing employment expanding; below 50 = contracting. Manufacturing leads the business cycle — when factories cut workers, broader layoffs often follow. Sustained readings below 50 are a recession warning.
          </p>
        </Card>

        <Card>
          <CardTitle>Initial Jobless Claims (Weekly)</CardTitle>
          <TimeSeriesChart
            data={filterByPeriod(data.initialClaims, period)}
            color="#FF3B30"
            height={250}
            gradientId="icsa"
            valueFormatter={(v) => `${formatNumber(v, { decimals: 0 })}K`}
          />
          <p className="text-xs text-black/40 mt-3 leading-relaxed">
            The most timely labor market indicator — released weekly. Rising claims above 300K sustained have preceded every modern recession. The 4-week moving average smooths weekly volatility for clearer trend signals.
          </p>
        </Card>
      </div>

      {/* Building Permits + M2 Money Supply */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardTitle>Building Permits</CardTitle>
          <TimeSeriesChart
            data={filterByPeriod(data.buildingPermits, period)}
            color="#34C759"
            height={250}
            gradientId="permits"
            valueFormatter={(v) => `${formatNumber(v, { decimals: 0 })}K`}
          />
          <p className="text-xs text-black/40 mt-3 leading-relaxed">
            Housing is the most rate-sensitive sector. Permits drop 12-18 months before recession as higher borrowing costs choke off demand. Below 1M signals severe housing weakness; above 1.5M signals healthy construction activity.
          </p>
        </Card>

        <Card>
          <CardTitle>M2 Money Supply</CardTitle>
          <TimeSeriesChart
            data={filterByPeriod(data.m2, period)}
            color="#AF52DE"
            height={250}
            gradientId="m2"
            valueFormatter={(v) => `$${formatNumber(v / 1000, { decimals: 1 })}T`}
          />
          <p className="text-xs text-black/40 mt-3 leading-relaxed">
            M2 includes cash, checking, savings, and money market funds. Rapid M2 growth (2020-21) preceded the inflation surge; contraction in 2022-23 (first since 1930s) preceded disinflation. Money supply leads inflation by 12-18 months.
          </p>
        </Card>
      </div>

      {/* Market Regime Scenarios */}
      <Card>
        <CardTitle>Market Regime Scenarios</CardTitle>
        <p className="text-xs text-black/45 mt-1 mb-4">
          How different macro environments affect asset allocation
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-accent-green/20 rounded-xl p-4 bg-accent-green/[0.03]">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="green">Goldilocks</Badge>
            </div>
            <p className="text-xs text-black/55 mb-2">
              Moderate growth, contained inflation, accommodative policy.
            </p>
            <div className="text-xs text-black/40 space-y-0.5">
              <p>CPI 1.5-2.5% | Unemp &lt;4.5% | HY Spread &lt;3.5%</p>
              <p className="text-black/55 font-medium mt-1">
                Favors: Growth stocks, small caps, HY bonds
              </p>
            </div>
          </div>

          <div className="border border-accent-orange/20 rounded-xl p-4 bg-accent-orange/[0.03]">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="orange">Reflation</Badge>
            </div>
            <p className="text-xs text-black/55 mb-2">
              Rising inflation with solid growth. Economy running hot.
            </p>
            <div className="text-xs text-black/40 space-y-0.5">
              <p>CPI 3-5% | Unemp &lt;4.5% | Fed hiking</p>
              <p className="text-black/55 font-medium mt-1">
                Favors: Commodities, value, energy, TIPS
              </p>
            </div>
          </div>

          <div className="border border-accent-red/20 rounded-xl p-4 bg-accent-red/[0.03]">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="red">Stagflation</Badge>
            </div>
            <p className="text-xs text-black/55 mb-2">
              High inflation + rising unemployment. Worst for 60/40.
            </p>
            <div className="text-xs text-black/40 space-y-0.5">
              <p>CPI 4%+ | Unemp rising | HY Spread 6%+</p>
              <p className="text-black/55 font-medium mt-1">
                Favors: Gold, commodities, cash, short duration
              </p>
            </div>
          </div>

          <div className="border border-accent-blue/20 rounded-xl p-4 bg-accent-blue/[0.03]">
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="blue">Deflation / Contraction</Badge>
            </div>
            <p className="text-xs text-black/55 mb-2">
              Demand collapsing, prices falling. Fed cuts to zero + QE.
            </p>
            <div className="text-xs text-black/40 space-y-0.5">
              <p>CPI &lt;1% | Unemp rising sharply | HY Spread 8%+</p>
              <p className="text-black/55 font-medium mt-1">
                Favors: Long Treasuries, cash, defensive equities
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Interactive Key Indicators Summary */}
      <Card>
        <CardTitle>Key Indicators Summary</CardTitle>
        <p className="text-xs text-black/40 mt-1 mb-2">Click any indicator to see its significance and regime signal</p>
        <div>
          {indicators.map((indicator) => {
            const latest = getLatest(indicator.data);
            const change = getChange(indicator.data);
            const isExpanded = expandedIndicator === indicator.info.key;
            const signal = indicator.info.regimeSignal(latest);

            return (
              <div key={indicator.info.key}>
                <button
                  onClick={() =>
                    setExpandedIndicator(isExpanded ? null : indicator.info.key)
                  }
                  className="w-full flex items-center justify-between py-3 px-1 border-b border-black/[0.04] last:border-0 hover:bg-black/[0.02] transition-colors rounded-lg cursor-pointer text-left"
                >
                  <div className="flex items-center gap-2">
                    <svg
                      className={`w-3.5 h-3.5 text-black/30 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                    <span className="text-sm text-black/65 font-medium">{indicator.info.label}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={signal.badge}>{signal.regime}</Badge>
                    <span
                      className={`text-sm font-semibold tabular-nums ${
                        change > 0.1
                          ? 'text-accent-red'
                          : change < -0.1
                            ? 'text-accent-green'
                            : 'text-black/85'
                      }`}
                    >
                      {latest.toFixed(2)}{indicator.suffix}
                    </span>
                  </div>
                </button>

                {/* Expandable detail */}
                {isExpanded && (
                  <div className="ml-6 mr-1 mb-3 mt-1 p-4 bg-black/[0.02] rounded-xl border border-black/[0.04] animate-fade-in">
                    <p className="text-sm text-black/60 leading-relaxed mb-3">
                      {indicator.info.description}
                    </p>
                    <div className={`rounded-lg p-3 border ${
                      signal.badge === 'green'
                        ? 'bg-accent-green/[0.05] border-accent-green/15'
                        : signal.badge === 'red'
                          ? 'bg-accent-red/[0.05] border-accent-red/15'
                          : signal.badge === 'orange'
                            ? 'bg-accent-orange/[0.05] border-accent-orange/15'
                            : signal.badge === 'blue'
                              ? 'bg-accent-blue/[0.05] border-accent-blue/15'
                              : 'bg-black/[0.03] border-black/[0.06]'
                    }`}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <Badge variant={signal.badge}>{signal.regime}</Badge>
                        <span className="text-xs text-black/40">Current reading: {latest.toFixed(2)}%</span>
                      </div>
                      <p className="text-xs text-black/60 leading-relaxed">
                        {signal.explanation}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
