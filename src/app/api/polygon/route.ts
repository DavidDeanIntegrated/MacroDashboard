import { NextRequest, NextResponse } from 'next/server';
import {
  getAggregates,
  getSnapshot,
  getSMA,
  getEMA,
  getRSI,
  getMACD,
  getDividends,
  getTickerDetails,
} from '@/lib/polygon';
import type { PolygonTimeframe } from '@/lib/polygon';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    switch (action) {
      case 'aggregates': {
        const symbol = searchParams.get('symbol');
        if (!symbol) {
          return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
        }
        const timeframe = (searchParams.get('timeframe') || '1day') as PolygonTimeframe;
        const from = searchParams.get('from') || undefined;
        const to = searchParams.get('to') || undefined;
        const limit = parseInt(searchParams.get('limit') || '500');
        const data = await getAggregates(symbol, timeframe, from, to, limit);
        return NextResponse.json(data);
      }

      case 'snapshot': {
        const symbol = searchParams.get('symbol');
        if (!symbol) {
          return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
        }
        const data = await getSnapshot(symbol);
        return NextResponse.json(data);
      }

      case 'sma': {
        const symbol = searchParams.get('symbol');
        if (!symbol) {
          return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
        }
        const window = parseInt(searchParams.get('window') || '50');
        const timespan = (searchParams.get('timespan') || 'day') as 'day' | 'hour' | 'minute';
        const data = await getSMA(symbol, window, timespan);
        return NextResponse.json(data);
      }

      case 'ema': {
        const symbol = searchParams.get('symbol');
        if (!symbol) {
          return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
        }
        const window = parseInt(searchParams.get('window') || '20');
        const timespan = (searchParams.get('timespan') || 'day') as 'day' | 'hour' | 'minute';
        const data = await getEMA(symbol, window, timespan);
        return NextResponse.json(data);
      }

      case 'rsi': {
        const symbol = searchParams.get('symbol');
        if (!symbol) {
          return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
        }
        const window = parseInt(searchParams.get('window') || '14');
        const timespan = (searchParams.get('timespan') || 'day') as 'day' | 'hour' | 'minute';
        const data = await getRSI(symbol, window, timespan);
        return NextResponse.json(data);
      }

      case 'macd': {
        const symbol = searchParams.get('symbol');
        if (!symbol) {
          return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
        }
        const timespan = (searchParams.get('timespan') || 'day') as 'day' | 'hour' | 'minute';
        const data = await getMACD(symbol, 12, 26, 9, timespan);
        return NextResponse.json(data);
      }

      case 'dividends': {
        const symbol = searchParams.get('symbol');
        if (!symbol) {
          return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
        }
        const limit = parseInt(searchParams.get('limit') || '12');
        const data = await getDividends(symbol, limit);
        return NextResponse.json(data);
      }

      case 'details': {
        const symbol = searchParams.get('symbol');
        if (!symbol) {
          return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
        }
        const data = await getTickerDetails(symbol);
        return NextResponse.json(data);
      }

      case 'portfolio-dividends': {
        // Fetch dividends for multiple symbols at once
        const symbols = searchParams.get('symbols')?.split(',') || [];
        if (symbols.length === 0) {
          return NextResponse.json({ error: 'Missing symbols' }, { status: 400 });
        }
        const results = await Promise.all(
          symbols.map(async (sym) => {
            try {
              const divs = await getDividends(sym, 4);
              return divs;
            } catch {
              return [];
            }
          })
        );
        return NextResponse.json(results.flat().sort((a, b) =>
          new Date(b.exDate).getTime() - new Date(a.exDate).getTime()
        ));
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: aggregates, snapshot, sma, ema, rsi, macd, dividends, details, portfolio-dividends' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Polygon API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Polygon API error' },
      { status: 500 }
    );
  }
}
