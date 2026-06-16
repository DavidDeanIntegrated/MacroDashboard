'use client';

import { useState, Fragment } from 'react';
import { Card, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { AllocationPieChart } from '@/components/charts/AllocationPieChart';
import { formatCurrency } from '@/lib/format';
import type { HoldingPosition } from '@/lib/holdings';
import { computeSleeveData, getSleeveStatus, regimeAdjustedBand, type SleeveStatus, type RegimeKey } from '@/lib/sleeves';
import { macroSensitivity } from '@/lib/macro-sensitivity';

export interface FundamentalsScoreLite {
  symbol: string;
  total: number;
  grade: string;
  gradeColor?: string;
  unavailable?: boolean;
}

// ─── Sub-Sleeve Definitions ───

interface SubSleeveTarget {
  label: string;
  symbols: string[];
  targetMin: number;
  targetMax: number;
  priority: string;
}

const SUB_SLEEVE_TARGETS: SubSleeveTarget[] = [
  { label: 'VTI (Broad US Core)', symbols: ['VTI'], targetMin: 20, targetMax: 22, priority: 'Buy first' },
  { label: 'VTV (Value)', symbols: ['VTV'], targetMin: 7, targetMax: 9, priority: 'Buy if under' },
  { label: 'VXUS (International)', symbols: ['VXUS'], targetMin: 5.5, targetMax: 6.5, priority: 'Hold / Buy if under' },
  { label: 'Quality Compounders', symbols: ['NVDA', 'TSM', 'MSFT', 'PLTR'], targetMin: 14, targetMax: 16, priority: 'Sell if >17%, Buy if <13%' },
  { label: 'High Conviction', symbols: ['RKLB', 'RVI', 'SPCX'], targetMin: 0, targetMax: 6.5, priority: 'Sell first if over' },
];

// ─── Helpers ───

function computeSubSleeveData(positions: HoldingPosition[]) {
  return SUB_SLEEVE_TARGETS.map((sub) => {
    const subPositions = positions
      .filter((p) => sub.symbols.includes(p.symbol))
      .sort((a, b) => b.marketValue - a.marketValue);
    const weight = subPositions.reduce((sum, p) => sum + p.weight, 0);
    const value = subPositions.reduce((sum, p) => sum + p.marketValue, 0);
    const dayChange = subPositions.reduce((sum, p) => sum + p.dayChange, 0);
    const prevValue = value - dayChange;
    const dayChangePercent = prevValue > 0 ? (dayChange / prevValue) * 100 : 0;
    return { ...sub, weight, value, dayChange, dayChangePercent, members: subPositions };
  });
}

function statusBadge(status: SleeveStatus) {
  if (status === 'in-range') return <Badge variant="green">In Range</Badge>;
  if (status === 'over') return <Badge variant="orange">Over</Badge>;
  return <Badge variant="blue">Under</Badge>;
}

function gradeBadge(grade: string): 'green' | 'orange' | 'red' | 'neutral' {
  if (grade === 'Strong Buy' || grade === 'Buy') return 'green';
  if (grade === 'Hold') return 'neutral';
  if (grade === 'Weak') return 'orange';
  return 'red';
}

// ─── Collapsible Section ───

function CollapsibleSection({
  title,
  subtitle,
  children,
  defaultOpen = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Card>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-left"
      >
        <div>
          <CardTitle>{title}</CardTitle>
          {subtitle && <p className="text-xs text-black/40 mt-1">{subtitle}</p>}
        </div>
        <svg
          className={`w-5 h-5 text-black/30 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>
      {open && <div className="mt-5">{children}</div>}
    </Card>
  );
}

// ─── Horizontal Bar Comparison ───

function SleeveComparisonBars({
  sleeves,
  regimeKey = 'unknown',
}: {
  sleeves: ReturnType<typeof computeSleeveData>;
  regimeKey?: RegimeKey;
}) {
  return (
    <div className="space-y-4">
      {sleeves.map((sleeve) => {
        const status = getSleeveStatus(sleeve.weight, sleeve.targetMin, sleeve.targetMax);
        const maxBar = 70; // max percentage width
        const adj = regimeAdjustedBand(sleeve.name, sleeve.targetMin, sleeve.targetMax, regimeKey);
        return (
          <div key={sleeve.name}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: sleeve.color }} />
                <span className="text-sm font-medium text-black/75">{sleeve.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm tabular-nums text-black/55">{sleeve.weight.toFixed(1)}%</span>
                {statusBadge(status)}
              </div>
            </div>
            <div className="relative h-6 bg-black/[0.03] rounded-lg overflow-hidden">
              {/* Target range overlay */}
              <div
                className="absolute top-0 bottom-0 rounded-lg"
                style={{
                  left: `${(sleeve.targetMin / maxBar) * 100}%`,
                  width: `${((sleeve.targetMax - sleeve.targetMin) / maxBar) * 100}%`,
                  backgroundColor: sleeve.color,
                  opacity: 0.12,
                }}
              />
              {/* Target range boundary markers */}
              <div
                className="absolute top-0 bottom-0 w-px"
                style={{
                  left: `${(sleeve.targetMin / maxBar) * 100}%`,
                  backgroundColor: sleeve.color,
                  opacity: 0.3,
                }}
              />
              <div
                className="absolute top-0 bottom-0 w-px"
                style={{
                  left: `${(sleeve.targetMax / maxBar) * 100}%`,
                  backgroundColor: sleeve.color,
                  opacity: 0.3,
                }}
              />
              {/* Current value bar */}
              <div
                className="absolute top-1 bottom-1 rounded-md transition-all duration-500"
                style={{
                  width: `${(sleeve.weight / maxBar) * 100}%`,
                  backgroundColor: sleeve.color,
                  opacity: 0.8,
                }}
              />
              {/* Target range labels */}
              <span
                className="absolute top-1/2 -translate-y-1/2 text-[10px] text-black/30 tabular-nums"
                style={{ left: `${(sleeve.targetMin / maxBar) * 100 + 0.5}%` }}
              >
                {sleeve.targetMin}%
              </span>
              <span
                className="absolute top-1/2 -translate-y-1/2 text-[10px] text-black/30 tabular-nums"
                style={{ left: `${(sleeve.targetMax / maxBar) * 100 + 0.5}%` }}
              >
                {sleeve.targetMax}%
              </span>
              {/* Regime-adjusted target band — dashed boundary markers */}
              {adj.delta !== 0 && (
                <>
                  <div className="absolute top-0 bottom-0 border-l border-dashed" style={{ left: `${(adj.min / maxBar) * 100}%`, borderColor: sleeve.color, opacity: 0.65 }} />
                  <div className="absolute top-0 bottom-0 border-l border-dashed" style={{ left: `${(adj.max / maxBar) * 100}%`, borderColor: sleeve.color, opacity: 0.65 }} />
                </>
              )}
            </div>
            {adj.delta !== 0 && (
              <p className="text-[11px] text-black/40 mt-1">
                <span className="inline-block w-3 border-t border-dashed align-middle mr-1" style={{ borderColor: sleeve.color }} />
                Regime-adjusted target {adj.min.toFixed(0)}–{adj.max.toFixed(0)}%
                <span className={adj.delta > 0 ? 'text-accent-green' : 'text-accent-red'}> ({adj.delta > 0 ? '▲ +' : '▼ '}{adj.delta}pp)</span>
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Holding Rationale Cards ───

const HOLDING_RATIONALES: { symbol: string; title: string; rationale: string }[] = [
  { symbol: 'GLD', title: 'Gold — Safest Money in a Devaluation Cycle', rationale: 'Dalio\'s "safest money" in high-debt/devaluation cycles. $38T US debt, central bank buying, and de-dollarization tailwinds. Target: 10–15% of portfolio.' },
  { symbol: 'BCI', title: 'Commodities — Buy Stuff That Beats Inflation', rationale: 'Broadest commodity exposure (Bloomberg Commodity Index). Purest expression of Dalio\'s "buy stuff that beats inflation" principle. No K-1 tax complexity, 0.26% ER.' },
  { symbol: 'VTI', title: 'Broad US Core — The Growth Engine Anchor', rationale: 'Total US stock market index. Anchor of the equities sleeve — provides broad, low-cost exposure to the full US market as the first buy priority in every rebalance.' },
  { symbol: 'VTV', title: 'Value Tilt — Margin of Safety', rationale: 'Value stocks historically outperform in inflationary periods and provide a margin of safety through lower valuations and higher dividend yields.' },
  { symbol: 'VXUS', title: 'International — Against US Survivorship Bias', rationale: 'International diversification hedges against US exceptionalism fading. Vanguard projects 4.9–6.9% annual returns for non-US equities next decade.' },
  { symbol: 'SGOV', title: 'Dry Powder — Tactical Cash Earning Yield', rationale: '0–3 month T-bill ETF earning ~4.5–5% yield. Tactical, not permanent — deploy on dips per the drawdown ladder. Never let this fall below ~$150 (emergency floor).' },
  { symbol: 'NVDA+TSM+MSFT+PLTR', title: 'Quality Compounders — Secular Growth at Scale', rationale: 'NVDA (AI compute monopoly), TSM (foundry monopoly), MSFT (enterprise cloud + AI), and PLTR (AI/data analytics platform with government + commercial adoption). Quality compounders with durable moats. Combined 14–16% target — sell above 17%, buy below 13%.' },
  { symbol: 'RKLB+RVI+SPCX', title: 'High Conviction — Asymmetric Bets', rationale: 'RKLB (space launch + satellite bus) alongside RVI and SPCX — asymmetric, high-volatility bets held as hold-and-dilute positions. Never bought during rebalancing; only add with new money on 20%+ dips from cost basis, capped at ~6.5% combined.' },
  { symbol: 'BTC', title: 'Bitcoin — Digital Hard-Money Complement', rationale: 'Modern hard-asset hedge complementing gold. Combined with GLD forms the "real money" allocation. Will dilute naturally toward 8–12% target as the portfolio grows — no forced rebalance needed.' },
];

// ─── Drawdown Ladder ───

const DRAWDOWN_LADDER = [
  { trigger: 'SPY –10%', triggerDetail: 'from rolling 3-month high', action: 'Buy VTI (broad US core)', amount: '~$180' },
  { trigger: 'SPY –15%', triggerDetail: 'from rolling 3-month high', action: 'Buy Quality Compounders — equal split across NVDA/TSM/MSFT/PLTR', amount: '~$180' },
  { trigger: 'SPY –25%+ or VIX >40', triggerDetail: '', action: 'Aggressive — VTI + VXUS + high-conviction on sale', amount: '~$247 (remaining)' },
];

// ─── Main Component ───

// ─── Rebalance Simulator ───

function RebalanceSimulator({
  sleeves,
  portfolioValue,
}: {
  sleeves: ReturnType<typeof computeSleeveData>;
  portfolioValue: number;
}) {
  const [deltas, setDeltas] = useState<Record<string, number>>({});
  const netCash = Object.values(deltas).reduce((s, v) => s + (v || 0), 0);
  const projTotal = portfolioValue + netCash;
  const anyChange = Object.values(deltas).some((v) => v);

  return (
    <Card>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <CardTitle>Rebalance Simulator</CardTitle>
          <p className="text-xs text-black/40 mt-1">Model buys (+) and sells (−) per sleeve and preview the resulting weights vs target</p>
        </div>
        {anyChange && (
          <button onClick={() => setDeltas({})} className="text-xs font-medium text-accent-blue hover:text-accent-blue/80">Reset</button>
        )}
      </div>

      <div className="mt-4 space-y-2.5">
        {sleeves.map((s) => {
          const delta = deltas[s.name] || 0;
          const projValue = s.value + delta;
          const curWeight = portfolioValue > 0 ? (s.value / portfolioValue) * 100 : 0;
          const projWeight = projTotal > 0 ? (projValue / projTotal) * 100 : 0;
          const status = getSleeveStatus(projWeight, s.targetMin, s.targetMax);
          return (
            <div key={s.name} className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 w-32 shrink-0">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                <span className="text-sm font-medium text-black/75">{s.name}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-black/40 text-sm">$</span>
                <input
                  type="number"
                  step={50}
                  value={delta || ''}
                  placeholder="0"
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setDeltas((d) => ({ ...d, [s.name]: Number.isFinite(v) ? v : 0 }));
                  }}
                  className="w-24 px-2 py-1 text-sm tabular-nums rounded-lg border border-black/[0.08] focus:border-accent-blue focus:outline-none"
                />
              </div>
              <div className="text-sm tabular-nums text-black/60">
                {curWeight.toFixed(1)}% <span className="text-black/30">→</span>{' '}
                <span className="font-semibold text-black/85">{projWeight.toFixed(1)}%</span>
                <span className="text-black/35"> / {s.targetMin}–{s.targetMax}%</span>
              </div>
              {statusBadge(status)}
            </div>
          );
        })}
      </div>

      <div className="mt-4 pt-3 border-t border-black/[0.06] text-xs text-black/50 flex flex-wrap gap-x-4 gap-y-1">
        <span>
          Net cash:{' '}
          <span className={`font-medium ${netCash === 0 ? 'text-black/60' : netCash > 0 ? 'text-accent-green' : 'text-accent-red'}`}>
            {netCash >= 0 ? '+' : ''}{formatCurrency(netCash)}
          </span>{' '}
          ({netCash === 0 ? 'pure rebalance' : netCash > 0 ? 'new contribution' : 'withdrawal'})
        </span>
        <span>Projected total: <span className="font-medium text-black/70">{formatCurrency(projTotal)}</span></span>
      </div>
    </Card>
  );
}

export function AllWeatherSection({
  positions,
  portfolioValue,
  regimeKey = 'unknown',
  scores,
}: {
  positions: HoldingPosition[];
  portfolioValue: number;
  regimeKey?: RegimeKey;
  scores?: FundamentalsScoreLite[];
}) {
  const sleeves = computeSleeveData(positions);
  const subSleeves = computeSubSleeveData(positions);
  const [expandedSubSleeve, setExpandedSubSleeve] = useState<string | null>('Quality Compounders');
  const scoreBySymbol = new Map((scores ?? []).map((s) => [s.symbol, s]));

  return (
    <>
      {/* Section Header */}
      <div className="pt-4 border-t border-black/[0.06]">
        <h2 className="text-2xl font-semibold text-black/85 tracking-tight">All-Weather Strategy</h2>
        <p className="text-sm text-black/45 mt-1">
          Modified Dalio framework — how your portfolio maps to the four economic sleeves
        </p>
      </div>

      {/* ─── Sleeve Allocation Overview ─── */}
      <Card>
        <CardTitle>Sleeve Allocation — Current vs Target</CardTitle>
        <p className="text-xs text-black/40 mt-1">
          Four sleeves designed to perform across all economic seasons: growth, inflation, deflation, and contraction
        </p>
        <div className="mt-6 flex flex-col lg:flex-row gap-8">
          {/* Donut chart */}
          <div className="lg:w-2/5">
            <AllocationPieChart
              data={sleeves.map((s) => ({
                name: s.name,
                value: s.weight,
                color: s.color,
              }))}
              height={240}
              centerLabel={formatCurrency(portfolioValue)}
              centerSublabel="Total Value"
            />
          </div>
          {/* Horizontal bar comparison */}
          <div className="lg:w-3/5">
            <SleeveComparisonBars sleeves={sleeves} regimeKey={regimeKey} />
          </div>
        </div>
      </Card>

      {/* ─── Sub-Sleeve Equity Breakdown ─── */}
      <Card padding="none">
        <div className="px-6 pt-6 pb-3">
          <CardTitle>Equity Sub-Sleeve Breakdown</CardTitle>
          <p className="text-xs text-black/40 mt-1">Internal balance within the 55–60% equities allocation · click a row to see its holdings</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="border-b border-black/[0.06]">
                <th className="px-4 py-3 text-left text-xs font-medium text-black/40 uppercase tracking-wider w-8" />
                {['Sub-Sleeve', 'Holdings', 'Current', 'Target', 'Day', 'Status', 'Priority'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-black/40 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {subSleeves.map((sub) => {
                const status = getSleeveStatus(sub.weight, sub.targetMin, sub.targetMax);
                const isOpen = expandedSubSleeve === sub.label;
                const isExpandable = sub.members.length > 0;
                return (
                  <Fragment key={sub.label}>
                    <tr
                      onClick={() => isExpandable && setExpandedSubSleeve(isOpen ? null : sub.label)}
                      className={`border-b border-black/[0.03] transition-colors ${
                        isExpandable ? 'cursor-pointer hover:bg-black/[0.02]' : ''
                      } ${isOpen ? 'bg-accent-blue/[0.03]' : ''}`}
                    >
                      <td className="px-4 py-3">
                        {isExpandable && (
                          <svg
                            className={`w-4 h-4 text-black/30 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
                            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                          </svg>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm font-medium text-black/75">{sub.label}</td>
                      <td className="px-4 py-3 text-xs text-black/50">{sub.members.length || sub.symbols.length} {(sub.members.length || sub.symbols.length) === 1 ? 'name' : 'names'}</td>
                      <td className="px-4 py-3 text-sm tabular-nums text-black/75">{sub.weight.toFixed(1)}%</td>
                      <td className="px-4 py-3 text-sm tabular-nums text-black/50">{sub.targetMin}–{sub.targetMax}%</td>
                      <td className={`px-4 py-3 text-sm tabular-nums ${sub.dayChangePercent >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                        {sub.dayChangePercent >= 0 ? '+' : ''}{sub.dayChangePercent.toFixed(2)}%
                      </td>
                      <td className="px-4 py-3">{statusBadge(status)}</td>
                      <td className="px-4 py-3 text-xs text-black/45">{sub.priority}</td>
                    </tr>
                    {isOpen && isExpandable && (
                      <tr className="bg-black/[0.015]">
                        <td colSpan={8} className="px-4 pt-1 pb-4">
                          <div className="pl-8 pr-2 space-y-1.5">
                            {sub.members.map((m) => {
                              const shareOfSleeve = sub.value > 0 ? (m.marketValue / sub.value) * 100 : 0;
                              const macro = macroSensitivity(m.symbol, m.category);
                              const score = scoreBySymbol.get(m.symbol);
                              const distFromCost = m.costBasis && m.costBasis > 0
                                ? ((m.currentPrice - m.costBasis) / m.costBasis) * 100
                                : null;
                              const dipBuy = distFromCost != null && sub.label === 'High Conviction' && distFromCost <= -20;
                              return (
                                <div key={m.symbol} className="py-2 border-b border-black/[0.03] last:border-0">
                                  <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-semibold text-black/80 w-12">{m.symbol}</span>
                                      <Badge variant={macro.badge}>{macro.driver}</Badge>
                                      {score && !score.unavailable && (
                                        <Badge variant={gradeBadge(score.grade)}>{score.grade} · {score.total}</Badge>
                                      )}
                                    </div>
                                    <div className="flex items-center gap-4 text-right">
                                      <div className="w-20">
                                        <p className="text-[10px] uppercase tracking-wider text-black/35">Value</p>
                                        <p className="text-sm tabular-nums text-black/75">{formatCurrency(m.marketValue)}</p>
                                      </div>
                                      <div className="w-14">
                                        <p className="text-[10px] uppercase tracking-wider text-black/35">Port wt</p>
                                        <p className="text-sm tabular-nums text-black/75">{m.weight.toFixed(1)}%</p>
                                      </div>
                                      <div className="w-14">
                                        <p className="text-[10px] uppercase tracking-wider text-black/35">Day</p>
                                        <p className={`text-sm tabular-nums font-medium ${m.dayChangePercent >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                                          {m.dayChangePercent >= 0 ? '+' : ''}{m.dayChangePercent.toFixed(1)}%
                                        </p>
                                      </div>
                                      <div className="w-16">
                                        <p className="text-[10px] uppercase tracking-wider text-black/35">vs Cost</p>
                                        <p className={`text-sm tabular-nums font-medium ${
                                          distFromCost == null ? 'text-black/30' : distFromCost >= 0 ? 'text-accent-green' : 'text-accent-red'
                                        }`}>
                                          {distFromCost == null ? '—' : `${distFromCost >= 0 ? '+' : ''}${distFromCost.toFixed(1)}%`}
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                  {/* share-of-sleeve bar */}
                                  <div className="h-4 bg-black/[0.04] rounded-md overflow-hidden relative">
                                    <div className="absolute inset-y-0 left-0 rounded-md bg-accent-blue/25" style={{ width: `${Math.min(shareOfSleeve, 100)}%` }} />
                                    <span className="absolute inset-0 flex items-center pl-2 text-[10px] font-medium text-black/50 tabular-nums">
                                      {shareOfSleeve.toFixed(0)}% of sleeve
                                    </span>
                                  </div>
                                  {dipBuy && (
                                    <p className="text-[11px] text-accent-green mt-1">
                                      ▼ {distFromCost!.toFixed(0)}% from cost basis — meets the 20%-dip rule for a high-conviction add (new money only).
                                    </p>
                                  )}
                                </div>
                              );
                            })}
                            <p className="text-[11px] text-black/35 pt-1.5">
                              {sub.label} target {sub.targetMin}–{sub.targetMax}% · currently {sub.weight.toFixed(1)}% ({formatCurrency(sub.value)}) · {sub.priority}
                            </p>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ─── Rebalance Simulator ─── */}
      <RebalanceSimulator sleeves={sleeves} portfolioValue={portfolioValue} />

      {/* ─── Investment Thesis ─── */}
      <CollapsibleSection
        title="Investment Thesis — Modified All-Weather"
        subtitle="How this portfolio departs from Dalio's classic allocation and why"
      >
        <div className="space-y-5">
          {/* Classic vs Modified comparison */}
          <div className="p-4 bg-black/[0.02] rounded-xl">
            <p className="text-xs font-semibold text-black/50 uppercase tracking-wider mb-3">Classic Dalio All-Weather</p>
            <div className="grid grid-cols-5 gap-3">
              {[
                { label: 'Stocks', pct: '30%', color: '#007AFF' },
                { label: 'Long Bonds', pct: '40%', color: '#8E8E93' },
                { label: 'Int. Bonds', pct: '15%', color: '#8E8E93' },
                { label: 'Gold', pct: '7.5%', color: '#E6A700' },
                { label: 'Commodities', pct: '7.5%', color: '#FF9500' },
              ].map((item) => (
                <div key={item.label} className="text-center">
                  <div className="text-lg font-semibold tabular-nums" style={{ color: item.color }}>{item.pct}</div>
                  <div className="text-xs text-black/45">{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold text-black/50 uppercase tracking-wider">Key Modifications</p>
            {[
              { num: '1', title: 'No long-term bonds', desc: 'In a high-debt, rising-rate world, long-term Treasuries are the most vulnerable asset. Replaced with SGOV (0–3 month T-bills) as tactical dry powder earning ~4.5–5% yield.' },
              { num: '2', title: 'Higher equity allocation (55–60% vs 30%)', desc: 'Appropriate for a longer time horizon that can weather volatility in exchange for higher long-run compounding.' },
              { num: '3', title: 'Bitcoin as hard-money complement (8–12%)', desc: 'Modern digital store of value alongside traditional gold; held at cost and allowed to dilute naturally as the portfolio grows.' },
              { num: '4', title: 'Quality compounders + high-conviction names', desc: 'Instead of a pure index approach — includes NVDA/TSM/MSFT/PLTR (quality compounders with durable moats) and RKLB/RVI/SPCX (asymmetric high-conviction bets).' },
              { num: '5', title: 'Real assets at 14–16%', desc: 'GLD + BCI as the core inflation/devaluation hedge. Dalio\'s "buy stuff" principle applied with modern instruments.' },
            ].map((mod) => (
              <div key={mod.num} className="flex gap-3">
                <div className="w-6 h-6 rounded-full bg-accent-blue/10 text-accent-blue flex items-center justify-center text-xs font-semibold shrink-0 mt-0.5">{mod.num}</div>
                <div>
                  <p className="text-sm font-medium text-black/75">{mod.title}</p>
                  <p className="text-xs text-black/45 mt-0.5 leading-relaxed">{mod.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 bg-accent-blue/[0.04] rounded-xl border border-accent-blue/10">
            <p className="text-xs text-black/55 italic leading-relaxed">
              &ldquo;Rebalancing is what turns a bunch of good uncorrelated bets into a truly balanced portfolio that can survive any season of the Big Cycle.&rdquo;
            </p>
            <p className="text-xs text-black/35 mt-1.5">— Ray Dalio</p>
          </div>
        </div>
      </CollapsibleSection>

      {/* ─── Holding Rationales ─── */}
      <CollapsibleSection
        title="Holding Rationales"
        subtitle="Why each position exists in the portfolio and its role in the All-Weather framework"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {HOLDING_RATIONALES.map((r) => (
            <div key={r.symbol} className="p-4 bg-black/[0.02] rounded-xl">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-semibold text-black/75">{r.symbol}</span>
              </div>
              <p className="text-xs font-medium text-black/60 mb-1.5">{r.title}</p>
              <p className="text-xs text-black/45 leading-relaxed">{r.rationale}</p>
            </div>
          ))}
        </div>
      </CollapsibleSection>

      {/* ─── SGOV Deployment Strategy ─── */}
      <CollapsibleSection
        title="SGOV Deployment — Drawdown Ladder"
        subtitle="When and how to deploy dry powder during market drawdowns"
      >
        <div className="space-y-5">
          {/* Ladder visual */}
          <div className="space-y-0">
            {DRAWDOWN_LADDER.map((rung, i) => (
              <div key={rung.trigger} className="flex gap-4">
                {/* Step indicator */}
                <div className="flex flex-col items-center">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white ${
                    i === 0 ? 'bg-accent-green' : i === 1 ? 'bg-accent-orange' : 'bg-accent-red'
                  }`}>
                    {i + 1}
                  </div>
                  {i < DRAWDOWN_LADDER.length - 1 && (
                    <div className="w-px h-12 bg-black/[0.08]" />
                  )}
                </div>
                {/* Content */}
                <div className="pb-6">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-black/75">{rung.trigger}</p>
                    {rung.triggerDetail && <span className="text-xs text-black/35">{rung.triggerDetail}</span>}
                  </div>
                  <p className="text-xs text-black/55 mt-1">{rung.action}</p>
                  <p className="text-xs font-medium text-black/40 mt-0.5">{rung.amount}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Tactics */}
          <div className="p-4 bg-black/[0.02] rounded-xl space-y-2">
            <p className="text-xs font-semibold text-black/50 uppercase tracking-wider mb-2">Deployment Tactics</p>
            {[
              'Check weekly (Sunday evening) or any day SPY drops 2%+',
              'Calculate trigger: SPY 3-month chart highest close × 0.90 for the –10% trigger',
              'Spread buys over 1–3 trading days — never deploy entire tranche at once',
              'Dalio gut-check: Stronger signal if BCI and GLD are flat/rising while stocks fall',
              'Permanent floor: Never let SGOV drop below ~$150 (emergency cash)',
            ].map((tactic, i) => (
              <div key={i} className="flex gap-2">
                <span className="text-xs text-black/25 tabular-nums">{i + 1}.</span>
                <p className="text-xs text-black/55 leading-relaxed">{tactic}</p>
              </div>
            ))}
          </div>
        </div>
      </CollapsibleSection>

      {/* ─── Rebalancing Guide ─── */}
      <CollapsibleSection
        title="Rebalancing & Buy/Sell Guide"
        subtitle="When and how to rebalance, with sell/buy priority orders and worked examples"
      >
        <div className="space-y-5">
          {/* When to rebalance */}
          <div>
            <p className="text-xs font-semibold text-black/50 uppercase tracking-wider mb-2">When to Rebalance</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-3 bg-black/[0.02] rounded-xl">
                <p className="text-xs font-semibold text-black/60">Quarterly</p>
                <p className="text-xs text-black/40 mt-1">Last trading day of Mar, Jun, Sep, Dec</p>
              </div>
              <div className="p-3 bg-black/[0.02] rounded-xl">
                <p className="text-xs font-semibold text-black/60">Threshold Trigger</p>
                <p className="text-xs text-black/40 mt-1">Immediately if any sleeve drifts &gt;5% from target</p>
              </div>
              <div className="p-3 bg-black/[0.02] rounded-xl">
                <p className="text-xs font-semibold text-black/60">Post-Deployment</p>
                <p className="text-xs text-black/40 mt-1">After SGOV deployment — bring equities back in range</p>
              </div>
            </div>
          </div>

          {/* Sell Priority */}
          <div>
            <p className="text-xs font-semibold text-black/50 uppercase tracking-wider mb-2">Sell Priority Order (Equities Overweight)</p>
            <div className="space-y-1.5">
              {[
                { num: '1st', action: 'Trim high-conviction (RKLB / RVI / SPCX)', reason: 'Most volatile, highest valuation risk' },
                { num: '2nd', action: 'Trim quality compounders equally (NVDA/TSM/MSFT/PLTR)', reason: 'If group >17%' },
                { num: '3rd', action: 'Trim VTI or VTV', reason: 'Only as last resort — most diversified' },
              ].map((item) => (
                <div key={item.num} className="flex items-start gap-2">
                  <Badge variant="neutral">{item.num}</Badge>
                  <div>
                    <p className="text-xs font-medium text-black/65">{item.action}</p>
                    <p className="text-xs text-black/35">{item.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Buy Priority */}
          <div>
            <p className="text-xs font-semibold text-black/50 uppercase tracking-wider mb-2">Buy Priority Order (Internal Rebalance)</p>
            <div className="space-y-1.5">
              {[
                { num: '1st', action: 'Add to VTI', reason: 'Broad anchor — always the first equity buy' },
                { num: '2nd', action: 'Add to VXUS if below 6%', reason: 'International diversification' },
                { num: '3rd', action: 'Add to VTV if below 7%', reason: 'Value tilt for inflation hedging' },
                { num: '4th', action: 'Add to quality compounders (equal split)', reason: 'Only on dips or if group <13%' },
              ].map((item) => (
                <div key={item.num} className="flex items-start gap-2">
                  <Badge variant="neutral">{item.num}</Badge>
                  <div>
                    <p className="text-xs font-medium text-black/65">{item.action}</p>
                    <p className="text-xs text-black/35">{item.reason}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Worked Examples */}
          <div>
            <p className="text-xs font-semibold text-black/50 uppercase tracking-wider mb-3">Worked Examples</p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-4 bg-accent-orange/[0.04] rounded-xl border border-accent-orange/10">
                <p className="text-xs font-semibold text-accent-orange mb-2">Equities Overweight (63%)</p>
                <div className="space-y-1.5 text-xs text-black/55">
                  <p>Portfolio: $4,200 — need to sell ~$252</p>
                  <p className="text-accent-red">Sell: $120 RKLB + $80 RVI + $52 NVDA</p>
                  <p className="text-accent-green">Buy: $252 into SGOV</p>
                  <p className="text-black/35 mt-1">Result: Equities back to ~57%</p>
                </div>
              </div>
              <div className="p-4 bg-accent-blue/[0.04] rounded-xl border border-accent-blue/10">
                <p className="text-xs font-semibold text-accent-blue mb-2">Internal Rebalance (57% OK)</p>
                <div className="space-y-1.5 text-xs text-black/55">
                  <p>Portfolio: $4,000 — high-conviction at 8%</p>
                  <p className="text-accent-red">Sell: $50 RKLB + $30 RVI</p>
                  <p className="text-accent-green">Buy: $80 into VTI</p>
                  <p className="text-black/35 mt-1">Result: Total equities unchanged, internal balance fixed</p>
                </div>
              </div>
              <div className="p-4 bg-accent-green/[0.04] rounded-xl border border-accent-green/10">
                <p className="text-xs font-semibold text-accent-green mb-2">Equities Underweight (52%)</p>
                <div className="space-y-1.5 text-xs text-black/55">
                  <p>Portfolio: $3,900 — after SGOV deployment</p>
                  <p className="text-accent-red">Sell: Nothing from equities</p>
                  <p className="text-accent-green">Buy: $120 VTI + $60 VXUS/compounders</p>
                  <p className="text-black/35 mt-1">Result: Equities back inside 55–60%</p>
                </div>
              </div>
            </div>
          </div>

          {/* High-conviction buy rules */}
          <div className="p-4 bg-accent-purple/[0.04] rounded-xl border border-accent-purple/10">
            <p className="text-xs font-semibold text-black/60 mb-2">When to Buy High-Conviction (RKLB / RVI / SPCX)</p>
            <div className="space-y-1 text-xs text-black/50">
              <p>Only with new contributions (paycheck money) if:</p>
              <ul className="list-disc list-inside space-y-0.5 ml-2">
                <li>They drop 20%+ from your average cost basis</li>
                <li>Your original thesis is still fully intact</li>
                <li>Combined weight is well below 6.5%</li>
                <li>Cap any single add at 0.5–1% of portfolio</li>
              </ul>
            </div>
          </div>
        </div>
      </CollapsibleSection>

      {/* ─── New Contribution Priority ─── */}
      <CollapsibleSection
        title="New Contribution Priority"
        subtitle="How to allocate new money when it comes in (paycheck, bonus)"
      >
        <div className="space-y-4">
          <div className="space-y-0">
            {[
              { num: 1, target: 'SGOV', desc: 'Until back at 15.7% target', color: '#34C759' },
              { num: 2, target: 'VTI / VXUS', desc: 'Maintain core equity balance', color: '#007AFF' },
              { num: 3, target: 'GLD', desc: 'Continue building toward 12–15% over time', color: '#E6A700' },
              { num: 4, target: 'BCI', desc: 'Maintain at ~4% with occasional top-ups', color: '#FF9500' },
              { num: 5, target: 'NVDA/TSM/MSFT/PLTR', desc: 'Opportunistic adds on dips only', color: '#AF52DE' },
            ].map((item, i) => (
              <div key={item.num} className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                    style={{ backgroundColor: item.color }}
                  >
                    {item.num}
                  </div>
                  {i < 4 && <div className="w-px h-8 bg-black/[0.06]" />}
                </div>
                <div className="pb-4">
                  <p className="text-sm font-medium text-black/70">{item.target}</p>
                  <p className="text-xs text-black/40 mt-0.5">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="p-4 bg-black/[0.02] rounded-xl space-y-2">
            <p className="text-xs font-semibold text-black/50 uppercase tracking-wider mb-2">Special Rules</p>
            <div className="space-y-2 text-xs text-black/50 leading-relaxed">
              <p><span className="font-medium text-black/60">SGOV replenishment:</span> 100% of new contributions go to SGOV until it reaches 15.7% — cleanest, most tax-efficient method.</p>
              <p><span className="font-medium text-black/60">Opportunistic refill:</span> If SGOV falls below 12% after deployment AND SPY has recovered +10% from deployment price, sell 40% of deployed tranche back to SGOV.</p>
              <p><span className="font-medium text-black/60">BTC:</span> Hold at current weight; let dilution happen naturally. No forced rebalance unless &gt;5% drift trigger fires.</p>
            </div>
          </div>
        </div>
      </CollapsibleSection>
    </>
  );
}
