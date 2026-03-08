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
    'ifrs-full'?: Record<string, FactEntry>;
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
  currentAssets: FundamentalDataPoint[];
  currentLiabilities: FundamentalDataPoint[];
}

// Core GAAP tags to pull (us-gaap names)
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
  currentAssets: ['AssetsCurrent'],
  currentLiabilities: ['LiabilitiesCurrent'],
} as const;

// IFRS-equivalent tags for foreign private issuers (20-F filers like TSM)
const IFRS_TAGS = {
  revenue: ['Revenue', 'RevenueFromContractsWithCustomers'],
  netIncome: ['ProfitLossAttributableToOwnersOfParent', 'ProfitLoss'],
  totalAssets: ['Assets'],
  totalLiabilities: ['Liabilities'],
  stockholdersEquity: ['EquityAttributableToOwnersOfParent', 'Equity'],
  eps: ['DilutedEarningsLossPerShare', 'BasicEarningsLossPerShare'],
  operatingIncome: ['ProfitLossFromOperatingActivities', 'OperatingProfit'],
  grossProfit: ['GrossProfit'],
  cash: ['CashAndCashEquivalents'],
  longTermDebt: ['NoncurrentPortionOfNoncurrentBorrowings', 'NoncurrentBorrowings', 'LongtermBorrowings'],
  currentAssets: ['CurrentAssets'],
  currentLiabilities: ['CurrentLiabilities'],
} as const;

// Accepted SEC form types (includes foreign private issuer forms)
const ACCEPTED_FORMS = new Set(['10-K', '10-Q', '20-F', '6-K']);

