// SEC EDGAR API client — Fundamentals & Filings
// Docs: https://www.sec.gov/edgar/sec-api-documentation

import { config } from './config';
import { fetchJson } from './fetcher';
import { withCache, TTL } from './cache';

const edgarHeaders = () => ({
  'User-Agent': config.edgar.userAgent,
  Accept: 'application/json',
});

// ─── Ticker to CIK mapping ───

interface CompanyTickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

let tickerMap: Record<string, number> | null = null;

export async function getTickerToCIK(): Promise<Record<string, number>> {
  if (tickerMap) return tickerMap;

  return withCache('edgar:tickers', TTL.FUNDAMENTALS * 24, async () => {
    const data = await fetchJson<Record<string, CompanyTickerEntry>>(
      'https://www.sec.gov/files/company_tickers.json',
      { headers: edgarHeaders(), provider: 'EDGAR' }
    );

    const map: Record<string, number> = {};
    for (const entry of Object.values(data)) {
      map[entry.ticker.toUpperCase()] = entry.cik_str;
    }
    tickerMap = map;
    return map;
  });
}

export async function tickerToCIK(ticker: string): Promise<number | null> {
  const map = await getTickerToCIK();
  return map[ticker.toUpperCase()] || null;
}

// ─── Company Facts ───

interface CompanyFactsResponse {
  cik: number;
  entityName: string;
  facts: {
    'us-gaap'?: Record<string, FactEntry>;
    dei?: Record<string, FactEntry>;
  };
}

interface FactEntry {
  label: string;
  description: string;
  units: Record<
    string,
    Array<{
      val: number;
      accn: string;
      fy: number;
      fp: string;
      form: string;
      filed: string;
      start?: string;
      end: string;
    }>
  >;
}

export interface FundamentalDataPoint {
  period: string; // e.g., "2023-Q4"
  endDate: string;
  value: number;
  form: string;
  filed: string;
}

export interface CompanyFundamentals {
  entityName: string;
  cik: number;
  revenue: FundamentalDataPoint[];
  netIncome: FundamentalDataPoint[];
  totalAssets: FundamentalDataPoint[];
  totalLiabilities: FundamentalDataPoint[];
  stockholdersEquity: FundamentalDataPoint[];
  eps: FundamentalDataPoint[];
  operatingIncome: FundamentalDataPoint[];
  grossProfit: FundamentalDataPoint[];
  cash: FundamentalDataPoint[];
  longTermDebt: FundamentalDataPoint[];
}

// Core GAAP tags to pull
const GAAP_TAGS = {
  revenue: [
    'Revenues',
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'SalesRevenueNet',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
  ],
  netIncome: ['NetIncomeLoss'],
  totalAssets: ['Assets'],
  totalLiabilities: ['Liabilities'],
  stockholdersEquity: [
    'StockholdersEquity',
    'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
  ],
  eps: ['EarningsPerShareDiluted', 'EarningsPerShareBasic'],
  operatingIncome: ['OperatingIncomeLoss'],
  grossProfit: ['GrossProfit'],
  cash: ['CashAndCashEquivalentsAtCarryingValue'],
  longTermDebt: ['LongTermDebt', 'LongTermDebtNoncurrent'],
} as const;

