// FRED API client — Federal Reserve Economic Data
// Docs: https://fred.stlouisfed.org/docs/api/fred/

import { percentChange } from './time-series';
import { config } from './config';
import { fetchJson } from './fetcher';
import { withCache, TTL } from './cache';

// Pre-wired series IDs for the macro dashboard
export const FRED_SERIES = {
  // Interest rates
  FED_FUNDS: 'FEDFUNDS',
  FED_FUNDS_EFFECTIVE: 'DFF',
  T3M: 'DGS3MO',
  T2Y: 'DGS2',
  T5Y: 'DGS5',
  T10Y: 'DGS10',
  T30Y: 'DGS30',
  T10Y2Y: 'T10Y2Y',
  T10Y3M: 'T10Y3M',

  // Inflation
  CPI: 'CPIAUCSL',
  CORE_CPI: 'CPILFESL',
  PCE: 'PCEPI',
  CORE_PCE: 'PCEPILFE',
  BREAKEVEN_5Y: 'T5YIE',
  BREAKEVEN_10Y: 'T10YIE',

  // Labor
  UNEMPLOYMENT: 'UNRATE',
  NONFARM_PAYROLLS: 'PAYEMS',
  INITIAL_CLAIMS: 'ICSA',

  // Growth & activity
  GDP: 'GDP',
  REAL_GDP: 'GDPC1',
  INDUSTRIAL_PRODUCTION: 'INDPRO',
  RETAIL_SALES: 'RSAFS',

  // Credit & financial
  HIGH_YIELD_SPREAD: 'BAMLH0A0HYM2',
  IG_SPREAD: 'BAMLC0A0CM',
  FINANCIAL_CONDITIONS: 'NFCI',

  // Volatility
  VIX: 'VIXCLS',

  // Money supply
  M2: 'M2SL',

  // Housing
  CASE_SHILLER: 'CSUSHPISA',

  // Leading indicators
  LEI: 'USALOLITONOSTSAM',
  CONSUMER_SENTIMENT: 'UMCSENT',
  BUILDING_PERMITS: 'PERMIT',
  ISM_MANUFACTURING: 'MANEMP',

  // Recession indicator
  SAHM_RULE: 'SAHMREALTIME',
} as const;

export type FredSeriesId = (typeof FRED_SERIES)[keyof typeof FRED_SERIES];

// Friendly names for display
export const FRED_SERIES_NAMES: Record<string, string> = {
  FEDFUNDS: 'Fed Funds Rate',
  DFF: 'Effective Fed Funds',
  DGS3MO: '3-Month Treasury',
  DGS2: '2-Year Treasury',
  DGS5: '5-Year Treasury',
  DGS10: '10-Year Treasury',
  DGS30: '30-Year Treasury',
  T10Y2Y: '10Y-2Y Spread',
  T10Y3M: '10Y-3M Spread',
  CPIAUCSL: 'CPI (All Urban)',
  CPILFESL: 'Core CPI',
  PCEPI: 'PCE Price Index',
  PCEPILFE: 'Core PCE',
  T5YIE: '5Y Breakeven Inflation',
  T10YIE: '10Y Breakeven Inflation',
  UNRATE: 'Unemployment Rate',
  PAYEMS: 'Nonfarm Payrolls',
  ICSA: 'Initial Jobless Claims',
  GDP: 'Nominal GDP',
  GDPC1: 'Real GDP',
  INDPRO: 'Industrial Production',
  RSAFS: 'Retail Sales',
  BAMLH0A0HYM2: 'High Yield Spread',
  BAMLC0A0CM: 'IG Credit Spread',
  NFCI: 'Financial Conditions',
  VIXCLS: 'CBOE Volatility Index (VIX)',
  M2SL: 'M2 Money Supply',
  CSUSHPISA: 'Case-Shiller Home Price',
  USALOLITONOSTSAM: 'OECD Leading Indicator (US)',
  UMCSENT: 'Consumer Sentiment (UMich)',
  PERMIT: 'Building Permits',
  MANEMP: 'Manufacturing Payroll Employment',
  SAHMREALTIME: 'Sahm Rule Indicator',
};

