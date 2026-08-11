import { NextRequest, NextResponse } from 'next/server';
import {
  getAccount,
  getPositions,
  getHistoricalBars,
  getSnapshot,
} from '@/lib/alpaca';
import { getHoldingsPortfolio, getPortfolioChart, getWatchlistData } from '@/lib/holdings';
import type { PortfolioChartPeriod } from '@/lib/holdings';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    switch (action) {
      case 'account': {
        const account = await getAccount();
        return NextResponse.json(account);
      }

      case 'positions': {
        const positions = await getPositions();
        return NextResponse.json(positions);
      }

      case 'portfolio': {
        const summary = await getHoldingsPortfolio();
        return NextResponse.json(summary);
      }

      case 'bars': {
        const symbol = searchParams.get('symbol');
        if (!symbol) {
          return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
        }
        const timeframe = (searchParams.get('timeframe') || '1Day') as '1Day' | '1Hour' | '15Min';
        const start = searchParams.get('start') || undefined;
        const end = searchParams.get('end') || undefined;
        const limit = parseInt(searchParams.get('limit') || '252');
        const bars = await getHistoricalBars(symbol, timeframe, start, end, limit);
        return NextResponse.json(bars);
      }

      case 'portfolio-chart': {
        const period = (searchParams.get('period') || '1Y') as PortfolioChartPeriod;
        const chart = await getPortfolioChart(period);
        return NextResponse.json(chart);
      }

      case 'watchlist': {
        const watchlist = await getWatchlistData();
        return NextResponse.json(watchlist);
      }

      case 'snapshot': {
        const symbol = searchParams.get('symbol');
        if (!symbol) {
          return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
        }
        const snapshot = await getSnapshot(symbol);
        return NextResponse.json(snapshot);
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: account, positions, portfolio, portfolio-chart, bars, snapshot' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Alpaca API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Alpaca API error' },
      { status: 500 }
    );
  }
}
