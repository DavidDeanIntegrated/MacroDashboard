// Polygon.io API client — Market Data, Technical Indicators, Corporate Actions
// Docs: https://polygon.io/docs

import { config } from './config';
import { fetchJson } from './fetcher';
import { withCache, TTL } from './cache';

function polygonUrl(path: string, params?: Record<string, string>): string {
  const url = new URL(`https://api.polygon.io${path}`);
  url.searchParams.set('apiKey', config.polygon.apiKey);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

// ─── Aggregates (Bars) ───

interface PolygonAggResult {
  o: number; // open
  h: number; // high
  l: number; // low
  c: number; // close
  v: number; // volume
  t: number; // timestamp (ms)
  vw?: number; // volume weighted avg price
  n?: number; // number of transactions
}

interface PolygonAggResponse {
  ticker: string;
  resultsCount: number;
  results: PolygonAggResult[];
  status: string;
}

export interface OHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type PolygonTimeframe = '1min' | '5min' | '15min' | '1hour' | '1day';

const TIMEFRAME_MAP: Record<PolygonTimeframe, { multiplier: string; timespan: string }> = {
  '1min': { multiplier: '1', timespan: 'minute' },
  '5min': { multiplier: '5', timespan: 'minute' },
  '15min': { multiplier: '15', timespan: 'minute' },
  '1hour': { multiplier: '1', timespan: 'hour' },
  '1day': { multiplier: '1', timespan: 'day' },
};

// Default lookback in days for each timeframe
const LOOKBACK_DAYS: Record<PolygonTimeframe, number> = {
  '1min': 1,
  '5min': 5,
  '15min': 10,
  '1hour': 30,
  '1day': 365,
};

export async function getAggregates(
  symbol: string,
  timeframe: PolygonTimeframe = '1day',
  from?: string,
  to?: string,
  limit = 500
): Promise<OHLCV[]> {
  const tf = TIMEFRAME_MAP[timeframe];
  const now = new Date();
  const defaultTo = to || now.toISOString().split('T')[0];
  const defaultFrom = from || (() => {
    const d = new Date(now);
    d.setDate(d.getDate() - LOOKBACK_DAYS[timeframe]);
    return d.toISOString().split('T')[0];
  })();

  const cacheKey = `polygon:agg:${symbol}:${timeframe}:${defaultFrom}:${defaultTo}`;
  const ttl = timeframe === '1day' ? TTL.MACRO : TTL.QUOTES;

  return withCache(cacheKey, ttl, async () => {
    const url = polygonUrl(
      `/v2/aggs/ticker/${symbol}/range/${tf.multiplier}/${tf.timespan}/${defaultFrom}/${defaultTo}`,
      { adjusted: 'true', sort: 'asc', limit: limit.toString() }
    );

    const data = await fetchJson<PolygonAggResponse>(url, { provider: 'Polygon' });
    if (!data.results) return [];

    return data.results.map((r) => ({
      date: new Date(r.t).toISOString(),
      open: r.o,
      high: r.h,
      low: r.l,
      close: r.c,
      volume: r.v,
    }));
  });
}

// ─── Snapshot ───

interface PolygonTickerSnapshot {
  ticker: string;
  todaysChange: number;
  todaysChangePerc: number;
  day: { o: number; h: number; l: number; c: number; v: number; vw: number };
  prevDay: { o: number; h: number; l: number; c: number; v: number; vw: number };
  lastTrade: { p: number; s: number; t: number };
  lastQuote: { P: number; S: number; p: number; s: number; t: number };
  min: { o: number; h: number; l: number; c: number; v: number; vw: number; t: number };
}

interface PolygonSnapshotResponse {
  ticker: PolygonTickerSnapshot;
  status: string;
}

export interface PolygonSnapshot {
  price: number;
  change: number;
  changePercent: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  volume: number;
}

export async function getSnapshot(symbol: string): Promise<PolygonSnapshot> {
  return withCache(`polygon:snapshot:${symbol}`, TTL.QUOTES, async () => {
    const url = polygonUrl(`/v2/snapshot/locale/us/markets/stocks/tickers/${symbol}`);
    const data = await fetchJson<PolygonSnapshotResponse>(url, { provider: 'Polygon' });
    const t = data.ticker;
    return {
      price: t.lastTrade?.p || t.day?.c || 0,
      change: t.todaysChange || 0,
      changePercent: t.todaysChangePerc || 0,
      open: t.day?.o || 0,
      high: t.day?.h || 0,
      low: t.day?.l || 0,
      prevClose: t.prevDay?.c || 0,
      volume: t.day?.v || 0,
    };
  });
}

// ─── Technical Indicators ───

interface PolygonIndicatorValue {
  timestamp: number;
  value: number;
}

interface PolygonMACDValue {
  timestamp: number;
  value: number;
  signal: number;
  histogram: number;
}

interface PolygonIndicatorResponse<T> {
  results: {
    values: T[];
  };
  status: string;
}

export interface TechnicalIndicatorPoint {
  date: string;
  value: number;
}

export interface MACDPoint {
  date: string;
  macd: number;
  signal: number;
  histogram: number;
}

export async function getSMA(
  symbol: string,
  window = 50,
  timespan: 'day' | 'hour' | 'minute' = 'day',
  limit = 120
): Promise<TechnicalIndicatorPoint[]> {
  return withCache(`polygon:sma:${symbol}:${window}:${timespan}:${limit}`, TTL.QUOTES, async () => {
    const url = polygonUrl(`/v1/indicators/sma/${symbol}`, {
      timespan,
      'window': window.toString(),
      series_type: 'close',
      order: 'asc',
      limit: limit.toString(),
    });
    const data = await fetchJson<PolygonIndicatorResponse<PolygonIndicatorValue>>(url, { provider: 'Polygon' });
    if (!data.results?.values) return [];
    return data.results.values.map((v) => ({
      date: new Date(v.timestamp).toISOString(),
      value: v.value,
    }));
  });
}

// Latest 200-week simple moving average — the ~4-year full-cycle price anchor.
// Computed server-side by Polygon on weekly bars. Returns null when the symbol
// doesn't have ~200 weeks of history (recent IPOs) or the endpoint errors, so
// callers can render "n/a" instead of breaking.
export async function getWeeklySMA200(symbol: string): Promise<number | null> {
  return withCache(`polygon:wma200:${symbol}`, TTL.MACRO, async () => {
    try {
      const url = polygonUrl(`/v1/indicators/sma/${symbol}`, {
        timespan: 'week',
        window: '200',
        series_type: 'close',
        order: 'desc',
        limit: '1',
      });
      const data = await fetchJson<PolygonIndicatorResponse<PolygonIndicatorValue>>(url, { provider: 'Polygon' });
      const v = data.results?.values?.[0]?.value;
      return v != null && isFinite(v) && v > 0 ? v : null;
    } catch {
      return null;
    }
  });
}

export async function getRSI(
  symbol: string,
  window = 14,
  timespan: 'day' | 'hour' | 'minute' = 'day',
  limit = 120
): Promise<TechnicalIndicatorPoint[]> {
  return withCache(`polygon:rsi:${symbol}:${window}:${timespan}:${limit}`, TTL.QUOTES, async () => {
    const url = polygonUrl(`/v1/indicators/rsi/${symbol}`, {
      timespan,
      'window': window.toString(),
      series_type: 'close',
      order: 'asc',
      limit: limit.toString(),
    });
    const data = await fetchJson<PolygonIndicatorResponse<PolygonIndicatorValue>>(url, { provider: 'Polygon' });
    if (!data.results?.values) return [];
    return data.results.values.map((v) => ({
      date: new Date(v.timestamp).toISOString(),
      value: v.value,
    }));
  });
}

export async function getMACD(
  symbol: string,
  shortWindow = 12,
  longWindow = 26,
  signalWindow = 9,
  timespan: 'day' | 'hour' | 'minute' = 'day',
  limit = 120
): Promise<MACDPoint[]> {
  const cacheKey = `polygon:macd:${symbol}:${shortWindow}:${longWindow}:${signalWindow}:${timespan}:${limit}`;
  return withCache(cacheKey, TTL.QUOTES, async () => {
    const url = polygonUrl(`/v1/indicators/macd/${symbol}`, {
      timespan,
      short_window: shortWindow.toString(),
      long_window: longWindow.toString(),
      signal_window: signalWindow.toString(),
      series_type: 'close',
      order: 'asc',
      limit: limit.toString(),
    });
    const data = await fetchJson<PolygonIndicatorResponse<PolygonMACDValue>>(url, { provider: 'Polygon' });
    if (!data.results?.values) return [];
    return data.results.values.map((v) => ({
      date: new Date(v.timestamp).toISOString(),
      macd: v.value,
      signal: v.signal,
      histogram: v.histogram,
    }));
  });
}

export async function getEMA(
  symbol: string,
  window = 20,
  timespan: 'day' | 'hour' | 'minute' = 'day',
  limit = 120
): Promise<TechnicalIndicatorPoint[]> {
  return withCache(`polygon:ema:${symbol}:${window}:${timespan}:${limit}`, TTL.QUOTES, async () => {
    const url = polygonUrl(`/v1/indicators/ema/${symbol}`, {
      timespan,
      'window': window.toString(),
      series_type: 'close',
      order: 'asc',
      limit: limit.toString(),
    });
    const data = await fetchJson<PolygonIndicatorResponse<PolygonIndicatorValue>>(url, { provider: 'Polygon' });
    if (!data.results?.values) return [];
    return data.results.values.map((v) => ({
      date: new Date(v.timestamp).toISOString(),
      value: v.value,
    }));
  });
}

// ─── Dividends ───

interface PolygonDividend {
  cash_amount: number;
  declaration_date: string;
  dividend_type: string;
  ex_dividend_date: string;
  frequency: number;
  pay_date: string;
  record_date: string;
  ticker: string;
}

interface PolygonDividendsResponse {
  results: PolygonDividend[];
  status: string;
}

export interface Dividend {
  ticker: string;
  amount: number;
  exDate: string;
  payDate: string;
  declarationDate: string;
  frequency: number; // 1=annual, 2=semi, 4=quarterly, 12=monthly
  type: string;
}

export async function getDividends(
  symbol: string,
  limit = 12
): Promise<Dividend[]> {
  return withCache(`polygon:dividends:${symbol}:${limit}`, TTL.FILINGS, async () => {
    const url = polygonUrl(`/v3/reference/dividends`, {
      ticker: symbol,
      limit: limit.toString(),
      order: 'desc',
      sort: 'ex_dividend_date',
    });
    const data = await fetchJson<PolygonDividendsResponse>(url, { provider: 'Polygon' });
    if (!data.results) return [];
    return data.results.map((d) => ({
      ticker: d.ticker,
      amount: d.cash_amount,
      exDate: d.ex_dividend_date,
      payDate: d.pay_date,
      declarationDate: d.declaration_date,
      frequency: d.frequency,
      type: d.dividend_type,
    }));
  });
}

// ─── Ticker Details (Reference) ───

interface PolygonTickerDetails {
  ticker: string;
  name: string;
  market: string;
  locale: string;
  primary_exchange: string;
  type: string;
  currency_name: string;
  market_cap: number;
  sic_code: string;
  sic_description: string;
  total_employees: number;
  list_date: string;
  branding?: { logo_url: string; icon_url: string };
}

interface PolygonTickerDetailsResponse {
  results: PolygonTickerDetails;
  status: string;
}

export interface TickerDetails {
  ticker: string;
  name: string;
  exchange: string;
  marketCap: number;
  sicCode: string;
  sicDescription: string;
  employees: number;
  listDate: string;
}

export async function getTickerDetails(symbol: string): Promise<TickerDetails> {
  return withCache(`polygon:details:${symbol}`, TTL.FILINGS, async () => {
    const url = polygonUrl(`/v3/reference/tickers/${symbol}`);
    const data = await fetchJson<PolygonTickerDetailsResponse>(url, { provider: 'Polygon' });
    const r = data.results;
    return {
      ticker: r.ticker,
      name: r.name,
      exchange: r.primary_exchange,
      marketCap: r.market_cap,
      sicCode: r.sic_code,
      sicDescription: r.sic_description,
      employees: r.total_employees,
      listDate: r.list_date,
    };
  });
}

// ─── Stock Financials ───

interface PolygonFinancialValue {
  label: string;
  value: number;
  unit: string;
  order: number;
}

interface PolygonFinancialStatements {
  income_statement: Record<string, PolygonFinancialValue>;
  balance_sheet: Record<string, PolygonFinancialValue>;
  cash_flow_statement: Record<string, PolygonFinancialValue>;
  comprehensive_income?: Record<string, PolygonFinancialValue>;
}

interface PolygonFinancialResult {
  id: string;
  start_date: string;
  end_date: string;
  timeframe: 'annual' | 'quarterly' | 'ttm';
  fiscal_period: string;
  fiscal_year: string;
  cik: string;
  company_name: string;
  filing_date: string;
  source_filing_url: string;
  financials: PolygonFinancialStatements;
}

interface PolygonFinancialsResponse {
  results: PolygonFinancialResult[];
  status: string;
  count: number;
}

export interface StockFinancials {
  // Income Statement
  revenue: number | null;
  costOfRevenue: number | null;
  grossProfit: number | null;
  operatingExpenses: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  eps: number | null;
  ebitda: number | null;
  researchDevelopment: number | null;

  // Balance Sheet
  totalAssets: number | null;
  totalLiabilities: number | null;
  stockholdersEquity: number | null;
  currentAssets: number | null;
  currentLiabilities: number | null;
  cash: number | null;
  longTermDebt: number | null;
  totalDebt: number | null;

  // Cash Flow
  operatingCashFlow: number | null;
  capitalExpenditures: number | null;
  freeCashFlow: number | null;

  // Metadata
  fiscalPeriod: string;
  fiscalYear: string;
  endDate: string;
  filingDate: string;
  companyName: string;
  timeframe: 'annual' | 'quarterly' | 'ttm';
}

function extractVal(statements: PolygonFinancialStatements, section: keyof PolygonFinancialStatements, ...keys: string[]): number | null {
  const stmt = statements[section];
  if (!stmt) return null;
  for (const key of keys) {
    if (stmt[key]?.value !== undefined) return stmt[key].value;
  }
  return null;
}

function mapFinancialResult(r: PolygonFinancialResult): StockFinancials {
  const f = r.financials;
  const revenue = extractVal(f, 'income_statement', 'revenues', 'revenue');
  const costOfRevenue = extractVal(f, 'income_statement', 'cost_of_revenue');
  const grossProfit = extractVal(f, 'income_statement', 'gross_profit');
  const operatingExpenses = extractVal(f, 'income_statement', 'operating_expenses');
  const operatingIncome = extractVal(f, 'income_statement', 'operating_income_loss', 'income_loss_from_continuing_operations_before_tax');
  const netIncome = extractVal(f, 'income_statement', 'net_income_loss', 'net_income_loss_attributable_to_parent');
  const eps = extractVal(f, 'income_statement', 'diluted_earnings_per_share', 'basic_earnings_per_share');
  const ebitda = extractVal(f, 'income_statement', 'ebitda');
  const researchDevelopment = extractVal(f, 'income_statement', 'research_and_development');

  const totalAssets = extractVal(f, 'balance_sheet', 'assets');
  const totalLiabilities = extractVal(f, 'balance_sheet', 'liabilities');
  const stockholdersEquity = extractVal(f, 'balance_sheet', 'equity', 'equity_attributable_to_parent', 'stockholders_equity');
  const currentAssets = extractVal(f, 'balance_sheet', 'current_assets');
  const currentLiabilities = extractVal(f, 'balance_sheet', 'current_liabilities');
  const cash = extractVal(f, 'balance_sheet', 'cash_and_cash_equivalents', 'cash');
  const longTermDebt = extractVal(f, 'balance_sheet', 'long_term_debt', 'noncurrent_liabilities');
  const totalDebt = extractVal(f, 'balance_sheet', 'debt', 'long_term_debt');

  const operatingCashFlow = extractVal(f, 'cash_flow_statement', 'net_cash_flow_from_operating_activities', 'net_cash_flow_from_operating_activities_continuing');
  const capitalExpenditures = extractVal(f, 'cash_flow_statement', 'capital_expenditure');
  const capex = capitalExpenditures ?? 0;
  const freeCashFlow = operatingCashFlow !== null ? operatingCashFlow - Math.abs(capex) : null;

  return {
    revenue, costOfRevenue, grossProfit, operatingExpenses, operatingIncome,
    netIncome, eps, ebitda, researchDevelopment,
    totalAssets, totalLiabilities, stockholdersEquity,
    currentAssets, currentLiabilities, cash, longTermDebt, totalDebt,
    operatingCashFlow, capitalExpenditures, freeCashFlow,
    fiscalPeriod: r.fiscal_period,
    fiscalYear: r.fiscal_year,
    endDate: r.end_date,
    filingDate: r.filing_date,
    companyName: r.company_name,
    timeframe: r.timeframe,
  };
}

export async function getStockFinancials(
  symbol: string,
  timeframe: 'annual' | 'quarterly' | 'ttm' = 'annual',
  limit = 5
): Promise<StockFinancials[]> {
  return withCache(`polygon:financials:${symbol}:${timeframe}:${limit}`, TTL.FUNDAMENTALS, async () => {
    const url = polygonUrl('/vX/reference/financials', {
      ticker: symbol,
      timeframe,
      limit: limit.toString(),
      order: 'desc',
      sort: 'period_of_report_date',
    });
    const data = await fetchJson<PolygonFinancialsResponse>(url, { provider: 'Polygon' });
    if (!data.results) return [];
    return data.results.map(mapFinancialResult);
  });
}
