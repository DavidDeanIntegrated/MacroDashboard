require('../scripts/register-ts.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { invalidatePrefix } = require('../src/lib/cache.ts');
const { getCompanyFundamentals, extractScoringMetrics, computeMetrics } = require('../src/lib/edgar.ts');

// One SEC companyfacts row. fy/fp belong to the FILING, not to the dates.
const row = (start, end, val, form, fy, fp, filed) => ({ start, end, val, form, fy, fp, filed, accn: `a-${filed}` });
const concept = (rows) => ({ label: '', description: '', units: { USD: rows } });

async function withFacts(facts, fn) {
  invalidatePrefix('edgar:');
  const original = global.fetch;
  global.fetch = async (u) => {
    const url = String(u);
    const body = url.includes('company_tickers.json')
      ? { 0: { cik_str: 1, ticker: 'TEST', title: 'Test Co' } }
      : { cik: 1, entityName: 'Test Co', facts };
    return { ok: true, status: 200, statusText: 'OK', headers: { get: () => null }, json: async () => body };
  };
  try { return await fn(await getCompanyFundamentals('TEST')); } finally { global.fetch = original; }
}

// June fiscal year (like MSFT): FY2025 = Jul 2024–Jun 2025, FY2026 Q1–Q3 filed so far.
const fiscalYear = [
  row('2024-07-01', '2025-06-30', 400, '10-K', 2025, 'FY', '2025-07-30'),
  row('2024-07-01', '2024-09-30', 90, '10-Q', 2025, 'Q1', '2024-10-30'),
  row('2024-10-01', '2024-12-31', 100, '10-Q', 2025, 'Q2', '2025-01-30'),
  row('2025-01-01', '2025-03-31', 100, '10-Q', 2025, 'Q3', '2025-04-30'),
];

test('a 10-Q\'s prior-year comparative and year-to-date total never stand in for its quarter', () =>
  withFacts({ 'us-gaap': { NetIncomeLoss: concept([
    ...fiscalYear,
    // All filed in the FY2026 Q2 10-Q under fy=2026 fp=Q2; the comparative comes first.
    row('2024-10-01', '2024-12-31', 100, '10-Q', 2026, 'Q2', '2026-01-29'),
    row('2025-07-01', '2025-12-31', 230, '10-Q', 2026, 'Q2', '2026-01-29'),
    row('2025-10-01', '2025-12-31', 120, '10-Q', 2026, 'Q2', '2026-01-29'),
    row('2025-07-01', '2025-09-30', 110, '10-Q', 2026, 'Q1', '2025-10-29'),
  ]) } }, (f) => {
    const q = f.netIncome.find((d) => d.endDate === '2025-12-31');
    assert.equal(q.value, 120);
    assert.equal(q.period, '2026-Q2');
    assert.equal(f.netIncome.some((d) => d.value === 230), false, 'six-month totals are dropped');
    assert.equal(f.netIncome.find((d) => d.endDate === '2024-12-31').period, '2025-Q2');
    // Q4 FY2025 derived: 400 − (90 + 100 + 100).
    const q4 = f.netIncome.find((d) => d.period === '2025-Q4');
    assert.equal(q4.value, 110);
    assert.equal(q4.startDate, '2025-04-01');
    // TTM = Q3'25 + Q4'25 + Q1'26 + Q2'26.
    assert.equal(computeMetrics(f).ttmNetIncome, 100 + 110 + 110 + 120);
  }));

test('revenue tags are merged so a tag the company stopped using cannot win', () =>
  withFacts({ 'us-gaap': {
    Revenues: concept([row('2010-07-01', '2011-06-30', 70, '10-K', 2011, 'FY', '2011-07-28')]),
    RevenueFromContractWithCustomerExcludingAssessedTax: concept(fiscalYear.map((r) => ({ ...r, val: r.val * 3 }))),
    NetIncomeLoss: concept(fiscalYear),
  } }, (f) => {
    assert.equal(f.revenue.at(-1).endDate, '2025-06-30');
    const m = extractScoringMetrics(f);
    assert.equal(m.revenue, 1200, 'TTM = the latest fiscal year (Q4 ends with it)');
    assert.ok(Math.abs(m.netMargin - 100 / 3) < 1e-9);
    assert.ok(Math.abs(m.revenueGrowth - ((1200 - 70) / 70) * 100) < 1e-9);
  }));

test('a restatement in a later filing replaces the original figure', () =>
  withFacts({ 'us-gaap': { NetIncomeLoss: concept([
    row('2025-01-01', '2025-03-31', 50, '10-Q', 2025, 'Q1', '2025-04-30'),
    row('2025-01-01', '2025-03-31', 45, '10-Q', 2026, 'Q1', '2026-04-29'),
  ]) } }, (f) => {
    assert.equal(f.netIncome.length, 1);
    assert.equal(f.netIncome[0].value, 45);
  }));

test('balance-sheet values keep the latest end date and fiscal-year labels', () =>
  withFacts({ 'us-gaap': {
    NetIncomeLoss: concept(fiscalYear),
    StockholdersEquity: { label: '', description: '', units: { USD: [
      { end: '2025-06-30', val: 900, form: '10-K', fy: 2025, fp: 'FY', filed: '2025-07-30', accn: 'k' },
      { end: '2025-09-30', val: 950, form: '10-Q', fy: 2026, fp: 'Q1', filed: '2025-10-29', accn: 'q' },
      { end: '2024-06-30', val: 800, form: '10-Q', fy: 2026, fp: 'Q1', filed: '2025-10-29', accn: 'q' },
    ] } },
  } }, (f) => {
    assert.deepEqual(f.stockholdersEquity.map((d) => [d.endDate, d.value]), [['2024-06-30', 800], ['2025-06-30', 900], ['2025-09-30', 950]]);
    assert.equal(extractScoringMetrics(f).equity, 950);
  }));

test('a margin is withheld when its two figures cover different periods', () =>
  withFacts({ 'us-gaap': {
    RevenueFromContractWithCustomerExcludingAssessedTax: concept(fiscalYear.map((r) => ({ ...r, val: r.val * 3 }))),
    NetIncomeLoss: concept(fiscalYear),
    // Gross profit last tagged in 2019 must not divide into 2025 revenue.
    GrossProfit: concept([row('2018-07-01', '2019-06-30', 500, '10-K', 2019, 'FY', '2019-08-01')]),
  } }, (f) => {
    const m = extractScoringMetrics(f);
    assert.equal(m.grossMargin, null);
    assert.ok(Math.abs(m.netMargin - 100 / 3) < 1e-9);
    assert.equal(computeMetrics(f).grossMargin, null);
  }));
