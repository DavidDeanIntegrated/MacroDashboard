'use client';

import { EconomicEvidence, EconomicOutlook } from '@/components/EconomicAssessment';
import { percentChange } from '@/lib/time-series';
import { zoneSignal, HIGHER_IS_BETTER, changeTone } from '@/lib/indicator-zones';
import type { EconomicAssessment as Assessment } from '@/lib/economy';

import { useState, useEffect, useRef } from 'react';
import { Card, CardTitle, MetricCard } from '@/components/ui/Card';
import { LoadingPage, ErrorState } from '@/components/ui/Loading';
import { Badge, RegimeBadge } from '@/components/ui/Badge';
import { TimeSeriesChart, MultiSeriesChart } from '@/components/charts/TimeSeriesChart';
import { YieldCurveChart } from '@/components/charts/YieldCurveChart';
import { useApi, useYieldCurve, useReleaseCalendar, useMultiAggregates, usePolygonSMA } from '@/lib/hooks';
import { formatPercent, formatNumber, formatCurrency } from '@/lib/format';
import { FRED_SERIES_NAMES } from '@/lib/fred';
import { Term, Explainer } from '@/components/ui/Term';

const fmtMonth = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
const fmtDay = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
// percentage-point move, explicit sign (+0.09pp / -0.07pp)
const fmtPp = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}pp`;

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
  corePceYoY?: Array<{ date: string; value: number }>;
  breakeven10y?: Array<{ date: string; value: number }>;
  moveIndex: Array<{ date: string; value: number }>;
  assessment?: Assessment;
  regime: {
    regime: string;
    label: string;
    description: string;
    inflationTrend: string;
    growthTrend: string;
    latestInflation: number | null;
    latestUnemployment: number | null;
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

// Indicators (keyed by INDICATOR_INFO.key) where a rising value is a positive
// signal. For everything else, a rising value is treated as negative (the
// default "up = bad" convention used for VIX, MOVE, HY spread, unemployment,
// CPI, initial claims, etc.).
// HIGHER_IS_BETTER and the level zones live in lib/indicator-zones so the Guide page reads the same table.

// Convert a monthly level series into year-over-year % change (index offset of 12
// works because these FRED series are strictly monthly with no gaps).
function toYoY(series: Array<{ date: string; value: number }>) { return percentChange(series ?? [], 12); }

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
  return data.length > 0 ? data[data.length - 1].value : NaN;
}

function getChange(data: Array<{ date: string; value: number }>, periods = 1): number {
  if (data.length < periods + 1) return NaN;
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
    regimeSignal: zoneSignal('FEDFUNDS'),
  },
  DGS2: {
    key: 'DGS2',
    label: FRED_SERIES_NAMES['DGS2'],
    description:
      'The yield on 2-year government bonds. This is the most rate-sensitive Treasury and closely tracks expectations for near-term Fed policy. It leads the curve — when the 2Y rises above the 10Y, the curve inverts.',
    regimeSignal: zoneSignal('DGS2'),
  },
  DGS10: {
    key: 'DGS10',
    label: FRED_SERIES_NAMES['DGS10'],
    description:
      'The benchmark "risk-free" rate used to discount nearly every financial asset. Reflects long-term growth and inflation expectations. When it rises, equity multiples compress; when it falls, bonds rally.',
    regimeSignal: zoneSignal('DGS10'),
  },
  T10Y2Y: {
    key: 'T10Y2Y',
    label: FRED_SERIES_NAMES['T10Y2Y'],
    description:
      'The yield curve slope — the difference between 10Y and 2Y yields. The single most reliable recession predictor. Every U.S. recession since 1955 was preceded by an inversion. The un-inversion is when recession typically starts.',
    regimeSignal: zoneSignal('T10Y2Y'),
  },
  CPIYOY: {
    key: 'CPIYOY',
    label: 'CPI YoY Inflation',
    description:
      'The rate at which consumer prices are rising. The Fed targets 2%. Too high erodes purchasing power and forces tightening; too low (deflation) signals weak demand and can spiral into a debt crisis.',
    regimeSignal: zoneSignal('CPIYOY'),
  },
  UNRATE: {
    key: 'UNRATE',
    label: FRED_SERIES_NAMES['UNRATE'],
    description:
      'A lagging indicator — by the time unemployment rises meaningfully, recession has usually begun. The Sahm Rule triggers when the 3-month average rises 0.50% above its 12-month low. See the Sahm Rule panel on the chart below for the current 12-month low and trigger status.',
    regimeSignal: zoneSignal('UNRATE'),
  },
  BAMLH0A0HYM2: {
    key: 'BAMLH0A0HYM2',
    label: FRED_SERIES_NAMES['BAMLH0A0HYM2'],
    description:
      'The extra yield investors demand for risky corporate bonds over Treasuries. Measures credit stress and risk appetite in real time. Bond markets often lead equities — widening spreads are an early warning.',
    regimeSignal: zoneSignal('BAMLH0A0HYM2'),
  },
  VIXCLS: {
    key: 'VIXCLS',
    label: FRED_SERIES_NAMES['VIXCLS'],
    description:
      'The CBOE Volatility Index measures 30-day expected volatility of the S&P 500, derived from options prices. Known as the "fear gauge" — it spikes during panics and crashes. Historically, VIX above 40 has coincided with major market bottoms.',
    regimeSignal: zoneSignal('VIXCLS'),
  },
  USALOLITONOSTSAM: {
    key: 'USALOLITONOSTSAM',
    label: FRED_SERIES_NAMES['USALOLITONOSTSAM'],
    description:
      'The OECD Composite Leading Indicator for the United States — designed to anticipate turning points in economic activity relative to trend. Indexed to 100: above 100 signals expansion above trend, below 100 signals contraction below trend. Includes components like yield curve, building permits, stock prices, and manufacturing orders.',
    regimeSignal: (v) => {
      // OECD CLI is indexed at 100 = long-term trend
      if (v < 98.5)
        return { regime: 'Contraction signal', badge: 'red', explanation: 'CLI well below 100 signals the economy is contracting relative to trend. Historically precedes or coincides with recession.' };
      if (v < 99.5)
        return { regime: 'Slowing', badge: 'orange', explanation: 'CLI declining toward 100 suggests growth is losing momentum. Watch for sustained declines below trend.' };
      if (v < 101)
        return { regime: 'Stable Growth', badge: 'green', explanation: 'CLI near or above 100 indicates the economy is growing at or above trend. No recession signal.' };
      return { regime: 'Strong Expansion', badge: 'blue', explanation: 'CLI well above 100 reflects broad economic strength above the long-term trend.' };
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
    label: 'Manufacturing Jobs (YoY Growth)',
    description:
      'Total U.S. manufacturing employment from the BLS payroll survey (about 12-13 million jobs), shown here as year-over-year percent change. Factories feel demand shifts before the rest of the economy — orders slow, shifts get cut, then layoffs spread to services. Sustained job losses in manufacturing have accompanied every modern recession. (Note: this is the official jobs count, not the ISM survey.)',
    regimeSignal: (v) => {
      if (v < -1.5)
        return { regime: 'Deep contraction', badge: 'red', explanation: 'Manufacturing payrolls shrinking more than 1.5% per year — factories are cutting workers at a pace historically seen only in recessions. Watch for the weakness to spread into services hiring.' };
      if (v < 0)
        return { regime: 'Contraction', badge: 'orange', explanation: 'Manufacturing is losing jobs versus a year ago. Mild declines can happen mid-cycle, but a deepening trend is an early recession warning for the industrial economy.' };
      if (v < 2)
        return { regime: 'Moderate expansion', badge: 'green', explanation: 'Manufacturing payrolls growing modestly year-over-year — consistent with a healthy industrial sector and steady GDP growth.' };
      return { regime: 'Strong expansion', badge: 'blue', explanation: 'Factories adding workers at an unusually fast clip — strong industrial demand, typically seen in early-to-mid cycle recoveries.' };
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
    label: 'M2 Money Supply (YoY Growth)',
    description:
      'M2 is roughly all readily spendable money in the economy — cash, checking, savings, and money-market funds. What matters is its growth rate, not the raw level: the 2020-21 surge (+25%/yr) preceded the inflation spike, and the 2022-23 contraction (first since the 1930s) preceded disinflation. Money supply tends to lead inflation by 12-18 months.',
    regimeSignal: (v) => {
      if (v < 0)
        return { regime: 'Contracting liquidity', badge: 'red', explanation: 'The money supply is shrinking outright — historically rare and strongly disinflationary. A headwind for asset prices, especially speculative ones, until growth resumes.' };
      if (v < 3)
        return { regime: 'Tight', badge: 'orange', explanation: 'Money growing slower than the economy typically needs (~3-6%/yr). Gradually restrictive — consistent with cooling inflation but also less fuel for asset prices.' };
      if (v < 8)
        return { regime: 'Normal', badge: 'green', explanation: 'Money supply growth in its healthy historical range — enough liquidity to support growth without stoking inflation.' };
      return { regime: 'Rapid expansion', badge: 'blue', explanation: 'Money supply growing much faster than the real economy. Supportive for asset prices near-term, but historically feeds consumer inflation with a 12-18 month lag (see 2020-21).' };
    },
  },
  COREPCE: {
    key: 'COREPCE',
    label: 'Core PCE Inflation (YoY)',
    description:
      'The Fed\'s preferred inflation gauge — the price index for personal consumption excluding volatile food and energy. When officials say the "2% target," this is the exact number they mean, so the gap between Core PCE and 2% is the cleanest read on how much pressure the Fed is under. It typically runs ~0.3-0.5 points cooler than CPI.',
    regimeSignal: (v) => {
      if (v < 1)
        return { regime: 'Below target / Deflation risk', badge: 'blue', explanation: 'Core inflation well under 2% gives the Fed room to cut aggressively — and raises worry about demand weakness rather than price stability.' };
      if (v < 2.5)
        return { regime: 'At target', badge: 'green', explanation: 'Core PCE at or near 2% is mission accomplished for the Fed — no inflation pressure forcing tight policy. The friendliest inflation backdrop for both stocks and bonds.' };
      if (v < 3.5)
        return { regime: 'Above target', badge: 'orange', explanation: 'Core inflation meaningfully above 2% keeps the Fed biased toward tight policy. Rate cuts get delayed; each hot monthly print pushes them further out.' };
      return { regime: 'Far above target', badge: 'red', explanation: 'Core PCE this far above target forces aggressive Fed tightening regardless of what it does to growth — the setup where policy itself becomes the market risk.' };
    },
  },
  T10YIE: {
    key: 'T10YIE',
    label: '10Y Breakeven Inflation',
    description:
      'The bond market\'s own 10-year inflation forecast, derived from the price gap between regular Treasuries and inflation-protected ones (TIPS). Unlike CPI (which reports the past), breakevens are forward-looking and update every trading day. The Fed watches them closely: stable breakevens near 2-2.5% mean the market trusts the Fed; rising breakevens mean inflation expectations are becoming "unanchored."',
    regimeSignal: (v) => {
      if (v < 1.5)
        return { regime: 'Deflation worry', badge: 'blue', explanation: 'The market is pricing very low inflation for a decade — usually a demand-weakness signal that comes with falling yields and defensive positioning.' };
      if (v < 2.5)
        return { regime: 'Anchored', badge: 'green', explanation: 'Expectations sit right around the Fed\'s target. The market believes inflation is under control — the backdrop where the Fed has the most flexibility.' };
      if (v < 3)
        return { regime: 'Drifting higher', badge: 'orange', explanation: 'The market is starting to price persistently above-target inflation. If this trend continues, it pressures the Fed to stay tighter for longer and favors real assets over long bonds.' };
      return { regime: 'Unanchored risk', badge: 'red', explanation: 'Breakevens near 3%+ signal the market is losing confidence in the 2% target — historically the trigger for forceful Fed action and a strong environment for gold and commodities.' };
    },
  },
  MOVE: {
    key: 'MOVE',
    label: 'MOVE Index (Bond Volatility)',
    description:
      'The Merrill Lynch Option Volatility Estimate — the bond market\'s VIX. Measures expected volatility in US Treasury options across the yield curve. When MOVE spikes, it signals uncertainty about rate policy, credit conditions, and macro trajectory. Bond volatility often leads equity volatility.',
    regimeSignal: (v) => {
      if (v > 150)
        return { regime: 'Crisis / Dislocation', badge: 'red', explanation: 'MOVE above 150 signals extreme bond market stress. Historically seen during financial crises (2008, 2020, 2023 banking crisis). Liquidity is drying up and Treasury market functioning may be impaired.' };
      if (v > 120)
        return { regime: 'Elevated stress', badge: 'orange', explanation: 'Bond volatility elevated — rate uncertainty is high. The market is pricing in significant policy uncertainty. Typically accompanies aggressive Fed tightening or macro inflection points.' };
      if (v > 80)
        return { regime: 'Normal', badge: 'green', explanation: 'MOVE in the 80-120 range reflects typical rate uncertainty. Bond markets are functioning normally with moderate hedging demand.' };
      return { regime: 'Calm / Complacent', badge: 'blue', explanation: 'Very low bond volatility suggests strong consensus on rate path. Often seen during steady Fed policy. Can precede complacency — watch for a snapback.' };
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

  // Sahm Rule — official definition: the current 3-month moving average of the
  // unemployment rate minus the MINIMUM of the 3-month moving averages over the
  // preceding 12 months. (Comparing against raw monthly lows overstates the value.)
  const unempData = data.unemployment || [];
  const sahmInfo = (() => {
    if (unempData.length < 15) return null;
    const vals = unempData.map((d: { value: number }) => d.value);
    const avg3At = (i: number) => (vals[i] + vals[i - 1] + vals[i - 2]) / 3;
    const n = vals.length - 1;
    const avg3 = avg3At(n);
    let low12 = Infinity;
    for (let i = n - 12; i < n; i++) low12 = Math.min(low12, avg3At(i));
    const sahmValue = avg3 - low12;
    const triggered = sahmValue >= 0.5;
    return { low12, avg3, sahmValue, triggered };
  })();

  // 10Y-2Y spread context — everything the explainer under the chart cites is
  // computed from the full FRED history (daily since 1976), so the narrative
  // always describes today's reading instead of a hard-coded snapshot.
  const spreadInfo = (() => {
    const s = data.t10y2y || [];
    if (s.length < 300) return null;
    const last = s[s.length - 1];
    const back = (n: number) => s[Math.max(0, s.length - 1 - n)];
    const monthChange = last.value - back(21).value;
    const yearChange = last.value - back(252).value;

    // Inversion episodes: contiguous runs below zero, merging positive
    // flickers shorter than ~2 trading weeks (the Aug/Sep-2024 re-crossing
    // whipsawed around zero for days; those blips aren't separate episodes).
    const runs: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i].value >= 0) continue;
      const prev = runs[runs.length - 1];
      if (prev && i - prev.end <= 10) prev.end = i;
      else runs.push({ start: i, end: i });
    }
    const ep = runs[runs.length - 1];
    if (!ep) return null;
    let trough = s[ep.start];
    for (let i = ep.start; i <= ep.end; i++) if (s[i].value < trough.value) trough = s[i];
    const monthsBetween = (a: string, b: string) =>
      Math.round((new Date(b).getTime() - new Date(a).getTime()) / (30.44 * 24 * 3600 * 1000));
    const episodeMonths = monthsBetween(s[ep.start].date, s[ep.end].date);
    const isLongest = runs.every(
      (r) => r === ep || monthsBetween(s[r.start].date, s[r.end].date) <= episodeMonths
    );
    const stillInverted = ep.end === s.length - 1;
    const positiveSince = s[Math.min(ep.end + 1, s.length - 1)].date;
    const monthsPositive = monthsBetween(positiveSince, last.date);

    // Which leg is moving: the same spread change means opposite things
    // depending on whether the 2Y or the 10Y is doing the work.
    const legChange = (arr: Array<{ value: number }>) =>
      arr.length > 63 ? arr[arr.length - 1].value - arr[arr.length - 1 - 63].value : 0;
    const d2y = legChange(data.t2y || []);
    const d10y = legChange(data.t10y || []);

    return {
      last, monthChange, yearChange, episodeMonths, isLongest, stillInverted,
      inversionStart: s[ep.start].date, inversionEnd: s[ep.end].date,
      trough, positiveSince, monthsPositive, d2y, d10y,
    };
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
    { info: INDICATOR_INFO['USALOLITONOSTSAM'], data: data.lei, suffix: '' },
    { info: INDICATOR_INFO['UMCSENT'], data: data.consumerSentiment, suffix: '' },
    { info: INDICATOR_INFO['PERMIT'], data: data.buildingPermits, suffix: 'K' },
    { info: INDICATOR_INFO['MANEMP'], data: toYoY(data.ismManufacturing), suffix: '%' },
    { info: INDICATOR_INFO['ICSA'], data: data.initialClaims.map((d) => ({ ...d, value: d.value / 1000 })), suffix: 'K' },
    { info: INDICATOR_INFO['M2SL'], data: toYoY(data.m2), suffix: '%' },
    { info: INDICATOR_INFO['COREPCE'], data: data.corePceYoY || [], suffix: '%' },
    { info: INDICATOR_INFO['T10YIE'], data: data.breakeven10y || [], suffix: '%' },
    { info: INDICATOR_INFO['MOVE'], data: data.moveIndex || [], suffix: '' },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-black/85 tracking-tight">Macro Overview</h2>
          <p className="text-sm text-black/45 mt-1">
            Economic indicators and macro regime analysis
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 sm:gap-0">
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
            <div className="max-w-xl">
              <Explainer title="How is this regime determined — and what's the evidence?">
                <EconomicEvidence assessment={data.assessment} />
              </Explainer>
              <EconomicOutlook assessment={data.assessment} />
            </div>
          </div>
          <div className="text-left sm:text-right space-y-2 shrink-0 sm:ml-8">
            <div>
              <p className="text-xxs text-black/35 uppercase">CPI inflation (YoY)</p>
              <p className="text-lg font-semibold tabular-nums text-black/85">
                {(regime.latestInflation === null ? '—' : formatPercent(regime.latestInflation))}
              </p>
            </div>
            <div>
              <p className="text-xxs text-black/35 uppercase">Unemployment</p>
              <p className="text-lg font-semibold tabular-nums text-black/85">
                {(regime.latestUnemployment?.toFixed(1) ?? '—')}%
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* Key metrics row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <MetricCard
          label="Fed Funds Rate"
          value={`${(Number.isFinite(getLatest(data.fedFunds)) ? getLatest(data.fedFunds).toFixed(2) : "—")}%`}
          change={formatPercent(getChange(data.fedFunds))}
          trend={changeTone(getChange(data.fedFunds), false, 0)}
        />
        <MetricCard
          label="10Y Treasury"
          value={`${(Number.isFinite(getLatest(data.t10y)) ? getLatest(data.t10y).toFixed(2) : "—")}%`}
          change={formatPercent(getChange(data.t10y))}
          trend={changeTone(getChange(data.t10y), false, 0.02)}
        />
        <MetricCard
          label="CPI YoY"
          value={formatPercent(getLatest(data.cpiYoY))}
          change={formatPercent(getChange(data.cpiYoY))}
          changeLabel="vs prev"
          trend={changeTone(getChange(data.cpiYoY), false, 0.05)}
        />
        <MetricCard
          label="HY Spread"
          value={`${(Number.isFinite(getLatest(data.highYieldSpread)) ? getLatest(data.highYieldSpread).toFixed(2) : "—")}%`}
          change={formatPercent(getChange(data.highYieldSpread))}
          trend={changeTone(getChange(data.highYieldSpread), false, 0.02)}
        />
        <MetricCard
          label="VIX"
          value={(Number.isFinite(getLatest(data.vix)) ? getLatest(data.vix).toFixed(1) : "—")}
          change={formatNumber(getChange(data.vix), { decimals: 1 })}
          trend={changeTone(getChange(data.vix), false, 0.3)}
        />
      </div>

      {/* Yield Curve */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardTitle>Yield Curve (Live)</CardTitle>
          {yieldCurve && <YieldCurveChart data={yieldCurve} height={280} />}
          <p className="text-xs text-black/40 mt-3 leading-relaxed">
            The <Term k="yield-curve">yield curve</Term> plots what the U.S. government pays to borrow for 3 months out to 30 years. A normal upward slope means lenders demand extra return for longer commitments — a healthy-economy shape. When short rates sit <em>above</em> long rates (an <Term k="inversion">inversion</Term>), the bond market is betting the Fed will be forced to cut rates because a slowdown is coming — a pattern that has preceded every U.S. recession since 1955.
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
            The most-watched single recession signal: the 10-year <Term k="treasury">Treasury yield</Term> minus the 2-year. Negative values (<Term k="inversion">inversion</Term>) have warned of recession 6-24 months ahead every time since 1955. Counterintuitively, the <em>un-inversion</em> — this line turning positive again as the Fed starts cutting short rates — is often when the recession actually arrives, so a fresh flip back above zero is a caution flag, not an all-clear.
          </p>
          <Explainer title="How to read this chart — and where the spread stands today">
            <p>
              <span className="font-medium text-black/70">What the line is.</span> Each point is one subtraction: the 10-year <Term k="treasury">Treasury</Term> yield minus the 2-year, in percentage points. The 2Y is essentially a bet on where the Fed&apos;s policy rate will average over the next two years, so it jumps when rate expectations move. The 10Y bundles long-run growth and inflation expectations plus a <Term def="The extra yield investors demand for locking money up longer, given uncertainty about future rates and inflation.">term premium</Term>. The spread therefore compresses when the Fed tightens harder than the long-run outlook justifies, and widens when policy is easy relative to it.
            </p>
            <p>
              <span className="font-medium text-black/70">The zones on the graph.</span> Roughly +0.1% to +1.5% is the healthy slope — lenders earn a real reward for lending long, banks borrow short and lend long profitably. Hugging zero is late-cycle flattening: the Fed leaning on the brakes. Below zero is an <Term k="inversion">inversion</Term> — short money out-yields long money, which only makes sense if the market expects rate cuts, i.e. trouble; deeper than about −0.3% has preceded recession by 6-24 months every time since 1955. Above ~+1.5% usually appears just <em>after</em> a downturn, once heavy Fed cuts re-steepen the curve.
            </p>
            <p>
              <span className="font-medium text-black/70">The sequence that matters.</span> The classic pattern on this graph is a shape, not a level: dive below zero, sit there while the Fed stays tight, then snap back up through zero as the Fed cuts the short end fast. Recessions historically begin near that <em>re-crossing</em>, not at the initial inversion — so the steep climb back above zero is the caution window, and merely being positive again is not an all-clear.
            </p>
            {spreadInfo && (
              <>
                <p>
                  <span className="font-medium text-black/70">Where we stand today.</span> The latest reading is <span className="font-semibold text-black/75 tabular-nums">{spreadInfo.last.value >= 0 ? '+' : ''}{spreadInfo.last.value.toFixed(2)}%</span> ({fmtDay(spreadInfo.last.date)}) — {INDICATOR_INFO['T10Y2Y'].regimeSignal(spreadInfo.last.value).regime.toLowerCase()} territory on the scale above. It has moved {fmtPp(spreadInfo.monthChange)} over the past month and {fmtPp(spreadInfo.yearChange)} over the past year.{' '}
                  {spreadInfo.stillInverted ? (
                    <>The curve has been inverted since {fmtMonth(spreadInfo.inversionStart)} ({spreadInfo.episodeMonths} months{spreadInfo.isLongest ? ' — the longest stretch in this dataset, which starts in 1976' : ''}), so far bottoming at {spreadInfo.trough.value.toFixed(2)}% in {fmtMonth(spreadInfo.trough.date)}. History says the alarm rings loudest when this line climbs back through zero.</>
                  ) : (
                    <>The last inversion ran {fmtMonth(spreadInfo.inversionStart)} to {fmtMonth(spreadInfo.inversionEnd)} — {spreadInfo.episodeMonths} months{spreadInfo.isLongest ? ', the longest stretch in this dataset (which starts in 1976)' : ''} — bottoming at {spreadInfo.trough.value.toFixed(2)}% in {fmtMonth(spreadInfo.trough.date)}. The spread has now been positive for {spreadInfo.monthsPositive} months. By the historical playbook that un-inversion was the starting gun, so every additional month of growth makes this cycle look like either the signal&apos;s first false alarm since 1955 or an unusually long lead time — worth respecting, not worth panicking over.</>
                  )}
                </p>
                <p>
                  <span className="font-medium text-black/70">Which leg is moving.</span> The same spread change can mean opposite things depending on which yield is doing the work. Over the past ~3 months the 2Y moved {fmtPp(spreadInfo.d2y)} and the 10Y {fmtPp(spreadInfo.d10y)}.{' '}
                  {(() => {
                    const slopeMove = spreadInfo.d10y - spreadInfo.d2y;
                    if (Math.abs(slopeMove) < 0.05)
                      return 'That is a roughly parallel shift — the slope itself has barely changed, so the message of this chart is unchanged from recent months.';
                    if (slopeMove > 0) {
                      return spreadInfo.d2y < -0.05
                        ? 'Steepening led by the short end falling — a "bull steepener." That is the market pricing in Fed cuts, historically the growth-scare flavor of steepening; watch the jobs data for confirmation.'
                        : 'Steepening led by the long end rising — a "bear steepener." That reflects term-premium or inflation-expectation pressure rather than recession pricing; it pressures long-duration assets but is not the classic pre-recession shape.';
                    }
                    return spreadInfo.d2y > 0.05
                      ? 'Flattening led by the short end rising — a "bear flattener," the market pricing a tighter Fed for longer. This is the classic late-cycle squeeze that eventually produces inversions.'
                      : 'Flattening led by the long end falling — a "bull flattener," long rates dropping on growth worries while the Fed holds. Often an early risk-off tell.';
                  })()}
                </p>
              </>
            )}
          </Explainer>
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

        // The benchmark fetch caps lookback at ~3 years (see fromDate above), so
        // the actual data span can be shorter than the selected period. Label the
        // "period" cards with the true available span so the number agrees with
        // the label (e.g. "10Y" selected but only ~3Y of data available).
        const spanLabel = (data: typeof spyData): string => {
          if (data.length < 2) return period;
          const spanDays =
            (new Date(data[data.length - 1].date).getTime() -
              new Date(data[0].date).getTime()) /
            (1000 * 60 * 60 * 24);
          const selectedDays = periodMap[period] * 30;
          // If the data covers (nearly) the full selected period, keep the label.
          if (period !== 'MAX' && spanDays >= selectedDays * 0.95) return period;
          const years = spanDays / 365;
          const trueLabel = years >= 1 ? `~${Math.round(years)}Y` : `~${Math.round(spanDays / 30)}M`;
          return period === 'MAX' ? trueLabel : `${trueLabel} (max avail.)`;
        };
        const spyPeriodLabel = spanLabel(spyData);
        const qqqPeriodLabel = spanLabel(qqqData);

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
                change={spyPeriodLabel}
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
                change={qqqPeriodLabel}
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
                  The colored lines are <Term k="sma">moving averages</Term> — the average price over the last 50 and 200 trading days, smoothing daily noise into trend. Price above both = healthy uptrend. Price below the 200-day = bear-market territory. The 50-day crossing below the 200-day (&quot;death cross&quot;) is a widely-watched deterioration signal; crossing above (&quot;golden cross&quot;) marks recovering momentum.
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
                  Both lines are <Term k="indexed-100">indexed to 100</Term> at the start of the window so you&apos;re comparing percentage growth, not prices. QQQ (the tech-heavy Nasdaq 100) pulling ahead = investors reaching for <Term k="growth-stocks">growth</Term> — a <Term k="risk-on">risk-on</Term> mood. SPY (the broad S&amp;P 500) leading = money rotating toward <Term k="value-stocks">value</Term> and safety.
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
          <Term k="cpi">CPI</Term> measures how fast everyday prices are rising versus a year ago; the Fed targets about 2%. Near 2%, the Fed can keep policy easy — bullish for <Term k="growth-stocks">growth stocks</Term>. Above 3-4%, the Fed is forced to raise rates, which compresses <Term k="multiple">valuation multiples</Term> and shifts the advantage to commodities and <Term k="value-stocks">value stocks</Term>. Below 0% (outright deflation) signals collapsing demand — a crisis, not a victory.
        </p>
      </Card>

      {/* Core PCE + Breakeven Inflation */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardTitle>Core PCE — The Fed&apos;s Preferred Gauge</CardTitle>
          <TimeSeriesChart
            data={filterByPeriod(data.corePceYoY || [], period)}
            color="#FF6B35"
            height={250}
            gradientId="corePce"
            valueFormatter={(v) => `${v.toFixed(2)}%`}
          />
          <p className="text-xs text-black/40 mt-3 leading-relaxed">
            <Term k="core-pce">Core PCE</Term> is the inflation number the Fed actually targets — consumer prices excluding volatile food and energy. The gap between this line and 2% is the cleanest read on how much pressure the Fed is under: at 2%, rate cuts are on the table; each half-point above it pushes them further away. It usually runs a few tenths cooler than the CPI headline above.
          </p>
        </Card>

        <Card>
          <CardTitle>10Y Breakeven — Market Inflation Expectations</CardTitle>
          <TimeSeriesChart
            data={filterByPeriod(data.breakeven10y || [], period)}
            color="#AF52DE"
            height={250}
            gradientId="breakeven10y"
            valueFormatter={(v) => `${v.toFixed(2)}%`}
          />
          <p className="text-xs text-black/40 mt-3 leading-relaxed">
            The <Term k="breakeven">breakeven rate</Term> is the bond market&apos;s own forecast of average inflation over the next 10 years, extracted from <Term k="tips">TIPS</Term> prices. CPI reports the past; this prices the future, every trading day. Steady readings near 2-2.5% mean expectations are &quot;anchored&quot; (the market trusts the Fed). A sustained climb toward 3% is the early-warning sign that would favor <Term k="reflation">reflation</Term> assets — gold, commodities, value — over long bonds.
          </p>
        </Card>
      </div>

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
            The <Term k="fed-funds">fed funds rate</Term> is the base cost of money that every other rate — mortgages, corporate debt, margin loans — builds on. Rising rates cool the economy and compress asset valuations; falling rates stimulate growth and lift risk assets. The <em>direction</em> matters more than the level: markets move on where the Fed is headed, hence the old rule &quot;don&apos;t fight the Fed.&quot;
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
            A <Term k="lagging-indicator">lagging indicator</Term> — by the time unemployment rises clearly, the recession has usually already begun, which is exactly what makes it useful as a confirmation signal. Below ~4.5% signals a strong labor market. The panel below tracks the <Term k="sahm-rule">Sahm Rule</Term>: when the 3-month average unemployment rate climbs 0.50 points above its lowest 3-month average of the past year, a recession has started — every time since 1970, with no false alarms.
          </p>
          {sahmInfo && (
            <div className={`mt-2 rounded-lg p-2.5 border ${sahmInfo.triggered ? 'bg-accent-red/[0.04] border-accent-red/10' : 'bg-black/[0.02] border-black/[0.06]'}`}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-black/55">Sahm Rule Indicator</span>
                <Badge variant={sahmInfo.triggered ? 'red' : 'green'}>
                  {sahmInfo.triggered ? 'Triggered' : 'Not Triggered'}
                </Badge>
              </div>
              <p className="text-[11px] text-black/45 mt-1.5 leading-relaxed">
                {sahmInfo.triggered
                  ? 'Unemployment has risen enough from its recent low that, historically, a recession has always already been underway. Treat defensive positioning and the dry-powder ladder as active considerations.'
                  : `In plain terms: unemployment would need to rise ${(0.5 - sahmInfo.sahmValue).toFixed(2)} more points (3-month average) to trip this recession signal. Small wiggles are normal; the trigger is deliberately set where no false alarm has ever occurred.`}
              </p>
              <div className="grid grid-cols-3 gap-3 mt-2">
                <div>
                  <p className="text-[10px] text-black/35 uppercase tracking-wider">12-Mo Low (3-Mo Avg)</p>
                  <p className="text-sm font-bold tabular-nums text-black/70">{sahmInfo.low12.toFixed(2)}%</p>
                </div>
                <div>
                  <p className="text-[10px] text-black/35 uppercase tracking-wider">Current 3-Mo Avg</p>
                  <p className="text-sm font-bold tabular-nums text-black/70">{sahmInfo.avg3.toFixed(2)}%</p>
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

      {/* VIX + MOVE */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardTitle>VIX — Equity Fear Gauge</CardTitle>
          <TimeSeriesChart
            data={filterByPeriod(data.vix, period)}
            color="#FF3B30"
            height={250}
            gradientId="vix"
            valueFormatter={(v) => v.toFixed(1)}
          />
          <p className="text-xs text-black/40 mt-3 leading-relaxed">
            The <Term k="vix">VIX</Term> measures how much movement option traders are paying to protect against in the S&P 500 over the next 30 days — a real-money fear gauge. Below 15 = calm (sometimes complacent). 20-30 = elevated caution. Above 30 = high fear. Above 40 = panic — which, counterintuitively, has historically marked major buying opportunities, because peak fear and peak selling tend to arrive together.
          </p>
        </Card>

        <Card>
          <CardTitle>MOVE Index — Bond Volatility</CardTitle>
          <TimeSeriesChart
            data={filterByPeriod(data.moveIndex || [], period)}
            color="#FF6B35"
            height={250}
            gradientId="move"
            valueFormatter={(v) => v.toFixed(1)}
          />
          <p className="text-xs text-black/40 mt-3 leading-relaxed">
            The <Term k="move">MOVE index</Term> is the bond market&apos;s version of the VIX — expected turbulence in U.S. Treasury prices. Below 80 = calm. 80-120 = normal. Above 120 = stress. Above 150 = crisis-level dislocation (2008, the 2023 bank failures). Worth watching because Treasuries are the foundation every other market is priced off — when the <em>safe</em> asset gets volatile, equity trouble often follows.
          </p>
        </Card>
      </div>

      {/* Credit Spread */}
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
          The <Term k="hy-spread">high-yield spread</Term> is the extra interest risky (&quot;junk-rated&quot;) companies must pay to borrow versus the U.S. government — a real-time vote on how worried lenders are about defaults. Below 3.5% = relaxed, easy credit (<Term k="risk-on">risk-on</Term>). Above 5-6% = stress building. Above 8% = panic; credit is freezing and the Fed typically steps in. Credit markets often sniff out trouble before stock markets do, which makes widening spreads an early warning.
        </p>
      </Card>

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
          Physical output from America&apos;s factories, mines, and power plants (2017 = 100). Unlike <Term k="gdp">GDP</Term>, it&apos;s monthly and measures <em>things made</em>, not prices — so it can&apos;t be inflated by rising prices. A rising trend confirms real expansion; sustained declines signal contraction. It tends to peak a few months before recessions and bottom before recoveries begin.
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
          <CardTitle>OECD Leading Indicator (US)</CardTitle>
          <TimeSeriesChart
            data={filterByPeriod(data.lei, period)}
            color="#5856D6"
            height={250}
            gradientId="lei"
            valueFormatter={(v) => formatNumber(v, { decimals: 1 })}
          />
          <p className="text-xs text-black/40 mt-3 leading-relaxed">
            The OECD&apos;s composite <Term k="lei">leading indicator</Term> blends several early-warning statistics — the <Term k="yield-curve">yield curve</Term>, building permits, stock prices, manufacturing orders — into one number designed to turn 6-9 months <em>before</em> the economy does. It&apos;s indexed so 100 = normal trend growth: readings above 100 signal above-trend expansion; sustained slides below ~99 have historically preceded recessions.
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
            A monthly University of Michigan survey asking households how they feel about their finances and the economy. It matters because consumer spending is ~70% of U.S. <Term k="gdp">GDP</Term> — when confidence collapses, spending cuts follow within months. Readings below 60 have historically coincided with recessions; readings above 90 accompany strong job markets with contained inflation.
          </p>
        </Card>
      </div>

      {/* ISM Manufacturing + Initial Claims */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardTitle>Manufacturing Employment (BLS)</CardTitle>
          <TimeSeriesChart
            data={filterByPeriod(data.ismManufacturing, period)}
            color="#007AFF"
            height={250}
            gradientId="ismMfg"
            valueFormatter={(v) => `${(v / 1000).toFixed(2)}M jobs`}
          />
          <p className="text-xs text-black/40 mt-3 leading-relaxed">
            Total U.S. factory jobs from the official BLS payroll count (~12-13 million). Manufacturing feels demand shifts first — orders slow, overtime disappears, then layoffs start — so factory payrolls rolling over is an early warning that often spreads to the broader job market. The Key Indicators table below scores this as year-over-year growth, where sustained declines have accompanied every modern recession.
          </p>
        </Card>

        <Card>
          <CardTitle>Initial Jobless Claims (Weekly)</CardTitle>
          <TimeSeriesChart
            data={filterByPeriod(data.initialClaims, period).map((d) => ({ ...d, value: d.value / 1000 }))}
            color="#FF3B30"
            height={250}
            gradientId="icsa"
            valueFormatter={(v) => `${formatNumber(v, { decimals: 0 })}K`}
          />
          <p className="text-xs text-black/40 mt-3 leading-relaxed">
            The number of people filing for unemployment benefits for the first time each week — the freshest read on layoffs anywhere in the data (published every Thursday, days old). 200-260K is a normal, healthy churn. A sustained climb above ~300K has preceded every modern recession. Because single weeks are noisy (holidays, storms), trust the trend over any one print.
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
            New home-building permits authorized each month (annualized). Housing is the economy&apos;s most interest-rate-sensitive sector — when mortgage rates jump, builders pull back here first, typically 12-18 months before a broader recession. Below 1M/yr signals severe housing weakness (2008-09, 2020 levels); 1.3-1.6M is healthy; well above that risks overbuilding.
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
            <Term k="m2">M2</Term> is roughly all readily spendable money in the economy — cash, checking, savings, and money-market funds. The chart shows the level, but the <em>growth rate</em> is the signal (and is what the Key Indicators table scores): the +25%/yr surge of 2020-21 preceded the inflation spike, and the 2022-23 contraction — the first since the 1930s — preceded disinflation. More money chasing the same goods lifts prices with a 12-18 month lag.
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
              <Badge variant="blue">Disinflation / Contraction</Badge>
            </div>
            <p className="text-xs text-black/55 mb-2">
              Inflation cooling while demand weakens. Fed cuts — in a severe version, to zero plus QE.
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
        <p className="text-xs text-black/40 mt-1 mb-2">
          Click any indicator for a plain-English explanation of what it measures and what its current reading historically implies. Green/red on the value shows whether the latest move is helping or hurting. (Manufacturing Jobs and M2 are scored as year-over-year growth rates, since their trends carry the signal, not their levels.)
        </p>
        <div>
          {indicators.map((indicator) => {
            const latest = getLatest(indicator.data);
            const change = getChange(indicator.data);
            const isExpanded = expandedIndicator === indicator.info.key;
            const signal = Number.isFinite(latest) ? indicator.info.regimeSignal(latest) : { regime: 'Unavailable', badge: 'neutral' as const, explanation: 'No observations available.' };
            const higherIsBetter = HIGHER_IS_BETTER[indicator.info.key] ?? false;
            // A rising value (change > 0.1) is green when higherIsBetter,
            // otherwise red. Falling value flips. |change| <= 0.1 stays neutral.
            const changeColor =
              change > 0.1
                ? higherIsBetter
                  ? 'text-accent-green'
                  : 'text-accent-red'
                : change < -0.1
                  ? higherIsBetter
                    ? 'text-accent-red'
                    : 'text-accent-green'
                  : 'text-black/85';

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
                      className={`text-sm font-semibold tabular-nums ${changeColor}`}
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
                        <span className="text-xs text-black/40">Current reading: {latest.toFixed(2)}{indicator.suffix}</span>
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
