import { NextRequest, NextResponse } from 'next/server';
import { getHistoricalBars, getSnapshot } from '@/lib/alpaca';
import { isPublicAlpacaAction, PUBLIC_ALPACA_ACTIONS } from '@/lib/alpaca-actions';
import { getHoldingsPortfolio, getPortfolioChart, getWatchlistData } from '@/lib/holdings';
import { failedRequest, invalidRequest, logUpstreamError } from '@/lib/api-errors';
import {
  ALPACA_PERIODS,
  ALPACA_TIMEFRAMES,
  BARS_LIMIT,
  parseAllowlist,
  parseBoundedInt,
  parseIsoDate,
  parseTicker,
} from '@/lib/polygon-bounds';

function readSymbol(raw: string | null): string | NextResponse {
  const parsed = parseTicker(raw);
  if (!parsed.ok) {
    return parsed.reason === 'missing'
      ? NextResponse.json({ error: 'Missing symbol' }, { status: 400 })
      : invalidRequest();
  }
  return parsed.value;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  if (!isPublicAlpacaAction(action)) {
    return NextResponse.json(
      { error: `Invalid action. Use: ${PUBLIC_ALPACA_ACTIONS.join(', ')}` },
      { status: 400 }
    );
  }

  try {
    switch (action) {
      case 'portfolio': {
        const summary = await getHoldingsPortfolio();
        return NextResponse.json(summary);
      }

      case 'bars': {
        const symbol = readSymbol(searchParams.get('symbol'));
        if (symbol instanceof NextResponse) return symbol;
        const timeframe = parseAllowlist(searchParams.get('timeframe'), ALPACA_TIMEFRAMES, '1Day');
        const start = parseIsoDate(searchParams.get('start'));
        const end = parseIsoDate(searchParams.get('end'));
        const limit = parseBoundedInt(searchParams.get('limit'), BARS_LIMIT.fallback, BARS_LIMIT.min, BARS_LIMIT.max);
        if (!timeframe || start === null || end === null || limit == null || (start && end && start > end)) return invalidRequest();
        const bars = await getHistoricalBars(symbol, timeframe, start, end, limit);
        return NextResponse.json(bars);
      }

      case 'portfolio-chart': {
        const period = parseAllowlist(searchParams.get('period'), ALPACA_PERIODS, '1Y');
        if (!period) return invalidRequest();
        const chart = await getPortfolioChart(period);
        return NextResponse.json(chart);
      }

      case 'watchlist': {
        const watchlist = await getWatchlistData();
        return NextResponse.json(watchlist);
      }

      case 'snapshot': {
        const symbol = readSymbol(searchParams.get('symbol'));
        if (symbol instanceof NextResponse) return symbol;
        const snapshot = await getSnapshot(symbol);
        return NextResponse.json(snapshot);
      }

      default:
        return NextResponse.json(
          { error: `Invalid action. Use: ${PUBLIC_ALPACA_ACTIONS.join(', ')}` },
          { status: 400 }
        );
    }
  } catch (error) {
    logUpstreamError('Alpaca API error', error);
    return failedRequest();
  }
}
