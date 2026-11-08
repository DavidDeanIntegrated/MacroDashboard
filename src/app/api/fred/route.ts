import { getEconomicDashboard } from '@/lib/economy-data';
import { NextRequest, NextResponse } from 'next/server';
import {
  getFredSeries,
  getFredSeriesInfo,
  getUpcomingReleaseDates,
  knownFredSeriesIds,
  FRED_SERIES,
} from '@/lib/fred';
import { invalidatePrefix } from '@/lib/cache';
import { failedRequest, invalidRequest, logUpstreamError } from '@/lib/api-errors';
import { FRED_FREQUENCIES, parseAllowlist, parseFredSeriesId, parseIsoDate } from '@/lib/market-bounds';

// The dashboard action fans out to ~45 FRED series on a cold cache.
export const maxDuration = 60;

// Series keys are spread into the dashboard object, so TypeScript can't see them by name.
function lastObservation(dashboard: object, key: string) {
  const series = (dashboard as Record<string, unknown>)[key];
  return Array.isArray(series) && series.length > 0 ? series[series.length - 1] : null;
}

function readSeriesId(raw: string | null): string | NextResponse {
  const parsed = parseFredSeriesId(raw, knownFredSeriesIds());
  if (!parsed.ok) {
    return parsed.reason === 'missing'
      ? NextResponse.json({ error: 'Missing series id' }, { status: 400 })
      : invalidRequest();
  }
  return parsed.value;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    switch (action) {
      case 'series': {
        const seriesId = readSeriesId(searchParams.get('id'));
        if (seriesId instanceof NextResponse) return seriesId;
        const start = parseIsoDate(searchParams.get('start'));
        const end = parseIsoDate(searchParams.get('end'));
        const frequency = parseAllowlist(searchParams.get('frequency'), FRED_FREQUENCIES, 'd');
        const frequencyRaw = searchParams.get('frequency');
        if (start === null || end === null || (start && end && start > end)) return invalidRequest();
        if (frequencyRaw != null && frequencyRaw !== '' && !frequency) return invalidRequest();
        const data = await getFredSeries(seriesId, start, end, frequencyRaw ? frequency ?? undefined : undefined);
        return NextResponse.json(data);
      }

      case 'info': {
        const seriesId = readSeriesId(searchParams.get('id'));
        if (seriesId instanceof NextResponse) return seriesId;
        const info = await getFredSeriesInfo(seriesId);
        return NextResponse.json(info);
      }

      case 'yield-curve': {
        const seriesIds = [
          FRED_SERIES.T3M,
          FRED_SERIES.T2Y,
          FRED_SERIES.T5Y,
          FRED_SERIES.T10Y,
          FRED_SERIES.T30Y,
        ];

        const results = await Promise.all(
          seriesIds.map(async (id) => {
            const data = await getFredSeries(id, undefined, undefined, undefined);
            const latest = data[data.length - 1];
            return { id, value: latest?.value ?? null, date: latest?.date ?? null };
          })
        );

        return NextResponse.json(results);
      }

      case 'regime':
      case 'regime-context':
      case 'dashboard': {
        const bust = searchParams.get('bust') === '1';
        if (bust) invalidatePrefix('fred:');
        const dashboard = await getEconomicDashboard();
        // regime-context is the small payload (~25 KB vs ~4.5 MB) for pages that only need the
        // regime call and its history, so they load on their own without the Macro page's series.
        const body = action === 'regime' ? dashboard.regime
          : action === 'regime-context' ? {
            assessment: dashboard.assessment, regimeHistory: dashboard.regimeHistory, fetchedAt: dashboard.fetchedAt,
            latest: { t10y2y: lastObservation(dashboard, 't10y2y'), vix: lastObservation(dashboard, 'vix') },
          }
          : dashboard;
        // The in-memory cache is per serverless instance, so a cold instance re-fetches ~45 FRED
        // series. Letting the CDN hold complete responses makes every page fast regardless of
        // which one was opened first. Partial or bust responses are never edge-cached.
        const cacheable = !bust && Object.keys(dashboard.errors).length === 0;
        return NextResponse.json(body, {
          headers: { 'Cache-Control': cacheable ? 'public, s-maxage=600, stale-while-revalidate=3600' : 'no-store' },
        });
      }

      case 'release-calendar': {
        const releases = await getUpcomingReleaseDates();
        return NextResponse.json(releases);
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: series, info, yield-curve, regime, regime-context, dashboard, release-calendar' },
          { status: 400 }
        );
    }
  } catch (error) {
    logUpstreamError('FRED API error', error);
    return failedRequest();
  }
}
