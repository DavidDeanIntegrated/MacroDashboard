'use client';

// Risk & Scenarios — the "how would my portfolio actually behave" page.
// Same conventions as the rest of the site: a plain-English verdict up top, a
// "How to read this" explainer on every card, jargon wrapped in <Term>.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useApi, useFundamentalsScores } from '@/lib/hooks';
import { type HoldingsPortfolio } from '@/lib/holdings';
import { Card, CardTitle } from '@/components/ui/Card';
import { ErrorState, LoadingCard } from '@/components/ui/Loading';
import { Term, Explainer } from '@/components/ui/Term';
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
const fmt = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(2));
const inputClass = 'border border-black/20 rounded-lg px-3 py-2 bg-white text-sm';

const SCENARIO_PLAIN: Record<Scenario, string> = {
  'Demand recession': 'People and businesses stop spending: stocks fall broadly, speculative names fall hardest, gold and T-bills hold.',
  'Inflation resurgence': 'Prices re-accelerate and the Fed stays tight: growth stocks and long bonds hurt, commodities and gold help.',
  'Higher real yields': 'Interest rates rise faster than inflation: everything priced on future earnings gets marked down, gold included.',
  'Liquidity shock': 'A funding scare like March 2020: correlations go to one, the riskiest assets (crypto, small caps) fall the most.',
};