function extractFactData(
  facts: CompanyFactsResponse['facts'],
  tags: readonly string[]
): FundamentalDataPoint[] {
  const gaap = facts['us-gaap'];
  if (!gaap) return [];

  for (const tag of tags) {
    const entry = gaap[tag];
    if (!entry) continue;

    // Prefer USD units
    const units = entry.units['USD'] || Object.values(entry.units)[0];
    if (!units || units.length === 0) continue;

    // Filter to 10-K and 10-Q only, deduplicate by period
    const seen = new Set<string>();
    const results: FundamentalDataPoint[] = [];

    for (const u of units) {
      if (u.form !== '10-K' && u.form !== '10-Q') continue;
      const period = `${u.fy}-${u.fp}`;
      if (seen.has(period)) continue;
      seen.add(period);

      results.push({
        period,
        endDate: u.end,
        value: u.val,
        form: u.form,
        filed: u.filed,
      });
    }

    if (results.length > 0) {
      return results.sort(
        (a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime()
      );
    }
  }

  return [];
}

export async function getCompanyFundamentals(
  ticker: string
): Promise<CompanyFundamentals | null> {
  const cik = await tickerToCIK(ticker);
  if (!cik) return null;

  const cacheKey = `edgar:facts:${cik}`;

  return withCache(cacheKey, TTL.FUNDAMENTALS, async () => {
    const data = await fetchJson<CompanyFactsResponse>(
      `${config.edgar.baseUrl}/api/xbrl/companyfacts/CIK${String(cik).padStart(10, '0')}.json`,
      { headers: edgarHeaders(), provider: 'EDGAR' }
    );

    return {
      entityName: data.entityName,
      cik: data.cik,
      revenue: extractFactData(data.facts, GAAP_TAGS.revenue),
      netIncome: extractFactData(data.facts, GAAP_TAGS.netIncome),
      totalAssets: extractFactData(data.facts, GAAP_TAGS.totalAssets),
      totalLiabilities: extractFactData(data.facts, GAAP_TAGS.totalLiabilities),
      stockholdersEquity: extractFactData(data.facts, GAAP_TAGS.stockholdersEquity),
      eps: extractFactData(data.facts, GAAP_TAGS.eps),
      operatingIncome: extractFactData(data.facts, GAAP_TAGS.operatingIncome),
      grossProfit: extractFactData(data.facts, GAAP_TAGS.grossProfit),
      cash: extractFactData(data.facts, GAAP_TAGS.cash),
      longTermDebt: extractFactData(data.facts, GAAP_TAGS.longTermDebt),
    };
  });
}

// ─── Filings ───

export interface Filing {
  accessionNumber: string;
  form: string;
  filingDate: string;
  reportDate: string;
  primaryDocument: string;
  primaryDocDescription: string;
  fileUrl: string;
}

interface SubmissionsResponse {
  cik: string;
  entityType: string;
  name: string;
  filings: {
    recent: {
      accessionNumber: string[];
      form: string[];
      filingDate: string[];
      reportDate: string[];
      primaryDocument: string[];
      primaryDocDescription: string[];
    };
  };
}

export async function getRecentFilings(
  ticker: string,
  formTypes?: string[],
  count = 20
): Promise<Filing[]> {
  const cik = await tickerToCIK(ticker);
  if (!cik) return [];

  const cacheKey = `edgar:filings:${cik}:${formTypes?.join(',')}:${count}`;

  return withCache(cacheKey, TTL.FILINGS, async () => {
    const data = await fetchJson<SubmissionsResponse>(
      `${config.edgar.baseUrl}/submissions/CIK${String(cik).padStart(10, '0')}.json`,
      { headers: edgarHeaders(), provider: 'EDGAR' }
    );

    const recent = data.filings.recent;
    const filings: Filing[] = [];

    for (let i = 0; i < recent.accessionNumber.length && filings.length < count; i++) {
      if (formTypes && !formTypes.includes(recent.form[i])) continue;

      const accession = recent.accessionNumber[i].replace(/-/g, '');
      filings.push({
        accessionNumber: recent.accessionNumber[i],
        form: recent.form[i],
        filingDate: recent.filingDate[i],
        reportDate: recent.reportDate[i],
        primaryDocument: recent.primaryDocument[i],
        primaryDocDescription: recent.primaryDocDescription[i],
        fileUrl: `https://www.sec.gov/Archives/edgar/data/${cik}/${accession}/${recent.primaryDocument[i]}`,
      });
    }

    return filings;
  });
}

// ─── Computed Metrics ───

export interface ComputedMetrics {
  ttmRevenue: number | null;
  ttmNetIncome: number | null;
  ttmEPS: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  debtToEquity: number | null;
  currentAssets: number | null;
}

export function computeMetrics(fundamentals: CompanyFundamentals): ComputedMetrics {
  const getLatestAnnual = (data: FundamentalDataPoint[]) => {
    const annuals = data.filter((d) => d.form === '10-K');
    return annuals.length > 0 ? annuals[annuals.length - 1].value : null;
  };

  // Get last 4 quarters for TTM
  const getTTM = (data: FundamentalDataPoint[]) => {
    const quarterly = data.filter((d) => d.form === '10-Q' || d.form === '10-K');
    if (quarterly.length < 4) return getLatestAnnual(data);
    const last4 = quarterly.slice(-4);
    return last4.reduce((sum, d) => sum + d.value, 0);
  };

  const ttmRevenue = getTTM(fundamentals.revenue);
  const ttmNetIncome = getTTM(fundamentals.netIncome);
  const ttmGrossProfit = getTTM(fundamentals.grossProfit);
  const ttmOperating = getTTM(fundamentals.operatingIncome);
  const ttmEPS = getTTM(fundamentals.eps);

  const latestDebt = getLatestAnnual(fundamentals.longTermDebt);
  const latestEquity = getLatestAnnual(fundamentals.stockholdersEquity);

  return {
    ttmRevenue,
    ttmNetIncome,
    ttmEPS,
    grossMargin:
      ttmRevenue && ttmGrossProfit ? (ttmGrossProfit / ttmRevenue) * 100 : null,
    operatingMargin:
      ttmRevenue && ttmOperating ? (ttmOperating / ttmRevenue) * 100 : null,
    netMargin:
      ttmRevenue && ttmNetIncome ? (ttmNetIncome / ttmRevenue) * 100 : null,
    debtToEquity:
      latestDebt !== null && latestEquity ? latestDebt / latestEquity : null,
    currentAssets: getLatestAnnual(fundamentals.totalAssets),
  };
}