export interface FredObservation {
  date: string;
  value: number | null;
}

export interface FredSeriesInfo {
  id: string;
  title: string;
  frequency: string;
  units: string;
  seasonal_adjustment: string;
}

interface FredApiResponse {
  observations: Array<{
    date: string;
    value: string;
  }>;
}

interface FredSeriesInfoResponse {
  seriess: Array<{
    id: string;
    title: string;
    frequency: string;
    units: string;
    seasonal_adjustment: string;
  }>;
}

export async function getFredSeries(
  seriesId: string,
  start?: string,
  end?: string,
  frequency?: string,
  asOf?: string
): Promise<FredObservation[]> {
  const cacheKey = `fred:${seriesId}:${start}:${end}:${frequency}:${asOf}`;

  return withCache(cacheKey, TTL.MACRO, async () => {
    const params = new URLSearchParams({
      series_id: seriesId,
      api_key: config.fred.apiKey,
      file_type: 'json',
      sort_order: 'asc',
    });

    if (!config.fred.apiKey) throw new Error('FRED_API_KEY is not configured');
    if (asOf) { params.set('realtime_start', asOf); params.set('realtime_end', asOf); }
    if (start) params.set('observation_start', start);
    if (end) params.set('observation_end', end);
    if (frequency) params.set('frequency', frequency);

    const data = await fetchJson<FredApiResponse>(
      `${config.fred.baseUrl}/series/observations?${params}`,
      { provider: 'FRED' }
    );

    return data.observations
      .map((obs) => ({
        date: obs.date,
        value: obs.value === '.' ? null : parseFloat(obs.value),
      }))
      .filter((obs) => obs.value !== null);
  });
}

export async function getFredSeriesInfo(
  seriesId: string
): Promise<FredSeriesInfo> {
  const cacheKey = `fred:info:${seriesId}`;

  return withCache(cacheKey, TTL.MACRO * 24, async () => {
    const params = new URLSearchParams({
      series_id: seriesId,
      api_key: config.fred.apiKey,
      file_type: 'json',
    });

    const data = await fetchJson<FredSeriesInfoResponse>(
      `${config.fred.baseUrl}/series?${params}`,
      { provider: 'FRED' }
    );

    const s = data.seriess[0];
    return {
      id: s.id,
      title: s.title,
      frequency: s.frequency,
      units: s.units,
      seasonal_adjustment: s.seasonal_adjustment,
    };
  });
}

// Compute YoY % change for a series (e.g. CPI -> inflation rate)
export function computeYoYChange(
  observations: FredObservation[]
): FredObservation[] {
  return percentChange(observations, 12).map(p => ({ ...p, value: Math.round(p.value * 100) / 100 }));
}

