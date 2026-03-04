import { NextRequest, NextResponse } from 'next/server';
import {
  getQuote,
  getCompanyProfile,
  getCompanyNews,
  getMarketNews,
  getCandles,
  getEarnings,
  getInsiderTransactions,
} from '@/lib/finnhub';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    switch (action) {
      case 'quote': {
        const symbol = searchParams.get('symbol');
        if (!symbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
        const quote = await getQuote(symbol);
        return NextResponse.json(quote);
      }

      case 'profile': {
        const symbol = searchParams.get('symbol');
        if (!symbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
        const profile = await getCompanyProfile(symbol);
        return NextResponse.json(profile);
      }

      case 'news': {
        const symbol = searchParams.get('symbol');
        if (symbol) {
          const days = parseInt(searchParams.get('days') || '7');
          const news = await getCompanyNews(symbol, days);
          return NextResponse.json(news);
        }
        const category = (searchParams.get('category') || 'general') as 'general' | 'forex' | 'crypto';
        const news = await getMarketNews(category);
        return NextResponse.json(news);
      }

      case 'candles': {
        const symbol = searchParams.get('symbol');
        if (!symbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
        const resolution = (searchParams.get('resolution') || 'D') as 'D' | '60' | '15';
        const from = searchParams.get('from') ? parseInt(searchParams.get('from')!) : undefined;
        const to = searchParams.get('to') ? parseInt(searchParams.get('to')!) : undefined;
        const candles = await getCandles(symbol, resolution, from, to);
        return NextResponse.json(candles);
      }

      case 'earnings': {
        const symbol = searchParams.get('symbol');
        if (!symbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
        const earnings = await getEarnings(symbol);
        return NextResponse.json(earnings);
      }

      case 'insider': {
        const symbol = searchParams.get('symbol');
        if (!symbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
        const transactions = await getInsiderTransactions(symbol);
        return NextResponse.json(transactions);
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: quote, profile, news, candles, earnings, insider' },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('Finnhub API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Finnhub API error' },
      { status: 500 }
    );
  }
}
