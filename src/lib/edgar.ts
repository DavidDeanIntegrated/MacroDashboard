// SEC EDGAR API client — Fundamentals & Filings
// Docs: https://www.sec.gov/edgar/sec-api-documentation

import { config } from './config';
import { encodeUpstreamRelative, fetchJson } from './fetcher';
import { withCache, TTL } from './cache';

function cikSegment(cik: number): string {
  const padded = String(Math.trunc(cik)).padStart(10, '0');
  if (!/^\d{10}$/.test(padded)) throw new Error('Invalid CIK');
  return encodeURIComponent(padded);
}

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
      { headers: edgarHeaders(), provider: 'EDGAR', timeoutMs: 20000, retries: 1 }
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
  period: string; // fiscal label: "2026-Q1" … "2026-Q4", or "2026-FY"
  startDate?: string; // income-statement figures only (balance-sheet values are point-in-time)
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
  /** Latest reported common shares outstanding (all classes), or null. */
  sharesOutstanding: number | null;
  /** Form that reported it — 20-F/40-F means foreign ordinary shares, not US listings. */
  sharesForm: string | null;
}

// Cover-page share count (dei) first, balance-sheet count second. Multi-class
// issuers report one cover-page entry per class in the same filing; sum those.
function latestSharesOutstanding(facts: CompanyFactsResponse['facts']): { shares: number; form: string } | null {
  const candidates = [
    facts.dei?.EntityCommonStockSharesOutstanding,
    facts['us-gaap']?.CommonStockSharesOutstanding,
  ];
  for (const entry of candidates) {
    const rows = entry?.units?.shares ?? [];
    if (rows.length === 0) continue;
    const latest = rows.reduce((a, b) => (b.end > a.end || (b.end === a.end && b.filed > a.filed) ? b : a));
    const sameFiling = rows.filter((r) => r.end === latest.end && r.accn === latest.accn);
    const shares = sameFiling.reduce((sum, r) => sum + r.val, 0);
    if (shares > 0) return { shares, form: latest.form };
  }
  return null;
}