// ─── Release Schedule ───
// Maps each dashboard indicator to its FRED release_id and typical schedule
export const FRED_RELEASE_IDS: Record<string, { releaseId: number; name: string; frequency: string; source: string }> = {
  FEDFUNDS:      { releaseId: 118, name: 'Fed Funds Rate',      frequency: '~6 weeks (FOMC)', source: 'Federal Reserve' },
  UNRATE:        { releaseId: 50,  name: 'Unemployment Rate',   frequency: 'Monthly',          source: 'BLS' },
  CPIAUCSL:      { releaseId: 10,  name: 'CPI',                 frequency: 'Monthly',          source: 'BLS' },
  INDPRO:        { releaseId: 13,  name: 'Industrial Production', frequency: 'Monthly',        source: 'Federal Reserve' },
  BAMLH0A0HYM2: { releaseId: 283, name: 'HY Credit Spread',    frequency: 'Daily',            source: 'ICE/BofA' },
  DGS10:         { releaseId: 18,  name: '10Y Treasury',        frequency: 'Daily',            source: 'Treasury' },
  DGS2:          { releaseId: 18,  name: '2Y Treasury',         frequency: 'Daily',            source: 'Treasury' },
  T10Y2Y:        { releaseId: 18,  name: '10Y-2Y Spread',       frequency: 'Daily',            source: 'Treasury' },
  USALOLITONOSTSAM: { releaseId: 352, name: 'OECD Leading Indicator', frequency: 'Monthly',       source: 'OECD' },
  UMCSENT:       { releaseId: 492, name: 'Consumer Sentiment',   frequency: 'Monthly',          source: 'UMich' },
  PERMIT:        { releaseId: 29,  name: 'Building Permits',     frequency: 'Monthly',          source: 'Census Bureau' },
  MANEMP:        { releaseId: 50,  name: 'Manufacturing Payrolls', frequency: 'Monthly',          source: 'BLS' },
  ICSA:          { releaseId: 176, name: 'Initial Claims',       frequency: 'Weekly',           source: 'DOL' },
  M2SL:          { releaseId: 21,  name: 'M2 Money Supply',      frequency: 'Monthly',          source: 'Federal Reserve' },
};

export interface ReleaseDate {
  seriesId: string;
  name: string;
  releaseDate: string;
  frequency: string;
  source: string;
}

export async function getUpcomingReleaseDates(): Promise<ReleaseDate[]> {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  // Look 60 days ahead
  const futureDate = new Date(today);
  futureDate.setDate(futureDate.getDate() + 60);
  const futureStr = futureDate.toISOString().split('T')[0];

  // Deduplicate release IDs (many series share the same release)
  const uniqueReleases = new Map<number, { releaseId: number; seriesIds: string[]; name: string; frequency: string; source: string }>();
  for (const [seriesId, info] of Object.entries(FRED_RELEASE_IDS)) {
    // Skip daily series — they update every trading day, no calendar entry needed
    if (info.frequency === 'Daily') continue;
    const existing = uniqueReleases.get(info.releaseId);
    if (existing) {
      existing.seriesIds.push(seriesId);
    } else {
      uniqueReleases.set(info.releaseId, { releaseId: info.releaseId, seriesIds: [seriesId], name: info.name, frequency: info.frequency, source: info.source });
    }
  }

  const results: ReleaseDate[] = [];

  await Promise.all(
    Array.from(uniqueReleases.values()).map(async (rel) => {
      const cacheKey = `fred:release-dates:${rel.releaseId}`;
      try {
        const dates = await withCache(cacheKey, TTL.MACRO * 6, async () => {
          const params = new URLSearchParams({
            release_id: String(rel.releaseId),
            api_key: config.fred.apiKey,
            file_type: 'json',
            include_release_dates_with_no_data: 'true',
            sort_order: 'asc',
          });
          // FRED release/dates returns all dates for that release
          // We'll filter client-side for the window we care about
          const data = await fetchJson<{ release_dates: Array<{ release_id: number; date: string }> }>(
            `${config.fred.baseUrl}/release/dates?${params}`,
            { provider: 'FRED' }
          );
          return data.release_dates.map((d) => d.date);
        });

        // Find the next upcoming date (>= today)
        const upcomingDates = dates.filter((d: string) => d >= todayStr && d <= futureStr);
        // Also find the most recent past date for "last released"
        const pastDates = dates.filter((d: string) => d < todayStr);
        const lastDate = pastDates.length > 0 ? pastDates[pastDates.length - 1] : null;

        // Add next upcoming date
        if (upcomingDates.length > 0) {
          results.push({
            seriesId: rel.seriesIds[0],
            name: rel.name,
            releaseDate: upcomingDates[0],
            frequency: rel.frequency,
            source: rel.source,
          });
        } else if (lastDate) {
          // If no upcoming date found, include the last release date
          results.push({
            seriesId: rel.seriesIds[0],
            name: rel.name,
            releaseDate: lastDate,
            frequency: rel.frequency,
            source: rel.source,
          });
        }
      } catch (err) {
        console.warn(`Failed to fetch release dates for release ${rel.releaseId}:`, err);
      }
    })
  );

  // Sort by date ascending
  results.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
  return results;
}

