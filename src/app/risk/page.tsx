'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useApi, useFundamentalsScores } from '@/lib/hooks';
import { type HoldingsPortfolio } from '@/lib/holdings';
import { Card, CardTitle } from '@/components/ui/Card';
import { ErrorState, LoadingCard } from '@/components/ui/Loading';
import { SCENARIOS, scenarioDefaults, stressPortfolio, lookThrough, parseResearchInputs, researchChanges, type Scenario, type ResearchInputs, type RiskEstimate, type Sensitivity } from '@/lib/portfolio-risk';
import { macroSensitivity } from '@/lib/macro-sensitivity';
import type { EconomicAssessment } from '@/lib/economy';
import { formatCurrency } from '@/lib/format';

interface RiskData {
  portfolio: HoldingsPortfolio; risk: RiskEstimate;
  sensitivities: { symbol: string; weight: number; factors: (Sensitivity & { key: string; name: string; mode: string })[] }[];
  errors: string[]; methodology: string; fetchedAt: string;
}
const emptyResearch: ResearchInputs = { constituents: [], observations: [] };
const fmt = (v: number | null | undefined) => v == null ? '—' : v.toFixed(2);
const inputClass = 'border border-black/20 rounded-lg px-3 py-2 bg-white text-sm';

export default function RiskPage() {
  const { data, loading, error, refresh } = useApi<RiskData>('/api/risk', { timeoutMs: 120000 });
  const { data: macro } = useApi<{ assessment: EconomicAssessment }>('/api/fred?action=dashboard');
  const symbols = useMemo(() => (data?.portfolio.positions ?? []).filter(p => p.symbol !== 'CASH').map(p => p.symbol), [data]);
  const { data: fundamentals, error: fundamentalsError } = useFundamentalsScores(symbols);
  const [scenario, setScenario] = useState<Scenario>('Demand recession');
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [severity, setSeverity] = useState(1);
  const [research, setResearch] = useState<ResearchInputs>(emptyResearch);
  const [inputError, setInputError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    try { const saved = localStorage.getItem('macro-research-v1'); if (saved) setResearch(parseResearchInputs(JSON.parse(saved))); }
    catch { setInputError('Saved research could not be read. Import a valid replacement.'); }
  }, []);
  const positions = data?.portfolio.positions ?? [];
  const defaults = scenarioDefaults(positions, scenario);
  const shocks = Object.fromEntries(positions.map(p => [p.symbol, Math.max(-100, Math.min(300, (overrides[p.symbol] ?? defaults[p.symbol]) * severity))]));
  const stress = stressPortfolio(positions, shocks);
  const overlap = lookThrough(positions, research.constituents);
  const revisions = researchChanges(research.observations);
  const assessment = macro?.assessment;

  async function importResearch(file?: File) {
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error('Research file exceeds 5 MB.');
      const parsed = parseResearchInputs(JSON.parse(await file.text()));
      localStorage.setItem('macro-research-v1', JSON.stringify(parsed));
      setResearch(parsed); setInputError(null); setNotice(`Imported ${parsed.constituents.length} constituent rows and ${parsed.observations.length} research observations. Saved in this browser.`);
    } catch (e) { setInputError(e instanceof Error ? e.message : 'Import failed.'); }
  }
  function exportResearch() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(research, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'macro-research.json'; a.click(); URL.revokeObjectURL(url);
  }

  return <div className="space-y-6">
    <div><h2 className="text-2xl font-semibold">Portfolio risk and economic alignment</h2><p className="text-sm text-black/55 mt-2">Measured historical exposure, explicit stress assumptions, and dated business evidence. <Link href="/macro" className="text-accent-blue">Inspect the economic inputs →</Link></p></div>
    {loading && <LoadingCard />}
    {error && <ErrorState message={error} onRetry={refresh} />}
    {data && !error && <>
      <Card><CardTitle>Economic alignment</CardTitle>
        <p className="mt-2 text-sm">{assessment?.description ?? 'Economic assessment unavailable.'}</p>
        <p className="mt-2 text-sm">Your largest measured risk contributor is {data.risk.contributions[0] ? `${data.risk.contributions[0].symbol} (${fmt(data.risk.contributions[0].varianceShare)}% of portfolio price variance)` : 'unavailable because the full portfolio history is insufficient'}. Compare this with the exposures and stress losses below; target-band compliance alone does not establish suitability.</p>
        <p className="mt-2 text-xs text-black/55">{data.portfolio.source}. Quantities as of {data.portfolio.holdingsAsOf}; valuation fetched {data.portfolio.valuationAsOf}. No suitability score is assigned without an investment horizon, loss tolerance, and complete account coverage.</p>
      </Card>
      <Card><CardTitle>Total portfolio risk contributions</CardTitle>
        <p className="mt-2">{data.risk.status}. Annualized price volatility: {fmt(data.risk.annualizedVolatility)}%.</p>
        <p className="text-xs text-black/55 mt-1">{data.risk.observations} common return intervals · {data.risk.start ?? '—'} to {data.risk.end ?? '—'} · history coverage {fmt(data.risk.coveredWeight)}% by weight. {data.risk.excluded.length > 0 && `Missing/short history: ${data.risk.excluded.join(', ')}. No full-portfolio estimate is fabricated.`}</p>
        <div className="overflow-x-auto"><table className="w-full text-sm mt-3"><thead><tr><th className="text-left p-2">Holding</th><th>Capital weight</th><th>Share of variance</th></tr></thead><tbody>
          {data.risk.contributions.map(p => <tr key={p.symbol} className="border-t border-black/5"><td className="p-2">{p.symbol}</td><td className="text-center">{fmt(p.weight)}%</td><td className="text-center">{fmt(p.varianceShare)}%</td></tr>)}
        </tbody></table></div>
        <p className="text-xs text-black/55 mt-3">Variance share = weight × covariance with portfolio / portfolio variance. Negative values indicate historical hedging contribution. All positions, including crypto and conviction holdings, are included. {data.methodology}</p>
        {data.errors.length > 0 && <p role="status" className="text-xs text-accent-orange mt-2">{data.errors.join('; ')}</p>}
      </Card>
      <Card><CardTitle>Measured factor associations</CardTitle>
        <p className="text-xs text-black/55 mt-2">Each cell is a separate regression: beta ± 1.96 standard errors, with R² and sample size. SPY/USD coefficients are return percentage points per 1% factor move; yield/spread coefficients are return percentage points per 1 percentage-point move. These associations overlap and must not be added into a combined forecast. Short samples and low R² warrant caution.</p>
        <div className="overflow-x-auto"><table className="w-full text-xs mt-3"><thead><tr><th className="text-left p-2">Holding</th>{data.sensitivities[0]?.factors.map(f => <th key={f.key} className="p-2">{f.name}</th>)}</tr></thead><tbody>
          {data.sensitivities.map(p => <tr key={p.symbol} className="border-t border-black/5"><td className="p-2">{p.symbol}</td>{p.factors.map(f => <td key={f.key} className="p-2 text-center whitespace-nowrap">{f.beta === null ? 'Unavailable' : `${fmt(f.beta)} ± ${fmt((f.standardError ?? 0) * 1.96)}`}<p className="text-black/45">R² {fmt(f.rSquared)} · n={f.observations}</p><p className="text-black/45">{f.start ?? '—'} – {f.end ?? '—'}</p></td>)}</tr>)}
        </tbody></table></div>
      </Card>
      <Card><CardTitle>Stress scenarios</CardTitle>
        <p className="text-sm mt-2">Illustrative instantaneous price shocks. These are editable assumptions, not measured probabilities, forecasts, or recommended trades. T-bill scenarios assume no price change; reinvestment income, taxes, and inflation-adjusted purchasing power are excluded.</p>
        <div className="flex gap-4 flex-wrap items-center my-4">
          <label className="text-sm">Scenario <select className={inputClass} value={scenario} onChange={e => { setScenario(e.target.value as Scenario); setOverrides({}); }}>{SCENARIOS.map(s => <option key={s}>{s}</option>)}</select></label>
          <label className="text-sm">Severity {severity.toFixed(2)}× <input aria-label="Scenario severity" type="range" min="0.5" max="1.5" step="0.05" value={severity} onChange={e => setSeverity(Number(e.target.value))} /></label>
        </div>
        <p className="text-xl font-semibold">Portfolio impact: {fmt(stress.percent)}% · {formatCurrency(stress.dollars)}</p>
        <p className="text-xs text-black/55 mt-1">The severity slider is a sensitivity range, not a statistical confidence interval. Losses are capped at 100% for each long position.</p>
        <div className="overflow-x-auto"><table className="w-full mt-3 text-sm"><thead><tr><th className="text-left p-2">Holding</th><th>Base shock %</th><th>Applied shock</th><th>Portfolio impact (pp)</th></tr></thead><tbody>
          {positions.map(p => <tr key={p.symbol} className="border-t border-black/5"><td className="p-2">{p.symbol}</td><td className="text-center"><input aria-label={`${p.symbol} base shock percent`} className={`${inputClass} w-24`} type="number" min="-100" max="200" value={overrides[p.symbol] ?? defaults[p.symbol]} onChange={e => { const value = Number(e.target.value); if (Number.isFinite(value)) setOverrides(o => ({ ...o, [p.symbol]: Math.max(-100, Math.min(200, value)) })); }} /></td><td className="text-center">{fmt(shocks[p.symbol])}%</td><td className="text-center">{fmt(stress.rows.find(r => r.symbol === p.symbol)?.contribution)}</td></tr>)}
        </tbody></table></div>
      </Card>
      <Card><CardTitle>ETF overlap and combined issuer exposure</CardTitle>
        <p className="text-xs text-black/55 mt-2">Uses source-dated fund snapshots imported below. Partial snapshots leave an explicit uncovered allocation; stale snapshots older than 100 days are excluded. Direct exposure is never silently substituted for unknown fund constituents.</p>
        <div className="overflow-x-auto"><table className="w-full mt-3 text-sm"><thead><tr><th className="text-left p-2">Issuer / asset</th><th>Direct %</th><th>Through funds %</th><th>Combined %</th></tr></thead><tbody>
          {overlap.exposures.map(e => <tr key={e.symbol} className="border-t border-black/5"><td className="p-2">{e.symbol}{e.funds.length > 0 && <span className="text-xs text-black/45"> · {e.funds.join(', ')}</span>}</td><td className="text-center">{fmt(e.direct)}</td><td className="text-center">{fmt(e.indirect)}</td><td className="text-center">{fmt(e.total)}</td></tr>)}
        </tbody></table></div>
        {overlap.uncovered.map(e => <p className="text-xs text-accent-orange mt-1" key={e.fund}>{e.fund}: {fmt(e.portfolioWeight)}% of the portfolio unresolved — {e.reason}.</p>)}
      </Card>
    </>}
    <Card><CardTitle>Business fundamentals and the economic outlook</CardTitle>
      <p className="text-sm mt-2">Company quality and macro sensitivity are different questions. These channels identify what to investigate; the dashboard does not infer an earnings forecast from a macro label.</p>
      {fundamentalsError && <p role="status">{fundamentalsError}</p>}
      <div className="grid md:grid-cols-2 gap-3 mt-4">{(data?.portfolio.positions ?? []).filter(h => !['Gold', 'Commodity', 'Dry Powder', 'Crypto', 'Broad Market', 'Value', 'International'].includes(h.category)).map(h => {
        const score = fundamentals?.find(f => f.symbol === h.symbol && !f.unavailable);
        const b = score?.breakdown;
        return <div key={h.symbol} className="p-4 rounded-xl bg-black/[.03]"><Link className="text-accent-blue font-medium" href={`/ticker?symbol=${h.symbol}`}>{h.symbol}</Link>
          <p className="text-xs mt-2">{macroSensitivity(h.symbol, h.category).note}</p>
          <p className="text-xs mt-2">Revenue growth {fmt(b?.growthDetail.revenueGrowth)}% · net margin {fmt(b?.profitabilityDetail.netMargin)}% · debt/equity {fmt(b?.healthDetail.debtToEquity)} · cash/debt {fmt(b?.healthDetail.cashToDebt)}</p>
          <p className="text-xs text-black/55 mt-2">Filing period: {b?.meta.dataAsOf ?? 'unavailable'} · data coverage {fmt(b?.meta.coveragePct)}%. Check demand/order guidance, pricing and input costs, refinancing needs, customer concentration, and thesis-specific operating metrics in the dated research table.</p>
        </div>;
      })}</div>
    </Card>
    <Card><CardTitle>Dated research: estimates, guidance, operating data, and fund holdings</CardTitle>
      <p className="text-sm mt-2">Import source-backed research when it is not supplied by the connected market feeds. Estimate changes compare the same metric, units, fiscal period, and observation kind. A missing comparison stays unavailable. Inputs are saved only in this browser and can be exported.</p>
      <div className="flex gap-3 flex-wrap mt-4"><label className={inputClass}>Import research JSON <input className="block mt-1" type="file" accept="application/json,.json" onChange={e => { void importResearch(e.target.files?.[0]); e.target.value = ''; }} /></label><button className={inputClass} onClick={exportResearch}>Export research</button><button className={inputClass} onClick={() => { try { localStorage.removeItem('macro-research-v1'); setResearch(emptyResearch); setNotice('Local research cleared.'); } catch { setInputError('Browser storage is unavailable.'); } }}>Clear local research</button></div>
      {inputError && <p role="alert" className="text-accent-red mt-2">{inputError}</p>}{notice && <p role="status" className="text-sm mt-2">{notice}</p>}
      {!revisions.length && <p className="text-sm mt-4">No dated research supplied. Earnings revisions, company guidance, operating metrics, and economic consensus surprises are unverified until sourced observations are imported.</p>}
      <div className="overflow-x-auto"><table className="w-full text-xs mt-3"><thead><tr>{['Symbol / metric', 'Kind / period', 'As of', 'Value', 'Prior observation', 'Revision'].map(h => <th key={h} className="text-left p-2">{h}</th>)}</tr></thead><tbody>
        {revisions.map(r => <tr key={[r.symbol, r.metric, r.kind, r.period, r.units].join(':')} className="border-t border-black/5"><td className="p-2">{r.symbol} · {r.metric}</td><td>{r.kind} · {r.period}</td><td><a className="text-accent-blue" href={r.source} target="_blank" rel="noreferrer">{r.asOf}</a>{Date.now() - Date.parse(r.asOf) > 100 * 86400000 ? ' · stale' : ''}</td><td>{fmt(r.value)} {r.units}</td><td>{fmt(r.previous)} ({r.previousAsOf ?? '—'})</td><td>{fmt(r.change)} {r.units}</td></tr>)}
      </tbody></table></div>
      <details className="mt-4 text-xs"><summary className="cursor-pointer text-accent-blue">Research file format</summary><p className="mt-2">Constituent weights are percentages of the fund (0–100). Use one snapshot date per fund and canonical ticker symbols. Dates must be YYYY-MM-DD, not in the future. Source must be an HTTP(S) URL. Observation kinds: estimate, guidance, operating, actual, consensus. Keep period and units identical when comparing estimates.</p><pre className="overflow-x-auto bg-black/5 p-3 rounded-lg mt-2">{`{
  "constituents": [
    {"fund":"VTI","symbol":"MSFT","weight":3.0,"asOf":"YYYY-MM-DD","source":"https://provider.example/holdings"}
  ],
  "observations": [
    {"symbol":"MSFT","metric":"EPS consensus","value":12.0,"units":"USD/share","period":"FY2027","kind":"estimate","asOf":"YYYY-MM-DD","source":"https://provider.example/estimates"}
  ]
}`}</pre><p>Schema illustration only; the numbers above are not actual fund holdings or analyst estimates. Replace them with verified data and valid dates.</p></details>
    </Card>
  </div>;
}