// Core GAAP tags to pull (us-gaap names)
const GAAP_TAGS = {
  revenue: [
    'Revenues',
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'SalesRevenueNet',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
  ],
  // Some filers (e.g. AVAV) report net income only under the fallbacks.
  netIncome: ['NetIncomeLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic', 'ProfitLoss'],
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

const DAY_MS = 86400000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
const addDays = (date: string, days: number) => new Date(Date.parse(date) + days * DAY_MS).toISOString().slice(0, 10);

interface FactRow { start?: string; end: string; val: number; form: string; filed: string; rank: number }

/**
 * One series per concept, keyed by the dates each figure covers — never by the
 * row's fy/fp, which describe the FILING: a single 10-Q repeats last year's
 * comparatives and year-to-date totals under its own fy/fp. Candidate tags are
 * merged (companies switch tags over time; the earlier tag wins when both cover
 * the same dates) and the latest filing of a period wins, so restatements apply.
 * Income-statement figures keep only true quarters (80–100 days) and fiscal
 * years (350–380 days); Q4 is derived as the year minus its three quarters.
 */
function extractFactDataFromNamespace(
  namespace: Record<string, FactEntry> | undefined,
  tags: readonly string[]
): FundamentalDataPoint[] {
  if (!namespace) return [];

  const byDates = new Map<string, FactRow>();
  tags.forEach((tag, rank) => {
    const entry = namespace[tag];
    if (!entry) return;
    // Prefer USD units
    const units = entry.units['USD'] || Object.values(entry.units)[0];
    for (const u of units ?? []) {
      if (!ACCEPTED_FORMS.has(u.form)) continue;
      const key = u.start ? `${u.start}..${u.end}` : u.end;
      const cur = byDates.get(key);
      if (!cur || rank < cur.rank || (rank === cur.rank && u.filed > cur.filed)) {
        byDates.set(key, { start: u.start, end: u.end, val: u.val, form: u.form, filed: u.filed, rank });
      }
    }
  });
  const rows = Array.from(byDates.values());
  if (rows.length === 0) return [];

  const flows = rows.filter((r) => r.start);
  const isFlow = flows.length > 0;
  const span = (r: FactRow) => daysBetween(r.start!, r.end);
  const annuals = flows.filter((r) => span(r) >= 350 && span(r) <= 380).sort((a, b) => a.end.localeCompare(b.end));
  const quarters = flows.filter((r) => span(r) >= 80 && span(r) <= 100);

  // Q4 is rarely reported on its own: fiscal year minus the three quarters inside it.
  for (const year of annuals) {
    const inside = quarters.filter((q) => q.start! >= year.start! && q.end <= year.end);
    if (inside.length !== 3 || inside.some((q) => Math.abs(daysBetween(q.end, year.end)) <= 7)) continue;
    const lastEnd = inside.map((q) => q.end).sort().at(-1)!;
    quarters.push({
      start: addDays(lastEnd, 1),
      end: year.end,
      val: year.val - inside.reduce((sum, q) => sum + q.val, 0),
      form: year.form,
      filed: year.filed,
      rank: year.rank,
    });
  }

  // Fiscal labels from the company's own year ends; a year still in progress is
  // projected forward from the latest one (calendar years when none are filed).
  const yearEnds = annuals.map((r) => r.end);
  const fiscalYearEnd = (date: string): string => {
    const known = yearEnds.find((e) => e >= addDays(date, -7) && daysBetween(date, e) < 366);
    if (known) return known;
    let e = yearEnds.at(-1) ?? `${date.slice(0, 4)}-12-31`;
    while (daysBetween(date, e) < -7) e = `${Number(e.slice(0, 4)) + 1}${e.slice(4)}`;
    return e;
  };
  const label = (end: string, annual: boolean) => {
    const fyEnd = fiscalYearEnd(end);
    if (annual) return `${fyEnd.slice(0, 4)}-FY`;
    const q = Math.min(4, Math.max(1, 4 - Math.round(daysBetween(end, fyEnd) / 91.3)));
    return `${fyEnd.slice(0, 4)}-Q${q}`;
  };
  const annualForm = (form: string) => (form === '10-K' || form === '20-F' ? '10-K' : '10-Q');

  const points: FundamentalDataPoint[] = isFlow
    ? [
        ...quarters.map((r) => ({ period: label(r.end, false), startDate: r.start, endDate: r.end, value: r.val, form: '10-Q', filed: r.filed })),
        ...annuals.map((r) => ({ period: label(r.end, true), startDate: r.start, endDate: r.end, value: r.val, form: '10-K', filed: r.filed })),
      ]
    : rows.map((r) => {
        const yearEnd = fiscalYearEnd(r.end);
        const atYearEnd = annualForm(r.form) === '10-K' && Math.abs(daysBetween(r.end, yearEnd)) <= 7;
        return { period: label(r.end, atYearEnd), endDate: r.end, value: r.val, form: annualForm(r.form), filed: r.filed };
      });

  // Oldest first; at a shared end date the quarter precedes its fiscal year.
  return points.sort((a, b) => a.endDate.localeCompare(b.endDate) || (a.form === '10-K' ? 1 : 0) - (b.form === '10-K' ? 1 : 0));
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

// Holding-company reorganizations start a new SEC filer: the ticker maps to the
// new CIK, whose companyfacts hold only filings since the switch. The old
// filer's history is merged in (same-period rows dedupe by filing date).
const PREDECESSOR_CIKS: Record<string, number[]> = {
  XOM: [34088], // Exxon Mobil Corp → ExxonMobil Holdings Corp (2026)
};

function mergeFacts(a: CompanyFactsResponse['facts'], b: CompanyFactsResponse['facts']): CompanyFactsResponse['facts'] {
  const out: CompanyFactsResponse['facts'] = {};
  for (const ns of ['us-gaap', 'ifrs-full', 'dei'] as const) {
    const merged: Record<string, FactEntry> = {};
    for (const source of [a[ns], b[ns]]) {
      for (const [tag, entry] of Object.entries(source ?? {})) {
        const target = merged[tag] ?? (merged[tag] = { ...entry, units: {} });
        for (const [unit, rows] of Object.entries(entry.units)) target.units[unit] = [...(target.units[unit] ?? []), ...rows];
      }
    }
    if (Object.keys(merged).length > 0) out[ns] = merged;
  }
  return out;
}

export async function getCompanyFundamentals(
  ticker: string
): Promise<CompanyFundamentals | null> {
  const cik = await tickerToCIK(ticker);
  if (!cik) return null;

  const cacheKey = `edgar:facts:${cik}`;

  return withCache(cacheKey, TTL.FUNDAMENTALS, async () => {
    const fetchFacts = (id: number) => fetchJson<CompanyFactsResponse>(
      `${config.edgar.baseUrl}/api/xbrl/companyfacts/CIK${cikSegment(id)}.json`,
      { headers: edgarHeaders(), provider: 'EDGAR', retries: 1 }
    );
    const data = await fetchFacts(cik);
    for (const id of PREDECESSOR_CIKS[ticker.toUpperCase()] ?? []) {
      const earlier = await fetchFacts(id).catch(() => null);
      if (earlier) data.facts = mergeFacts(earlier.facts, data.facts);
    }

    const shares = latestSharesOutstanding(data.facts);
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
      sharesOutstanding: shares?.shares ?? null,
      sharesForm: shares?.form ?? null,
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
  sic?: string;
  sicDescription?: string;
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
      `${config.edgar.baseUrl}/submissions/CIK${cikSegment(cik)}.json`,
      { headers: edgarHeaders(), provider: 'EDGAR' }
    );

    const recent = data.filings.recent;
    const filings: Filing[] = [];

    for (let i = 0; i < recent.accessionNumber.length && filings.length < count; i++) {
      if (formTypes && !formTypes.includes(recent.form[i])) continue;

      const accession = encodeUpstreamRelative(recent.accessionNumber[i].replace(/-/g, ''));
      const document = encodeUpstreamRelative(recent.primaryDocument[i]);
      if (!accession || !document) continue;
      filings.push({
        accessionNumber: recent.accessionNumber[i],
        form: recent.form[i],
        filingDate: recent.filingDate[i],
        reportDate: recent.reportDate[i],
        primaryDocument: recent.primaryDocument[i],
        primaryDocDescription: recent.primaryDocDescription[i],
        fileUrl: `https://www.sec.gov/Archives/edgar/data/${cikSegment(cik)}/${accession}/${document}`,
      });
    }

    return filings;
  });
}

/** Standard Industrial Classification code from the company's SEC submissions. */
export async function getCompanySic(ticker: string): Promise<string | null> {
  const cik = await tickerToCIK(ticker);
  if (!cik) return null;
  return withCache(`edgar:sic:${cik}`, TTL.FILINGS, async () => {
    const data = await fetchJson<SubmissionsResponse>(
      `${config.edgar.baseUrl}/submissions/CIK${cikSegment(cik)}.json`,
      { headers: edgarHeaders(), provider: 'EDGAR', retries: 1 }
    );
    return data.sic || null;
  });
}

/** End date of the most recent period in the company's income statement or balance sheet filings. */
export function latestFilingPeriod(f: CompanyFundamentals): string | null {
  const ends = [f.revenue, f.netIncome, f.eps, f.stockholdersEquity]
    .map((series) => series.at(-1)?.endDate)
    .filter((d): d is string => Boolean(d));
  return ends.length > 0 ? ends.sort().at(-1)! : null;
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
 * Trailing-twelve-month sum from XBRL flow data (revenue, net income, EPS, etc.).
 *
 * EDGAR XBRL mixes 10-K full-YEAR figures (form '10-K', period suffix "FY") with
 * 10-Q 3-MONTH figures (form '10-Q', period suffix "Q1"/"Q2"/"Q3"). Naively summing
 * the last 4 points adds one full year to three quarters and badly overstates TTM.
 *
 * Approach: only 3-month quarterly periods (Q1–Q3) arrive as standalone 10-Q facts —
 * Q4 is never filed separately, it's folded into the 10-K full-year figure. So we
 * derive Q4 = FY − (Q1 + Q2 + Q3) for each fiscal year, then sum the trailing 4
 * true 3-month quarters by endDate. Falls back to the latest full-year 10-K when we
 * can't assemble 4 quarters.
 */
interface Trailing { value: number; endDate: string }

function computeTTM(data: FundamentalDataPoint[]): Trailing | null {
  const byEnd = (x: FundamentalDataPoint, y: FundamentalDataPoint) => x.endDate.localeCompare(y.endDate);
  const quarters = data.filter((d) => d.startDate && /-Q[1-4]$/.test(d.period)).sort(byEnd);
  const latestAnnual = data.filter((d) => /-FY$/.test(d.period)).sort(byEnd).at(-1) ?? null;

  // Trailing four quarters, only when they are back-to-back and at least as
  // recent as the latest fiscal year; otherwise that fiscal year itself.
  const last4 = quarters.slice(-4);
  const backToBack = last4.length === 4 &&
    last4.every((q, i) => i === 0 || Math.abs(daysBetween(last4[i - 1].endDate, q.startDate!)) <= 7);
  if (backToBack && (!latestAnnual || last4[3].endDate >= latestAnnual.endDate)) {
    return { value: last4.reduce((sum, q) => sum + q.value, 0), endDate: last4[3].endDate };
  }
  return latestAnnual ? { value: latestAnnual.value, endDate: latestAnnual.endDate } : null;
}

// A ratio of two trailing figures only when they cover (nearly) the same
// months — a tag a company stopped using must not divide into current revenue.
function trailingRatio(numerator: Trailing | null, denominator: Trailing | null): number | null {
  if (!numerator || !denominator || !denominator.value) return null;
  if (Math.abs(daysBetween(numerator.endDate, denominator.endDate)) > 100) return null;
  return (numerator.value / denominator.value) * 100;
}

/**
 * Extract scoring metrics from EDGAR XBRL data.
 * Used as the filings source for the fundamentals score (Finnhub fills gaps when configured).
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

  // TTM = trailing four true 3-month quarters (see computeTTM).
  const getTTM = (data: FundamentalDataPoint[]) => computeTTM(data);

  const revenueTTM = getTTM(f.revenue);
  const netIncomeTTM = getTTM(f.netIncome);
  const ttmRevenue = revenueTTM?.value ?? null;
  const ttmNetIncome = netIncomeTTM?.value ?? null;
  const ttmEPS = getTTM(f.eps)?.value ?? null;

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
    netMargin: ttmNetIncome ? trailingRatio(netIncomeTTM, revenueTTM) : null,
    grossMargin: trailingRatio(getTTM(f.grossProfit), revenueTTM),
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

  // TTM = trailing four true 3-month quarters (see computeTTM).
  const getTTM = (data: FundamentalDataPoint[]) => computeTTM(data);

  const revenueTTM = getTTM(fundamentals.revenue);
  const netIncomeTTM = getTTM(fundamentals.netIncome);
  const ttmRevenue = revenueTTM?.value ?? null;
  const ttmNetIncome = netIncomeTTM?.value ?? null;
  const ttmEPS = getTTM(fundamentals.eps)?.value ?? null;

  const latestDebt = getLatestAnnual(fundamentals.longTermDebt);
  const latestEquity = getLatestAnnual(fundamentals.stockholdersEquity);

  return {
    ttmRevenue,
    ttmNetIncome,
    ttmEPS,
    grossMargin: trailingRatio(getTTM(fundamentals.grossProfit), revenueTTM),
    operatingMargin: trailingRatio(getTTM(fundamentals.operatingIncome), revenueTTM),
    netMargin: ttmNetIncome ? trailingRatio(netIncomeTTM, revenueTTM) : null,
    debtToEquity:
      latestDebt !== null && latestEquity ? latestDebt / latestEquity : null,
    currentAssets: getLatestAnnual(fundamentals.totalAssets),
  };
}
