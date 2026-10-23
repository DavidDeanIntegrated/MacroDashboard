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
import { failedRequest, invalidRequest, logUpstreamError } from '@/lib/api-errors';
import {
  CANDLE_RESOLUTIONS,
  NEWS_CATEGORIES,
  NEWS_DAYS,
  parseAllowlist,
  parseBoundedInt,
  parseTicker,
  parseTickerList,
  parseUnixSeconds,
} from '@/lib/polygon-bounds';

function missingSymbol() {
  return NextResponse.json({ error: 'Missing symbol' }, { status: 400 });
}

function readSymbol(raw: string | null): string | NextResponse {
  const parsed = parseTicker(raw);
  if (!parsed.ok) return parsed.reason === 'missing' ? missingSymbol() : invalidRequest();
  return parsed.value;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    switch (action) {
      case 'quote': {
        const symbol = readSymbol(searchParams.get('symbol'));
        if (symbol instanceof NextResponse) return symbol;
        const quote = await getQuote(symbol);
        return NextResponse.json(quote);
      }

      case 'profile': {
        const symbol = readSymbol(searchParams.get('symbol'));
        if (symbol instanceof NextResponse) return symbol;
        const profile = await getCompanyProfile(symbol);
        return NextResponse.json(profile);
      }

      case 'news': {
        const rawSymbol = searchParams.get('symbol');
        let symbol: string | undefined;
        if (rawSymbol != null && rawSymbol.trim() !== '') {
          const parsed = parseTicker(rawSymbol);
          if (!parsed.ok) return invalidRequest();
          symbol = parsed.value;
        }
        if (symbol) {
          const days = parseBoundedInt(searchParams.get('days'), NEWS_DAYS.fallback, NEWS_DAYS.min, NEWS_DAYS.max);
          if (days == null) return invalidRequest();
          try {
            const finnhubNews = await getCompanyNews(symbol, days);
            if (finnhubNews && finnhubNews.length > 0) return NextResponse.json(finnhubNews);
          } catch {
            // Finnhub failed, fall through to Alpaca
          }
        } else {
          const category = parseAllowlist(searchParams.get('category'), NEWS_CATEGORIES, 'general');
          if (!category) return invalidRequest();
          try {
            const finnhubNews = await getMarketNews(category);
            if (finnhubNews && finnhubNews.length > 0) return NextResponse.json(finnhubNews);
          } catch {
            // Finnhub failed, fall through to Alpaca
          }
        }
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
        const symbol = readSymbol(searchParams.get('symbol'));
        if (symbol instanceof NextResponse) return symbol;
        const resolution = parseAllowlist(searchParams.get('resolution'), CANDLE_RESOLUTIONS, 'D');
        const from = parseUnixSeconds(searchParams.get('from'));
        const to = parseUnixSeconds(searchParams.get('to'));
        if (!resolution || from === null || to === null || (from != null && to != null && from > to)) return invalidRequest();
        const candles = await getCandles(symbol, resolution, from, to);
        return NextResponse.json(candles);
      }

      case 'earnings': {
        const symbol = readSymbol(searchParams.get('symbol'));
        if (symbol instanceof NextResponse) return symbol;
        const earnings = await getEarnings(symbol);
        return NextResponse.json(earnings);
      }

      case 'insider': {
        const symbol = readSymbol(searchParams.get('symbol'));
        if (symbol instanceof NextResponse) return symbol;
        const transactions = await getInsiderTransactions(symbol);
        return NextResponse.json(transactions);
      }

      case 'metrics': {
        const symbol = readSymbol(searchParams.get('symbol'));
        if (symbol instanceof NextResponse) return symbol;
        const metrics = await getBasicFinancials(symbol);
        return NextResponse.json(metrics);
      }

      case 'fundamentals-score': {
        const rawSymbol = searchParams.get('symbol');
        if (rawSymbol != null && rawSymbol.trim() !== '') {
          const parsed = parseTicker(rawSymbol);
          if (!parsed.ok) return invalidRequest();
          const score = await computeFundamentalsScore(parsed.value);
          return NextResponse.json(score);
        }
        const parsed = parseTickerList(searchParams.get('symbols'));
        if (!parsed.ok) {
          return parsed.reason === 'missing'
            ? NextResponse.json({ error: 'Missing symbol or symbols' }, { status: 400 })
            : invalidRequest();
        }
        const scores = await computeAllScores(parsed.value);
        return NextResponse.json(scores);
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: quote, profile, news, candles, earnings, insider, metrics, fundamentals-score' },
          { status: 400 }
        );
    }
  } catch (error) {
    logUpstreamError('Finnhub API error', error);
    return failedRequest();
  }
}
