import { NextRequest, NextResponse } from 'next/server';
import {
  getFredSeries,
  getFredSeriesInfo,
  computeYoYChange,
  classifyMacroRegime,
  getUpcomingReleaseDates,
  FRED_SERIES,
} from '@/lib/fred';

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

      case 'regime': {
        const [cpiRaw, unrate] = await Promise.all([
          getFredSeries(FRED_SERIES.CPI),
          getFredSeries(FRED_SERIES.UNEMPLOYMENT),
        ]);
        const cpiYoY = computeYoYChange(cpiRaw);
        const regime = classifyMacroRegime(cpiYoY, unrate);
        return NextResponse.json(regime);
      }

      case 'dashboard': {
        // Fetch all key macro indicators in parallel
        const seriesMap = {
          fedFunds: FRED_SERIES.FED_FUNDS,
          t2y: FRED_SERIES.T2Y,
          t10y: FRED_SERIES.T10Y,
          t10y2y: FRED_SERIES.T10Y2Y,
          cpi: FRED_SERIES.CPI,
          unemployment: FRED_SERIES.UNEMPLOYMENT,
          highYieldSpread: FRED_SERIES.HIGH_YIELD_SPREAD,
          industrialProduction: FRED_SERIES.INDUSTRIAL_PRODUCTION,
          vix: FRED_SERIES.VIX,
        };

        const entries = Object.entries(seriesMap);
        const results = await Promise.all(
          entries.map(async ([key, id]) => {
            const data = await getFredSeries(id);
            return [key, data] as const;
          })
        );

        const dashboard: Record<string, unknown> = {};
        for (const [key, data] of results) {
          dashboard[key] = data;
        }

        // Add CPI YoY
        const cpiData = results.find(([k]) => k === 'cpi')?.[1] || [];
        dashboard.cpiYoY = computeYoYChange(cpiData);

        // Add regime
        const unrateData = results.find(([k]) => k === 'unemployment')?.[1] || [];
        dashboard.regime = classifyMacroRegime(
          dashboard.cpiYoY as Awaited<ReturnType<typeof computeYoYChange>>,
          unrateData
        );

        return NextResponse.json(dashboard);
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
