import { NextRequest, NextResponse } from 'next/server';
import {
  getCompanyFundamentals,
  getRecentFilings,
  computeMetrics,
} from '@/lib/edgar';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action');
  const ticker = searchParams.get('ticker');

  if (!ticker) {
    return NextResponse.json({ error: 'Missing ticker parameter' }, { status: 400 });
  }

  try {
    switch (action) {
      case 'fundamentals': {
        const fundamentals = await getCompanyFundamentals(ticker);
        if (!fundamentals) {
          return NextResponse.json({ error: `Ticker ${ticker} not found` }, { status: 404 });
        }
        const metrics = computeMetrics(fundamentals);
        return NextResponse.json({ fundamentals, metrics });
      }

      case 'filings': {
        const formTypes = searchParams.get('forms')?.split(',') || ['10-K', '10-Q', '8-K'];
        const count = parseInt(searchParams.get('count') || '20');
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
    console.error('EDGAR API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'EDGAR API error' },
      { status: 500 }
    );
  }
}
