import { NextRequest, NextResponse } from 'next/server';
import {
  getAccount,
  getPositions,
  getOrders,
  getPortfolioSummary,
  getHistoricalBars,
  getSnapshot,
  submitOrder,
  cancelOrder,
} from '@/lib/alpaca';

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

      case 'orders': {
        const status = (searchParams.get('status') as 'open' | 'closed' | 'all') || 'all';
        const limit = parseInt(searchParams.get('limit') || '50');
        const orders = await getOrders(status, limit);
        return NextResponse.json(orders);
      }

      case 'portfolio': {
        const summary = await getPortfolioSummary();
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
          { error: 'Invalid action. Use: account, positions, orders, portfolio, bars, snapshot' },
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

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    switch (action) {
      case 'order': {
        const body = await request.json();
        const order = await submitOrder(body);
        return NextResponse.json(order);
      }

      case 'cancel': {
        const body = await request.json();
        await cancelOrder(body.orderId);
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: order, cancel' },
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
