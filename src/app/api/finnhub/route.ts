import { NextRequest, NextResponse } from 'next/server';
import {
  getQuote,
  getCompanyProfile,
  getCompanyNews,
  getMarketNews,
  getCandles,
  getEarnings,
  getInsiderTransactions,
  getBasicFinancials,
} from '@/lib/finnhub';
import { getNews as getAlpacaNews } from '@/lib/alpaca';
import { computeFundamentalsScore, computeAllScores } from '@/lib/fundamentals-score';

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
        // Try Finnhub first, fall back to Alpaca news
        try {
          if (symbol) {
            const days = parseInt(searchParams.get('days') || '7');
            const finnhubNews = await getCompanyNews(symbol, days);
            if (finnhubNews && finnhubNews.length > 0) {
              return NextResponse.json(finnhubNews);
            }
          } else {
            const category = (searchParams.get('category') || 'general') as 'general' | 'forex' | 'crypto';
            const finnhubNews = await getMarketNews(category);
            if (finnhubNews && finnhubNews.length > 0) {
              return NextResponse.json(finnhubNews);
            }
          }
        } catch {
          // Finnhub failed, fall through to Alpaca
        }
        // Alpaca news fallback
        const alpacaNews = await getAlpacaNews(symbol ? [symbol] : undefined, 20);
        const normalized = alpacaNews.map((item) => ({
          headline: item.headline,
          summary: item.summary,
          source: item.source,
          url: item.url,
          datetime: Math.floor(new Date(item.created_at).getTime() / 1000),
          image: item.images?.[0]?.url || '',
        }));
        return NextResponse.json(normalized);
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

      case 'metrics': {
        const symbol = searchParams.get('symbol');
        if (!symbol) return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
        const metrics = await getBasicFinancials(symbol);
        return NextResponse.json(metrics);
      }

      case 'fundamentals-score': {
        const symbol = searchParams.get('symbol');
        if (symbol) {
          const score = await computeFundamentalsScore(symbol);
          return NextResponse.json(score);
        }
        // Batch: pass comma-separated symbols
        const symbols = searchParams.get('symbols')?.split(',') || [];
        if (symbols.length === 0) {
          return NextResponse.json({ error: 'Missing symbol or symbols' }, { status: 400 });
        }
        const scores = await computeAllScores(symbols);
        return NextResponse.json(scores);
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: quote, profile, news, candles, earnings, insider, metrics, fundamentals-score' },
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