export default function RiskPage() {
  const { data, loading, error, refresh } = useApi<RiskData>('/api/risk', { timeoutMs: 120000 });
  const { data: macro } = useApi<{ assessment: EconomicAssessment }>('/api/fred?action=dashboard');
  const symbols = useMemo(() => (data?.portfolio.positions ?? []).filter((p) => p.symbol !== 'CASH').map((p) => p.symbol), [data]);
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
  const shocks = Object.fromEntries(positions.map((p) => [p.symbol, Math.max(-100, Math.min(300, (overrides[p.symbol] ?? defaults[p.symbol]) * severity))]));
  const stress = stressPortfolio(positions, shocks);
  const overlap = lookThrough(positions, research.constituents);
  const revisions = researchChanges(research.observations);
  const assessment = macro?.assessment;
  const top = data?.risk.contributions[0];
  const topRatio = top && top.weight > 0 ? top.varianceShare / top.weight : null;

  async function importResearch(file?: File) {
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error('Research file exceeds 5 MB.');
      const parsed = parseResearchInputs(JSON.parse(await file.text()));
      localStorage.setItem('macro-research-v1', JSON.stringify(parsed));
      setResearch(parsed); setInputError(null); setNotice(`Imported ${parsed.constituents.length} fund-holding rows and ${parsed.observations.length} research observations. Saved in this browser only.`);
    } catch (e) { setInputError(e instanceof Error ? e.message : 'Import failed.'); }
  }
  function exportResearch() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(research, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'macro-research.json'; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-black/85 tracking-tight">Risk &amp; Scenarios</h2>
        <p className="text-sm text-black/45 mt-1">How your portfolio actually behaves — not just whether it&apos;s inside its target bands</p>
      </div>

      <Card>
        <CardTitle>What this page tells you</CardTitle>
        <ul className="mt-3 space-y-2 text-sm text-black/60 leading-relaxed list-disc pl-5 max-w-3xl">
          <li><span className="font-medium text-black/75">Which holdings drive your swings.</span> Being 10% of your money doesn&apos;t mean being 10% of your risk — a volatile position can dominate.</li>
          <li><span className="font-medium text-black/75">What macro forces each holding responds to.</span> Measured from the last two years of prices, not from a label.</li>
          <li><span className="font-medium text-black/75">What a bad season would cost, in dollars.</span> Editable what-ifs for a recession, an inflation flare-up, higher real rates, and a liquidity scare.</li>
        </ul>
        <p className="text-xs text-black/40 mt-3 max-w-3xl">
          Everything here is measured from history or stated as an explicit assumption — it is not a prediction. The Holdings page answers &quot;am I on plan?&quot;; this page answers &quot;what happens to the plan if the economy turns?&quot; <Link href="/macro" className="text-accent-blue font-medium">See the economic evidence →</Link>
        </p>
      </Card>

      {loading && <LoadingCard />}
      {error && <ErrorState message={error} onRetry={refresh} />}

      {data && !error && (
        <>
          <Card>
            <CardTitle>The short version</CardTitle>
            <p className="mt-2 text-sm text-black/65 leading-relaxed max-w-3xl">{assessment?.description ?? 'The economic assessment is still loading.'}</p>
            <p className="mt-2 text-sm text-black/65 leading-relaxed max-w-3xl">
              {top
                ? <>Your biggest source of day-to-day swings is <span className="font-medium text-black/80">{top.symbol}</span>: it is {fmt(top.weight)}% of your money but {fmt(top.varianceShare)}% of your portfolio&apos;s variance{topRatio !== null && topRatio > 1.5 ? ` — about ${topRatio.toFixed(1)}× its weight` : ''}.</>
                : 'The full-portfolio risk figure is unavailable because at least one holding has too little price history (see below) — no estimate is made up to fill the gap.'}
            </p>
            <p className="mt-2 text-xs text-black/40">Quantities as of {data.portfolio.holdingsAsOf} · prices fetched {new Date(data.portfolio.valuationAsOf).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.</p>
          </Card>

          <Card>
            <CardTitle>Which holdings drive your risk</CardTitle>
            <p className="text-sm text-black/55 mt-1">
              Each holding&apos;s <Term k="variance-share">share of variance</Term> next to its share of your money. {data.risk.status}. Annualized price <Term k="volatility">volatility</Term> of the whole portfolio: <span className="font-medium text-black/75">{fmt(data.risk.annualizedVolatility)}%</span>.
            </p>
            <Explainer title="How to read this">
              <p>Share of variance answers &quot;if the portfolio had a rough day, whose fault was it?&quot; It sums to 100% across holdings. Compare the two columns: a holding whose variance share is well above its capital weight is punching above its size; one below is a calming influence. A negative share means the holding has historically moved <em>against</em> the rest — a hedge.</p>
              <p>Measured over {data.risk.observations} trading days ({data.risk.start ?? '—'} to {data.risk.end ?? '—'}) on which every holding had a price, using today&apos;s weights held constant. Price moves only — dividends and T-bill interest are excluded, so SGOV looks like dead weight here even though it earns.</p>
              {data.risk.excluded.length > 0 && <p>Not enough history for: {data.risk.excluded.join(', ')} ({fmt(data.risk.coveredWeight)}% of the portfolio is covered). Rather than pretend, the full-portfolio number is withheld until every holding has at least 60 shared days.</p>}
            </Explainer>
            <div className="overflow-x-auto">
              <table className="w-full text-sm mt-3">
                <thead><tr className="text-xs text-black/45"><th className="text-left p-2 font-medium">Holding</th><th className="p-2 font-medium">Share of your money</th><th className="p-2 font-medium">Share of the swings</th></tr></thead>
                <tbody>
                  {data.risk.contributions.map((p) => (
                    <tr key={p.symbol} className="border-t border-black/5">
                      <td className="p-2 font-medium text-black/75">{p.symbol}</td>
                      <td className="text-center tabular-nums">{fmt(p.weight)}%</td>
                      <td className={`text-center tabular-nums ${p.varianceShare > p.weight * 1.5 ? 'text-accent-orange font-medium' : p.varianceShare < 0 ? 'text-accent-green' : ''}`}>{fmt(p.varianceShare)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.errors.length > 0 && <p role="status" className="text-xs text-accent-orange mt-2">{data.errors.join('; ')}</p>}
          </Card>

          <Card>
            <CardTitle>What moves each holding</CardTitle>
            <p className="text-sm text-black/55 mt-1">
              A <Term k="factor-beta">beta</Term> for each holding against four outside forces: the stock market, the 10-year real yield, the dollar, and credit stress.
            </p>
            <Explainer title="How to read this">
              <p>A market beta of 1.2 means: on days the S&amp;P 500 rose 1%, this holding rose about 1.2% on average. For the yield and credit-spread columns the unit is &quot;percent move per 1 percentage-point change&quot; — so a real-yield beta of −3 means the holding fell about 3% for every 1-point jump in real yields.</p>
              <p>Three honesty checks sit under each number: the <Term k="standard-error">± range</Term> (how sure the estimate is — if ± is bigger than the number, don&apos;t lean on it), <Term k="r-squared">R²</Term> (how much of the holding&apos;s moves that one force explains, 0 to 1), and <em>n</em> (how many days went into it).</p>
              <p>Each column is measured separately, so the four betas overlap and must not be added together. Use them to see <em>which</em> force matters for a holding, not to build a combined forecast.</p>
            </Explainer>
            <div className="overflow-x-auto">
              <table className="w-full text-xs mt-3">
                <thead><tr className="text-black/45"><th className="text-left p-2 font-medium">Holding</th>{data.sensitivities[0]?.factors.map((f) => <th key={f.key} className="p-2 font-medium">{f.name}</th>)}</tr></thead>
                <tbody>
                  {data.sensitivities.map((p) => (
                    <tr key={p.symbol} className="border-t border-black/5">
                      <td className="p-2 font-medium text-black/75">{p.symbol}</td>
                      {p.factors.map((f) => (
                        <td key={f.key} className="p-2 text-center whitespace-nowrap">
                          {f.beta === null ? <span className="text-black/35">not enough data</span> : <span className={`tabular-nums ${(f.rSquared ?? 0) < 0.2 ? 'text-black/45' : 'text-black/80 font-medium'}`}>{fmt(f.beta)} ± {fmt((f.standardError ?? 0) * 1.96)}</span>}
                          <p className="text-black/40 tabular-nums">R² {fmt(f.rSquared)} · n={f.observations}</p>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-black/35 mt-2">Faded numbers have R² below 0.2 — the force is a minor influence on that holding even if the beta looks large.</p>
          </Card>

          <Card>
            <CardTitle>What a bad season would cost</CardTitle>
            <p className="text-sm text-black/55 mt-1">
              A <Term k="stress-test">stress test</Term>: apply an assumed shock to every holding at once and add up the dollars, using today&apos;s actual weights.
            </p>
            <Explainer title="How to read this">
              <p>Pick a scenario and the table fills in a default shock per holding by asset type (broad market −25% in a recession, conviction bets −50%, gold +10%, T-bills flat, and so on). Those defaults are illustrative starting points, not measured probabilities — edit any cell to your own view. The severity slider scales every shock at once: 0.5× for a mild version, 1.5× for a harsh one.</p>
              <p>&quot;Portfolio impact (pp)&quot; is each holding&apos;s contribution in percentage points of the whole portfolio; the big number at the top is their sum. Losses are capped at 100% per position; income, taxes, and inflation are ignored.</p>
            </Explainer>
            <div className="flex gap-4 flex-wrap items-center my-4">
              <label className="text-sm text-black/65">Scenario <select className={`${inputClass} ml-1`} value={scenario} onChange={(e) => { setScenario(e.target.value as Scenario); setOverrides({}); }}>{SCENARIOS.map((s) => <option key={s}>{s}</option>)}</select></label>
              <label className="text-sm text-black/65">Severity {severity.toFixed(2)}× <input aria-label="Scenario severity" className="ml-1 align-middle" type="range" min="0.5" max="1.5" step="0.05" value={severity} onChange={(e) => setSeverity(Number(e.target.value))} /></label>
            </div>
            <p className="text-xs text-black/50 -mt-2 mb-3 max-w-3xl">{SCENARIO_PLAIN[scenario]}</p>
            <p className="text-xl font-semibold text-black/85 tabular-nums">Portfolio impact: {fmt(stress.percent)}% · {formatCurrency(stress.dollars)}</p>
            <div className="overflow-x-auto">
              <table className="w-full mt-3 text-sm">
                <thead><tr className="text-xs text-black/45"><th className="text-left p-2 font-medium">Holding</th><th className="p-2 font-medium">Assumed shock %</th><th className="p-2 font-medium">After severity</th><th className="p-2 font-medium">Portfolio impact (pp)</th></tr></thead>
                <tbody>
                  {positions.map((p) => (
                    <tr key={p.symbol} className="border-t border-black/5">
                      <td className="p-2 font-medium text-black/75">{p.symbol}</td>
                      <td className="text-center"><input aria-label={`${p.symbol} base shock percent`} className={`${inputClass} w-24 text-center`} type="number" min="-100" max="200" value={overrides[p.symbol] ?? defaults[p.symbol]} onChange={(e) => { const value = Number(e.target.value); if (Number.isFinite(value)) setOverrides((o) => ({ ...o, [p.symbol]: Math.max(-100, Math.min(200, value)) })); }} /></td>
                      <td className="text-center tabular-nums">{fmt(shocks[p.symbol])}%</td>
                      <td className="text-center tabular-nums">{fmt(stress.rows.find((r) => r.symbol === p.symbol)?.contribution)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardTitle>Overlap between your funds and your stocks</CardTitle>
            <p className="text-sm text-black/55 mt-1">
              <Term k="look-through">Look-through</Term> exposure: what you own directly plus what you own through VTI, VTV, and VXUS.
            </p>
            <Explainer title="How to read this">
              <p>If you hold MSFT outright <em>and</em> VTI holds MSFT, you own more Microsoft than the positions table suggests. This card adds the two up — but only when you&apos;ve imported a dated holdings snapshot for each fund (see the research card at the bottom). Without one, the fund&apos;s slice is listed as &quot;unresolved&quot; rather than guessed. Snapshots older than 100 days are treated as unknown.</p>
            </Explainer>
            <div className="overflow-x-auto">
              <table className="w-full mt-3 text-sm">
                <thead><tr className="text-xs text-black/45"><th className="text-left p-2 font-medium">Company / asset</th><th className="p-2 font-medium">Held directly %</th><th className="p-2 font-medium">Through funds %</th><th className="p-2 font-medium">Combined %</th></tr></thead>
                <tbody>
                  {overlap.exposures.map((e) => (
                    <tr key={e.symbol} className="border-t border-black/5">
                      <td className="p-2 font-medium text-black/75">{e.symbol}{e.funds.length > 0 && <span className="text-xs text-black/40 font-normal"> · via {e.funds.join(', ')}</span>}</td>
                      <td className="text-center tabular-nums">{fmt(e.direct)}</td><td className="text-center tabular-nums">{fmt(e.indirect)}</td><td className="text-center tabular-nums">{fmt(e.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {overlap.uncovered.map((e) => <p className="text-xs text-accent-orange mt-1" key={e.fund}>{e.fund}: {fmt(e.portfolioWeight)}% of the portfolio unresolved — {e.reason.toLowerCase()}.</p>)}
          </Card>
        </>
      )}

      <Card>
        <CardTitle>Business quality vs. macro exposure</CardTitle>
        <p className="text-sm text-black/55 mt-1 max-w-3xl">Two different questions for each individual stock: is it a good business (from its filings), and what macro force is it exposed to (from its sector)? A strong company can still be the wrong holding for the season, and vice versa.</p>
        {fundamentalsError && <p role="status" className="text-xs text-accent-orange mt-2">{fundamentalsError}</p>}
        <div className="grid md:grid-cols-2 gap-3 mt-4">
          {(data?.portfolio.positions ?? []).filter((h) => !['Gold', 'Commodity', 'Dry Powder', 'Crypto', 'Broad Market', 'Value', 'International'].includes(h.category)).map((h) => {
            const score = fundamentals?.find((f) => f.symbol === h.symbol && !f.unavailable);
            const b = score?.breakdown;
            return (
              <div key={h.symbol} className="p-4 rounded-xl bg-black/[.03]">
                <Link className="text-accent-blue font-medium" href={`/ticker?symbol=${h.symbol}`}>{h.symbol}</Link>
                <p className="text-xs text-black/60 mt-2 leading-relaxed">{macroSensitivity(h.symbol, h.category).note}</p>
                <p className="text-xs text-black/60 mt-2 tabular-nums">Revenue growth {fmt(b?.growthDetail.revenueGrowth)}% · net margin {fmt(b?.profitabilityDetail.netMargin)}% · debt/equity {fmt(b?.healthDetail.debtToEquity)} · cash/debt {fmt(b?.healthDetail.cashToDebt)}</p>
                <p className="text-[11px] text-black/40 mt-2">Latest filing {b?.meta.dataAsOf ?? 'unavailable'} · {fmt(b?.meta.coveragePct)}% of metrics reported.</p>
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardTitle>Your research notes</CardTitle>
        <p className="text-sm text-black/55 mt-1 max-w-3xl">Things the market feeds don&apos;t supply — analyst estimate changes, company guidance, fund holdings — can be imported as a small JSON file. They stay in this browser only, and each row must carry a date and a source link so you always know how old a number is.</p>
        <Explainer title="Why this exists, and the file format">
          <p>Fund-holding snapshots power the overlap card above. Estimate and guidance rows are compared to the previous row for the <em>same</em> company, metric, fiscal period, and units, so a &quot;revision&quot; is always like-for-like; if there is no earlier row, the revision shows as — rather than 0.</p>
          <pre className="overflow-x-auto bg-black/5 p-3 rounded-lg mt-2 text-[11px]">{`{
  "constituents": [
    {"fund":"VTI","symbol":"MSFT","weight":3.0,"asOf":"YYYY-MM-DD","source":"https://provider.example/holdings"}
  ],
  "observations": [
    {"symbol":"MSFT","metric":"EPS consensus","value":12.0,"units":"USD/share","period":"FY2027","kind":"estimate","asOf":"YYYY-MM-DD","source":"https://provider.example/estimates"}
  ]
}`}</pre>
          <p>Weights are percent of the fund (0–100), one snapshot date per fund. Dates are YYYY-MM-DD and can&apos;t be in the future; sources must be http(s) links. Kinds: estimate, guidance, operating, actual, consensus. The numbers above are placeholders, not real data.</p>
        </Explainer>
        <div className="flex gap-3 flex-wrap mt-4">
          <label className={inputClass}>Import research JSON <input className="block mt-1" type="file" accept="application/json,.json" onChange={(e) => { void importResearch(e.target.files?.[0]); e.target.value = ''; }} /></label>
          <button className={inputClass} onClick={exportResearch}>Export research</button>
          <button className={inputClass} onClick={() => { try { localStorage.removeItem('macro-research-v1'); setResearch(emptyResearch); setNotice('Local research cleared.'); } catch { setInputError('Browser storage is unavailable.'); } }}>Clear local research</button>
        </div>
        {inputError && <p role="alert" className="text-sm text-accent-red mt-2">{inputError}</p>}
        {notice && <p role="status" className="text-sm text-black/60 mt-2">{notice}</p>}
        {!revisions.length && <p className="text-sm text-black/45 mt-4">No research imported yet — the overlap card and revision table stay empty until you add some.</p>}
        {revisions.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs mt-3">
              <thead><tr className="text-black/45">{['Company · metric', 'Kind · period', 'As of', 'Value', 'Previous', 'Revision'].map((h) => <th key={h} className="text-left p-2 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {revisions.map((r) => (
                  <tr key={[r.symbol, r.metric, r.kind, r.period, r.units].join(':')} className="border-t border-black/5">
                    <td className="p-2">{r.symbol} · {r.metric}</td><td>{r.kind} · {r.period}</td>
                    <td><a className="text-accent-blue" href={r.source} target="_blank" rel="noreferrer">{r.asOf}</a>{Date.now() - Date.parse(r.asOf) > 100 * 86400000 ? ' · stale' : ''}</td>
                    <td className="tabular-nums">{fmt(r.value)} {r.units}</td><td className="tabular-nums">{fmt(r.previous)} ({r.previousAsOf ?? '—'})</td><td className="tabular-nums">{fmt(r.change)} {r.units}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