function extractFactDataFromNamespace(
  namespace: Record<string, FactEntry> | undefined,
  tags: readonly string[]
): FundamentalDataPoint[] {
  if (!namespace) return [];

  for (const tag of tags) {
    const entry = namespace[tag];
    if (!entry) continue;

    // Prefer USD units
    const units = entry.units['USD'] || Object.values(entry.units)[0];
    if (!units || units.length === 0) continue;

    // Filter to accepted SEC form types, deduplicate by period
    const seen = new Set<string>();
    const results: FundamentalDataPoint[] = [];

    for (const u of units) {
      if (!ACCEPTED_FORMS.has(u.form)) continue;
      const period = `${u.fy}-${u.fp}`;
      if (seen.has(period)) continue;
      seen.add(period);

      // Normalize foreign forms to domestic equivalents for downstream logic
      const normalizedForm = u.form === '20-F' ? '10-K' : u.form === '6-K' ? '10-Q' : u.form;

      results.push({
        period,
        endDate: u.end,
        value: u.val,
        form: normalizedForm,
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

function extractFactData(
  facts: CompanyFactsResponse['facts'],
  gaapTags: readonly string[],
  ifrsTags?: readonly string[]
): FundamentalDataPoint[] {
  // Try us-gaap first (domestic filers)
  const gaapResult = extractFactDataFromNamespace(facts['us-gaap'], gaapTags);
  if (gaapResult.length > 0) return gaapResult;

  // Fall back to IFRS (foreign private issuers like TSM)
  if (ifrsTags) {
    return extractFactDataFromNamespace(facts['ifrs-full'], ifrsTags);
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
      revenue: extractFactData(data.facts, GAAP_TAGS.revenue, IFRS_TAGS.revenue),
      netIncome: extractFactData(data.facts, GAAP_TAGS.netIncome, IFRS_TAGS.netIncome),
      totalAssets: extractFactData(data.facts, GAAP_TAGS.totalAssets, IFRS_TAGS.totalAssets),
      totalLiabilities: extractFactData(data.facts, GAAP_TAGS.totalLiabilities, IFRS_TAGS.totalLiabilities),
      stockholdersEquity: extractFactData(data.facts, GAAP_TAGS.stockholdersEquity, IFRS_TAGS.stockholdersEquity),
      eps: extractFactData(data.facts, GAAP_TAGS.eps, IFRS_TAGS.eps),
      operatingIncome: extractFactData(data.facts, GAAP_TAGS.operatingIncome, IFRS_TAGS.operatingIncome),
      grossProfit: extractFactData(data.facts, GAAP_TAGS.grossProfit, IFRS_TAGS.grossProfit),
      cash: extractFactData(data.facts, GAAP_TAGS.cash, IFRS_TAGS.cash),
      longTermDebt: extractFactData(data.facts, GAAP_TAGS.longTermDebt, IFRS_TAGS.longTermDebt),
      currentAssets: extractFactData(data.facts, GAAP_TAGS.currentAssets, IFRS_TAGS.currentAssets),
      currentLiabilities: extractFactData(data.facts, GAAP_TAGS.currentLiabilities, IFRS_TAGS.currentLiabilities),
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

// ─── Scoring-compatible metrics for fundamentals-score.ts ───

export interface EdgarScoringMetrics {
  netMargin: number | null;
  grossMargin: number | null;
  roe: number | null;
  revenueGrowth: number | null;
  epsGrowth: number | null;
  eps: number | null;       // TTM EPS for P/E calc
  revenue: number | null;   // TTM revenue for P/S calc
  equity: number | null;    // for P/B calc
  debtToEquity: number | null;
  currentRatio: number | null;
  cashToDebt: number | null;
}

/**
 * Extract scoring metrics from EDGAR XBRL data.
 * Used as a third-tier fallback when Polygon and Finnhub lack data.
 */
export function extractScoringMetrics(f: CompanyFundamentals): EdgarScoringMetrics {
  const getLatest = (data: FundamentalDataPoint[]) =>
    data.length > 0 ? data[data.length - 1].value : null;

  const getLatestAnnual = (data: FundamentalDataPoint[]) => {
    const annuals = data.filter((d) => d.form === '10-K');
    return annuals.length > 0 ? annuals[annuals.length - 1].value : null;
  };

  const getPrevAnnual = (data: FundamentalDataPoint[]) => {
    const annuals = data.filter((d) => d.form === '10-K');
    return annuals.length >= 2 ? annuals[annuals.length - 2].value : null;
  };

  // TTM from last 4 quarterly/annual filings
  const getTTM = (data: FundamentalDataPoint[]) => {
    const quarterly = data.filter((d) => d.form === '10-Q' || d.form === '10-K');
    if (quarterly.length < 4) return getLatestAnnual(data);
    const last4 = quarterly.slice(-4);
    return last4.reduce((sum, d) => sum + d.value, 0);
  };

  const ttmRevenue = getTTM(f.revenue);
  const ttmNetIncome = getTTM(f.netIncome);
  const ttmGrossProfit = getTTM(f.grossProfit);
  const ttmEPS = getTTM(f.eps);

  const latestEquity = getLatest(f.stockholdersEquity);
  const latestDebt = getLatest(f.longTermDebt);
  const latestCash = getLatest(f.cash);
  const latestCurrentAssets = getLatest(f.currentAssets);
  const latestCurrentLiabilities = getLatest(f.currentLiabilities);

  // Growth: compare latest annual to prior annual
  const latestAnnualRev = getLatestAnnual(f.revenue);
  const prevAnnualRev = getPrevAnnual(f.revenue);
  const latestAnnualEPS = getLatestAnnual(f.eps);
  const prevAnnualEPS = getPrevAnnual(f.eps);

  let revenueGrowth: number | null = null;
  if (latestAnnualRev !== null && prevAnnualRev !== null && prevAnnualRev !== 0) {
    revenueGrowth = ((latestAnnualRev - prevAnnualRev) / Math.abs(prevAnnualRev)) * 100;
  }

  let epsGrowth: number | null = null;
  if (latestAnnualEPS !== null && prevAnnualEPS !== null && prevAnnualEPS !== 0) {
    epsGrowth = ((latestAnnualEPS - prevAnnualEPS) / Math.abs(prevAnnualEPS)) * 100;
  }

  return {
    netMargin: ttmRevenue && ttmNetIncome ? (ttmNetIncome / ttmRevenue) * 100 : null,
    grossMargin: ttmRevenue && ttmGrossProfit ? (ttmGrossProfit / ttmRevenue) * 100 : null,
    roe: ttmNetIncome !== null && latestEquity && latestEquity > 0
      ? (ttmNetIncome / latestEquity) * 100 : null,
    revenueGrowth,
    epsGrowth,
    eps: ttmEPS,
    revenue: ttmRevenue,
    equity: latestEquity,
    debtToEquity: latestDebt !== null && latestEquity && latestEquity > 0
      ? latestDebt / latestEquity : null,
    currentRatio: latestCurrentAssets !== null && latestCurrentLiabilities && latestCurrentLiabilities > 0
      ? latestCurrentAssets / latestCurrentLiabilities : null,
    cashToDebt: latestCash !== null && latestDebt !== null && latestDebt > 0
      ? latestCash / latestDebt
      : latestCash !== null && (latestDebt === null || latestDebt === 0)
        ? 10 // no debt = excellent
        : null,
  };
}

// ─── Computed Metrics (legacy, used by /api/edgar endpoint) ───

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
