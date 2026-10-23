import { NextRequest, NextResponse } from 'next/server';
import {
  getCompanyFundamentals,
  getRecentFilings,
  computeMetrics,
} from '@/lib/edgar';
import { failedRequest, invalidRequest, logUpstreamError } from '@/lib/api-errors';
import { FILING_COUNT, parseBoundedInt, parseFormList, parseTicker } from '@/lib/polygon-bounds';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const parsedTicker = parseTicker(searchParams.get('ticker'));
  if (!parsedTicker.ok) {
    return parsedTicker.reason === 'missing'
      ? NextResponse.json({ error: 'Missing ticker parameter' }, { status: 400 })
      : invalidRequest();
  }
  const ticker = parsedTicker.value;

  try {
    switch (action) {
      case 'fundamentals': {
        const fundamentals = await getCompanyFundamentals(ticker);
        if (!fundamentals) {
          return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        const metrics = computeMetrics(fundamentals);
        return NextResponse.json({ fundamentals, metrics });
      }

      case 'filings': {
        const formTypes = parseFormList(searchParams.get('forms'));
        const count = parseBoundedInt(searchParams.get('count'), FILING_COUNT.fallback, FILING_COUNT.min, FILING_COUNT.max);
        if (!formTypes || count == null) return invalidRequest();
        const filings = await getRecentFilings(ticker, formTypes, count);
        return NextResponse.json(filings);
      }

      default:
        return NextResponse.json(
          { error: 'Invalid action. Use: fundamentals, filings' },
          { status: 400 }
        );
    }
  } catch (error) {
    logUpstreamError('EDGAR API error', error);
    return failedRequest();
  }
}