// Macro regime classification
export type MacroRegime =
  | 'goldilocks'    // low inflation + strong growth
  | 'reflation'     // rising inflation + strong growth
  | 'stagflation'   // high inflation + weak growth
  | 'deflation'     // low inflation + weak growth
  | 'unknown';

export interface RegimeResult {
  regime: MacroRegime;
  label: string;
  description: string;
  inflationTrend: 'rising' | 'falling' | 'stable';
  growthTrend: 'accelerating' | 'decelerating' | 'stable';
  latestInflation: number;
  latestUnemployment: number;
}

export function classifyMacroRegime(
  cpiYoY: FredObservation[],
  unemploymentRate: FredObservation[]
): RegimeResult {
  if (cpiYoY.length < 6 || unemploymentRate.length < 6) {
    return {
      regime: 'unknown',
      label: 'Insufficient Data',
      description: 'Not enough data to classify regime.',
      inflationTrend: 'stable',
      growthTrend: 'stable',
      latestInflation: 0,
      latestUnemployment: 0,
    };
  }

  const latestCPI = cpiYoY[cpiYoY.length - 1].value!;
  const prevCPI = cpiYoY[cpiYoY.length - 4].value!; // ~3 months ago
  const latestUnemp = unemploymentRate[unemploymentRate.length - 1].value!;
  const prevUnemp = unemploymentRate[unemploymentRate.length - 4].value!;

  const inflationTrend: 'rising' | 'falling' | 'stable' =
    latestCPI - prevCPI > 0.3
      ? 'rising'
      : latestCPI - prevCPI < -0.3
        ? 'falling'
        : 'stable';

  const growthTrend: 'accelerating' | 'decelerating' | 'stable' =
    latestUnemp - prevUnemp > 0.2
      ? 'decelerating'
      : latestUnemp - prevUnemp < -0.2
        ? 'accelerating'
        : 'stable';

  const highInflation = latestCPI > 3.0;
  const risingUnemployment = latestUnemp > prevUnemp + 0.1;

  let regime: MacroRegime;
  let label: string;
  let description: string;

  if (highInflation && risingUnemployment) {
    regime = 'stagflation';
    label = 'Stagflation';
    description = `Inflation is elevated (${latestCPI.toFixed(1)}% vs the Fed's ~2% goal) while the job market deteriorates — the one season where stocks and bonds can fall together, because the Fed can't cut rates to help growth without feeding inflation. Gold, commodities, and cash have historically held up best.`;
  } else if (highInflation && !risingUnemployment) {
    regime = 'reflation';
    label = 'High inflation / stable labor';
    description = `Inflation is running hot (${latestCPI.toFixed(1)}%) but the job market is holding firm — an economy running warmer than the Fed wants. Prices of real things (commodities, gold) and value stocks tend to lead; bonds and expensive growth stocks face rate pressure.`;
  } else if (!highInflation && !risingUnemployment) {
    regime = 'goldilocks';
    label = 'Goldilocks';
    description = `Inflation is contained (${latestCPI.toFixed(1)}%) and the job market is solid (${latestUnemp.toFixed(1)}% unemployment) — "not too hot, not too cold." Historically the friendliest season for stocks: profits grow while the Fed has no reason to tighten.`;
  } else {
    regime = 'deflation';
    label = 'Contained inflation / softening labor';
    description = `Inflation is below the 3% screening threshold while unemployment has increased. This two-series screen does not establish the direction of inflation or overall growth. This season favors safety: cash earning yield, high-quality bonds, and defensive stocks, since the Fed's usual response (rate cuts) rewards exactly those assets.`;
  }

  return {
    regime,
    label,
    description,
    inflationTrend,
    growthTrend,
    latestInflation: latestCPI,
    latestUnemployment: latestUnemp,
  };
}
