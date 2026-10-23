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
  getWeeklySMA200,
} from '@/lib/polygon';
import { fetchBtcWma200 } from '@/lib/holdings';
import {
  AGGREGATE_LIMIT,
  DIVIDEND_LIMIT,
  INDICATOR_WINDOW,
  parseBoundedInt,
  parseIsoDate,
  parseTicker,
  parseTickerList,
  parseTimeframe,
  parseTimespan,
} from '@/lib/polygon-bounds';
import { failedRequest, invalidRequest, logUpstreamError } from '@/lib/api-errors';

function missingField(field: 'symbol' | 'symbols') {
  return NextResponse.json(
    { error: field === 'symbol' ? 'Missing symbol' : 'Missing symbols' },
    { status: 400 }
  );
}

function readSymbol(raw: string | null): string | NextResponse {
  const parsed = parseTicker(raw);
  if (!parsed.ok) return parsed.reason === 'missing' ? missingField('symbol') : invalidRequest();
  return parsed.value;
}

function readSymbols(raw: string | null): string[] | NextResponse {
  const parsed = parseTickerList(raw);
  if (!parsed.ok) return parsed.reason === 'missing' ? missingField('symbols') : invalidRequest();
  return parsed.value;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');

  try {
    switch (action) {
      case 'aggregates': {
        const symbol = readSymbol(searchParams.get('symbol'));
        if (symbol instanceof NextResponse) return symbol;
        const timeframe = parseTimeframe(searchParams.get('timeframe'));
        const from = parseIsoDate(searchParams.get('from'));
        const to = parseIsoDate(searchParams.get('to'));
        const limit = parseBoundedInt(
          searchParams.get('limit'),
          AGGREGATE_LIMIT.fallback,
          AGGREGATE_LIMIT.min,
          AGGREGATE_LIMIT.max,
        );
        if (!timeframe || from === null || to === null || limit == null) return invalidRequest();
        const data = await getAggregates(symbol, timeframe, from, to, limit);
        return NextResponse.json(data);
      }

      case 'snapshot': {
        const symbol = readSymbol(searchParams.get('symbol'));
        if (symbol instanceof NextResponse) return symbol;
        const data = await getSnapshot(symbol);
        return NextResponse.json(data);
      }

      case 'sma': {
        const symbol = readSymbol(searchParams.get('symbol'));
        if (symbol instanceof NextResponse) return symbol;
        const window = parseBoundedInt(
          searchParams.get('window'),
          50,
          INDICATOR_WINDOW.min,
          INDICATOR_WINDOW.max,
        );
        const timespan = parseTimespan(searchParams.get('timespan'));
        if (window == null || !timespan) return invalidRequest();
        const data = await getSMA(symbol, window, timespan);
        return NextResponse.json(data);
      }

      case 'wma200': {
        // Batch: latest 200-week SMA per symbol. BTC is computed from Coinbase
        // weekly closes (Polygon's weekly indicator doesn't cover X:BTCUSD here).
        const symbols = readSymbols(searchParams.get('symbols'));
        if (symbols instanceof NextResponse) return symbols;
        const results = await Promise.all(
          symbols.map(async (symbol) => ({
            symbol,
            wma200: symbol === 'BTC' ? await fetchBtcWma200() : await getWeeklySMA200(symbol),
          }))
        );
        return NextResponse.json(results);
      }

      case 'ema': {
        const symbol = readSymbol(searchParams.get('symbol'));
        if (symbol instanceof NextResponse) return symbol;
        const window = parseBoundedInt(
          searchParams.get('window'),
          20,
          INDICATOR_WINDOW.min,
          INDICATOR_WINDOW.max,
        );
        const timespan = parseTimespan(searchParams.get('timespan'));
        if (window == null || !timespan) return invalidRequest();
        const data = await getEMA(symbol, window, timespan);
        return NextResponse.json(data);
      }

      case 'rsi': {
        const symbol = readSymbol(searchParams.get('symbol'));
        if (symbol instanceof NextResponse) return symbol;
        const window = parseBoundedInt(
          searchParams.get('window'),
          14,
          INDICATOR_WINDOW.min,
          INDICATOR_WINDOW.max,
        );
        const timespan = parseTimespan(searchParams.get('timespan'));
        if (window == null || !timespan) return invalidRequest();
        const data = await getRSI(symbol, window, timespan);
        return NextResponse.json(data);
      }

      case 'macd': {
        const symbol = readSymbol(searchParams.get('symbol'));
        if (symbol instanceof NextResponse) return symbol;
        const timespan = parseTimespan(searchParams.get('timespan'));
        if (!timespan) return invalidRequest();
        const data = await getMACD(symbol, 12, 26, 9, timespan);
        return NextResponse.json(data);
      }

      case 'dividends': {
        const symbol = readSymbol(searchParams.get('symbol'));
        if (symbol instanceof NextResponse) return symbol;
        const limit = parseBoundedInt(
          searchParams.get('limit'),
          DIVIDEND_LIMIT.fallback,
          DIVIDEND_LIMIT.min,
          DIVIDEND_LIMIT.max,
        );
        if (limit == null) return invalidRequest();
        const data = await getDividends(symbol, limit);
        return NextResponse.json(data);
      }

      case 'details': {
        const symbol = readSymbol(searchParams.get('symbol'));
        if (symbol instanceof NextResponse) return symbol;
        const data = await getTickerDetails(symbol);
        return NextResponse.json(data);
      }

      case 'multi-aggregates': {
        // Fetch aggregates for multiple symbols at once — used for overlays, sector heatmaps, etc.
        const symbols = readSymbols(searchParams.get('symbols'));
        if (symbols instanceof NextResponse) return symbols;
        const timeframe = parseTimeframe(searchParams.get('timeframe'));
        const from = parseIsoDate(searchParams.get('from'));
        const to = parseIsoDate(searchParams.get('to'));
        const limit = parseBoundedInt(
          searchParams.get('limit'),
          AGGREGATE_LIMIT.fallback,
          AGGREGATE_LIMIT.min,
          AGGREGATE_LIMIT.max,
        );
        if (!timeframe || from === null || to === null || limit == null) return invalidRequest();
        const results = await Promise.all(
          symbols.map(async (symbol) => {
            try {
              const data = await getAggregates(symbol, timeframe, from, to, limit);
              return { symbol, data };
            } catch {
              return { symbol, data: [] };
            }
          })
        );
        return NextResponse.json(results);
      }

      case 'portfolio-dividends': {
        // Fetch dividends for multiple symbols at once
        const symbols = readSymbols(searchParams.get('symbols'));
        if (symbols instanceof NextResponse) return symbols;
        const results = await Promise.all(
          symbols.map(async (symbol) => {
            try {
              return await getDividends(symbol, 4);
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
          { error: 'Invalid action. Use: aggregates, snapshot, sma, wma200, ema, rsi, macd, dividends, details, multi-aggregates, portfolio-dividends' },
          { status: 400 }
        );
    }
  } catch (error) {
    logUpstreamError('Polygon API error', error);
    return failedRequest();
  }
}
