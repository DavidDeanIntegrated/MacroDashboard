import { getEconomicDashboard } from '@/lib/economy-data';
import { NextRequest, NextResponse } from 'next/server';
import {
  getFredSeries,
  getFredSeriesInfo,
  getUpcomingReleaseDates,
  FRED_SERIES,
} from '@/lib/fred';
import { invalidatePrefix } from '@/lib/cache';

// The dashboard action fans out to ~45 FRED series on a cold cache.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    switch (action) {
      case 'series': {
        const seriesId = searchParams.get('id');
        if (!seriesId) {
          return NextResponse.json({ error: 'Missing series id' }, { status: 400 });
        }
        const start = searchParams.get('start') || undefined;
        const end = searchParams.get('end') || undefined;
        const frequency = searchParams.get('frequency') || undefined;
        const data = await getFredSeries(seriesId, start, end, frequency);
        return NextResponse.json(data);
      }

      case 'info': {
        const seriesId = searchParams.get('id');
        if (!seriesId) {
          return NextResponse.json({ error: 'Missing series id' }, { status: 400 });
        }
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
      case 'dashboard': {
        if (searchParams.get('bust') === '1') invalidatePrefix('fred:');
        const dashboard = await getEconomicDashboard();
        return NextResponse.json(action === 'regime' ? dashboard.regime : dashboard);
      }

      case 'release-calendar': {
        const releases = await getUpcomingReleaseDates();
        return NextResponse.json(releases);
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: series, info, yield-curve, regime, dashboard, release-calendar' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('FRED API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'FRED API error' },
      { status: 500 }
    );
  }
}
