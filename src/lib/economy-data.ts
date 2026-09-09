import { config } from './config';
import { getFredSeries, FRED_SERIES, computeYoYChange } from './fred';
import { assessEconomy, ECONOMIC_INDICATORS } from './economy';
import type { Observation } from './time-series';
import { withCache, TTL } from './cache';
import { getYahooSeries } from './yahoo';

export async function getEconomicDashboard(asOf?: string) {
  return withCache(`fred:dashboard:${asOf ?? 'latest'}`, TTL.MACRO, async () => {
    const series: Record<string, string> = {
      fedFunds: FRED_SERIES.FED_FUNDS, t2y: FRED_SERIES.T2Y, t10y: FRED_SERIES.T10Y,
      t10y2y: FRED_SERIES.T10Y2Y, vix: FRED_SERIES.VIX, lei: FRED_SERIES.LEI,
      consumerSentiment: FRED_SERIES.CONSUMER_SENTIMENT, ismManufacturing: 'MANEMP', m2: FRED_SERIES.M2,
      ...Object.fromEntries(ECONOMIC_INDICATORS.map(s => [s.key, s.id])),
    };
    const data: Record<string, Observation[]> = {};
    const errors: Record<string, string> = {};
    // Bounded concurrency stays well under FRED's 120 req/min. Each failure is independent.
    // Live requests take the full history (the 10Y-2Y explainer scans inversions back to 1976);
    // vintage (asOf) requests are bounded to keep historical validation cheap.
    // A FRED id used under several keys (e.g. T10Y2Y for the chart and for the outlook) is fetched once.
    const start = asOf ? '1990-01-01' : undefined;
    const entries = Object.entries(series);
    const ids = Array.from(new Set(entries.map(([, id]) => id)));
    const fetched: Record<string, Observation[] | null> = {};
    for (let i = 0; i < ids.length; i += 12) {
      await Promise.all(ids.slice(i, i + 12).map(async id => {
        try { fetched[id] = await getFredSeries(id, start, asOf, undefined, asOf); }
        catch { fetched[id] = null; }
      }));
    }
    for (const [key, id] of entries) {
      data[key] = fetched[id] ?? [];
      if (fetched[id] === null) errors[key] = `${id}: unavailable from FRED`;
    }
    // Every series failing means FRED itself is unreachable or unconfigured; surface that
    // as a request error (pages show a retry state) rather than an all-empty dashboard.
    if (Object.keys(errors).length === entries.length) throw new Error('FRED data unavailable: every series request failed. Check FRED_API_KEY and connectivity.');
    const assessment = assessEconomy(data, asOf);
    const moveIndex = asOf || !config.fred.apiKey ? [] : await getYahooSeries('^MOVE', '5y', '1d').catch(() => []);
    return { ...data, cpiYoY: computeYoYChange(data.cpi ?? []), corePceYoY: computeYoYChange(data.corePce ?? []),
      moveIndex, assessment, regime: assessment, errors, fetchedAt: new Date().toISOString(), vintage: asOf ?? null };
  });
}
