'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { Card, CardTitle, MetricCard } from '@/components/ui/Card';
import { LoadingPage } from '@/components/ui/Loading';
import { Badge } from '@/components/ui/Badge';
import { usePortfolio, usePolygonAggregates, useApi } from '@/lib/hooks';
import { formatCurrency } from '@/lib/format';
import { Term, Explainer } from '@/components/ui/Term';
import {
  computeSleeveData,
  getSleeveStatus,
  REGIME_SLEEVE_GUIDANCE,
  type RegimeKey,
  type SleeveLean,
} from '@/lib/sleeves';

interface RegimeResult {
  regime: RegimeKey;
  label: string;
  description: string;
  inflationTrend: 'rising' | 'falling' | 'stable';
  growthTrend: 'accelerating' | 'decelerating' | 'stable';
  latestInflation: number;
  latestUnemployment: number;
}

type Obs = { date: string; value: number | null };

interface DashboardData {
  regime?: RegimeResult;
  t10y2y?: Obs[];
  vix?: Obs[];
  fedFunds?: Obs[];
}

const REGIME_STYLE: Record<RegimeKey, { bg: string; text: string; badge: 'green' | 'orange' | 'red' | 'blue' | 'neutral' }> = {
  goldilocks:  { bg: 'bg-accent-green/[0.06]', text: 'text-accent-green', badge: 'green' },
  reflation:   { bg: 'bg-accent-orange/[0.06]', text: 'text-accent-orange', badge: 'orange' },
  stagflation: { bg: 'bg-accent-red/[0.06]', text: 'text-accent-red', badge: 'red' },
  deflation:   { bg: 'bg-accent-blue/[0.06]', text: 'text-accent-blue', badge: 'blue' },
  unknown:     { bg: 'bg-black/[0.03]', text: 'text-black/60', badge: 'neutral' },
};

const LEAN_STYLE: Record<SleeveLean, { label: string; badge: 'green' | 'orange' | 'neutral' }> = {
  favored: { label: 'Favored', badge: 'green' },
  caution: { label: 'Caution', badge: 'orange' },
  neutral: { label: 'Neutral', badge: 'neutral' },
};

function latest(arr?: Obs[]): number | null {
  if (!arr || arr.length === 0) return null;
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i].value != null) return arr[i].value;
  }
  return null;
}

function trendArrow(t?: string): string {
  if (t === 'rising' || t === 'accelerating') return '↑';
  if (t === 'falling' || t === 'decelerating') return '↓';
  return '→';
}

export default function BriefingPage() {
  const { data: portfolio, loading } = usePortfolio();
  const { data: dashboard } = useApi<DashboardData>('/api/fred?action=dashboard');
  const { data: spyDaily } = usePolygonAggregates('SPY', '1day');

  const sleeves = useMemo(
    () => (portfolio ? computeSleeveData(portfolio.positions) : []),
    [portfolio]
  );

  // SPY drawdown from rolling 3-month peak — drives the dry-powder deployment cue.
  const drawdown = useMemo(() => {
    if (!spyDaily || spyDaily.length === 0) return null;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 3);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    const recent = spyDaily.filter((d) => d.date >= cutoffStr);
    if (recent.length === 0) return null;
    const peak = recent.reduce((m, b) => (b.high > m ? b.high : m), recent[0].high);
    const current = recent[recent.length - 1].close;
    const pct = ((current - peak) / peak) * 100;
    const severity = pct <= -20 ? 'bear' : pct <= -10 ? 'correction' : pct <= -5 ? 'pullback' : 'normal';
    return { pct, severity };
  }, [spyDaily]);

  if (loading) return <LoadingPage />;

  const regime = dashboard?.regime;
  const regimeKey: RegimeKey = regime?.regime ?? 'unknown';
  const style = REGIME_STYLE[regimeKey];
  const guidance = REGIME_SLEEVE_GUIDANCE[regimeKey];

  const t10y2y = latest(dashboard?.t10y2y);
  const vix = latest(dashboard?.vix);

  // Build the action queue: off-target sleeves + drawdown ladder cue.
  // Each action carries a `why` so the reasoning is visible, not just the instruction.
  const actions: Array<{ tone: 'sell' | 'buy' | 'info'; text: string; why: string }> = [];
  for (const s of sleeves) {
    const status = getSleeveStatus(s.weight, s.targetMin, s.targetMax);
    // Conviction Core (SPCX) runs on its own asymmetric rules: new-money-only
    // builds, trims only above the 15% hard ceiling — never standard band nagging.
    if (s.name === 'Conviction Core') {
      if (s.weight > 15) {
        actions.push({
          tone: 'sell',
          text: `Conviction Core (SPCX) is ${s.weight.toFixed(1)}% — above the 15% hard ceiling. Trim back toward 12%.`,
          why: 'The ceiling is the one rule the thesis doesn\'t override: beyond 15%, a routine 50% single-name drawdown takes 7%+ off the whole portfolio. Full rules on the Holdings page.',
        });
      } else if (status === 'under') {
        actions.push({
          tone: 'info',
          text: `SPCX is ${s.weight.toFixed(1)}% vs its ${s.targetMin}–${s.targetMax}% build target — fund the gap with new contributions, not by selling.`,
          why: 'The Conviction Core build is contribution-funded by design; the dashboard will never suggest selling core holdings (VTI/GLD/SGOV) to buy SPCX. See the Conviction Core rules on the Holdings page.',
        });
      }
      continue;
    }
    if (status === 'over') {
      actions.push({
        tone: 'sell',
        text: `${s.name} is ${s.weight.toFixed(1)}% vs its ${s.targetMin}–${s.targetMax}% target — trim ~${(s.weight - s.targetMax).toFixed(1)} points back toward target.`,
        why: `${s.name} has grown past the share of the portfolio it's supposed to hold. Trimming now sells a little of what's run up (locking in relative gains) and stops one sleeve's risk from dominating the whole book — the mechanical "sell high" half of rebalancing.`,
      });
    } else if (status === 'under') {
      actions.push({
        tone: 'buy',
        text: `${s.name} is ${s.weight.toFixed(1)}% vs its ${s.targetMin}–${s.targetMax}% target — add ~${(s.targetMin - s.weight).toFixed(1)} points to get back in range.`,
        why: `${s.name} has shrunk below the role it's meant to play (either it lagged, or the rest of the portfolio grew). Topping it up restores the protection/exposure that sleeve exists to provide — the "buy low" half of rebalancing.`,
      });
    }
  }
  if (drawdown && drawdown.severity !== 'normal') {
    actions.push({
      tone: 'info',
      text: drawdown.severity === 'bear'
        ? `SPY is ${drawdown.pct.toFixed(1)}% below its 3-month high (bear territory) — the final, most aggressive rung of the dry-powder ladder is active.`
        : drawdown.severity === 'correction'
        ? `SPY is ${drawdown.pct.toFixed(1)}% below its 3-month high (a correction) — the –15% rung of the dry-powder ladder favors adding to quality compounders.`
        : `SPY is ${drawdown.pct.toFixed(1)}% below its 3-month high (a pullback) — the first dry-powder rung (buy VTI) is in range.`,
      why: 'The dry-powder ladder is a pre-committed buying plan: specific chunks of the cash reserve get deployed at –10%, –15%, and –25% declines from recent highs. Setting the levels in advance takes the emotion out of buying when markets are falling — historically the moments with the best forward returns. Spread any buy over 1–3 days rather than all at once.',
    });
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-black/85 tracking-tight">Briefing</h2>
          <p className="text-sm text-black/45 mt-1">
            Today&apos;s regime, your sleeves, and what to do about it
          </p>
        </div>
        {portfolio && (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-black/35">Portfolio</p>
            <p className="text-2xl font-semibold text-black/85 tabular-nums">{formatCurrency(portfolio.portfolioValue)}</p>
            <p className={`text-sm font-medium tabular-nums ${portfolio.dayChange >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
              {portfolio.dayChange >= 0 ? '+' : ''}{formatCurrency(portfolio.dayChange)} ({portfolio.dayChangePercent >= 0 ? '+' : ''}{portfolio.dayChangePercent.toFixed(2)}%) today
            </p>
          </div>
        )}
      </div>

      {/* Regime verdict */}
      <Card className={style.bg}>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="max-w-2xl">
            <div className="flex items-center gap-3 mb-1.5">
              <CardTitle>Macro Regime</CardTitle>
              <Badge variant={style.badge}>{regime?.label ?? 'Loading…'}</Badge>
            </div>
            <p className="text-sm text-black/55 leading-relaxed">{regime?.description ?? 'Fetching the latest macro read…'}</p>
            <Explainer title="What is a regime, and how is this one determined?">
              <p>
                A <Term k="regime">macro regime</Term> is the economy&apos;s current &quot;season,&quot; and it decides which of your sleeves the environment favors. The classification here uses two questions: <span className="font-medium text-black/70">is inflation above 3%?</span> (from <Term k="cpi">CPI</Term>) and <span className="font-medium text-black/70">is unemployment rising?</span> (trend over the past ~3 months).
              </p>
              <p>
                The four possible answers map to the four seasons: <Term k="goldilocks">Goldilocks</Term> (low inflation, solid jobs — best for stocks), <Term k="reflation">Reflation</Term> (hot inflation, solid jobs — best for commodities/gold), <Term k="stagflation">Stagflation</Term> (hot inflation, weakening jobs — hardest season, cash and gold), and <Term k="deflation">Disinflation/Slowdown</Term> (cooling inflation, weakening jobs — cash and quality). The four tiles below are the vital signs behind the call.
              </p>
            </Explainer>
          </div>
          <Link href="/macro" className="text-sm font-medium text-accent-blue hover:text-accent-blue/80 shrink-0">
            Full macro view →
          </Link>
        </div>

        {/* Driver chips */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
          <div className="rounded-xl bg-white/60 border border-black/[0.05] p-3">
            <p className="text-[10px] uppercase tracking-wider text-black/35"><Term k="cpi">Inflation (CPI YoY)</Term></p>
            <p className="text-lg font-semibold tabular-nums text-black/80">
              {regime ? `${regime.latestInflation.toFixed(1)}%` : '—'} <span className="text-sm text-black/40">{trendArrow(regime?.inflationTrend)}</span>
            </p>
            <p className="text-[11px] text-black/40">
              <span className="capitalize">{regime?.inflationTrend ?? ''}</span>{regime ? ' · Fed target ~2%' : ''}
            </p>
          </div>
          <div className="rounded-xl bg-white/60 border border-black/[0.05] p-3">
            <p className="text-[10px] uppercase tracking-wider text-black/35"><Term k="lagging-indicator">Unemployment</Term></p>
            <p className="text-lg font-semibold tabular-nums text-black/80">
              {regime ? `${regime.latestUnemployment.toFixed(1)}%` : '—'} <span className="text-sm text-black/40">{trendArrow(regime?.growthTrend)}</span>
            </p>
            <p className="text-[11px] text-black/40 capitalize">{regime?.growthTrend ? `growth ${regime.growthTrend}` : ''}</p>
          </div>
          <div className="rounded-xl bg-white/60 border border-black/[0.05] p-3">
            <p className="text-[10px] uppercase tracking-wider text-black/35"><Term k="inversion">Yield Curve (10Y–2Y)</Term></p>
            <p className={`text-lg font-semibold tabular-nums ${t10y2y != null && t10y2y < 0 ? 'text-accent-red' : 'text-black/80'}`}>
              {t10y2y != null ? `${t10y2y > 0 ? '+' : ''}${t10y2y.toFixed(2)}%` : '—'}
            </p>
            <p className="text-[11px] text-black/40">{t10y2y != null && t10y2y < 0 ? 'Inverted — recession watch' : 'Positive — normal slope'}</p>
          </div>
          <div className="rounded-xl bg-white/60 border border-black/[0.05] p-3">
            <p className="text-[10px] uppercase tracking-wider text-black/35"><Term k="vix">VIX</Term></p>
            <p className={`text-lg font-semibold tabular-nums ${vix != null && vix > 25 ? 'text-accent-red' : vix != null && vix > 20 ? 'text-accent-orange' : 'text-black/80'}`}>
              {vix != null ? vix.toFixed(1) : '—'}
            </p>
            <p className="text-[11px] text-black/40">{vix != null ? (vix > 30 ? 'High fear (>30)' : vix > 20 ? 'Watchful (20–30)' : 'Calm (<20)') : ''}</p>
          </div>
        </div>
      </Card>

      {/* Action queue */}
      <Card>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle>Action Queue</CardTitle>
          <Link href="/portfolio" className="text-sm font-medium text-accent-blue hover:text-accent-blue/80">
            Trade-level recommendations →
          </Link>
        </div>
        <p className="text-xs text-black/40 mt-1 mb-4">
          Concrete to-dos generated from two mechanical checks: is any <Term k="sleeve">sleeve</Term> outside its target band (<Term k="rebalancing">rebalancing</Term>), and has the market fallen far enough to trigger the <Term k="drawdown-ladder">dry-powder ladder</Term>. No prediction involved — just your own pre-set rules, checked against today&apos;s numbers.
        </p>
        {actions.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-black/55">
            <span className="inline-block w-2 h-2 rounded-full bg-accent-green" />
            All sleeves are inside their target bands and no drawdown trigger is active — no trades needed. Doing nothing is the correct move today.
          </div>
        ) : (
          <div className="space-y-3">
            {actions.map((a, i) => (
              <div key={i} className="flex items-start gap-3">
                <Badge variant={a.tone === 'sell' ? 'red' : a.tone === 'buy' ? 'green' : 'blue'}>
                  {a.tone === 'sell' ? 'Trim' : a.tone === 'buy' ? 'Add' : 'Deploy'}
                </Badge>
                <div>
                  <p className="text-sm text-black/65 leading-relaxed">{a.text}</p>
                  <p className="text-xs text-black/40 leading-relaxed mt-0.5">{a.why}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Sleeve scorecard */}
      <Card padding="none">
        <div className="px-6 pt-6 pb-3 flex items-end justify-between flex-wrap gap-2">
          <div>
            <CardTitle>Sleeve Scorecard — Current vs Target</CardTitle>
            <p className="text-xs text-black/40 mt-1">
              Each <Term k="sleeve">sleeve</Term> is a bucket of holdings with one job — growth, inflation protection, ready cash, or asymmetric upside. The shaded band on each bar is its target range; the solid bar is where it sits today. Chips show how the {regime?.label ?? 'current'} regime tilts each sleeve.
            </p>
          </div>
          <Link href="/portfolio" className="text-sm font-medium text-accent-blue hover:text-accent-blue/80">
            Holdings & sub-sleeves →
          </Link>
        </div>
        <div className="divide-y divide-black/[0.04]">
          {sleeves.map((s) => {
            const status = getSleeveStatus(s.weight, s.targetMin, s.targetMax);
            const g = guidance[s.name];
            const lean = g ? LEAN_STYLE[g.lean] : LEAN_STYLE.neutral;
            const maxBar = 70;
            return (
              <div key={s.name} className="px-6 py-4">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
                    <span className="text-sm font-semibold text-black/80">{s.name}</span>
                    <Badge variant={lean.badge}>{lean.label}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm tabular-nums text-black/60">{s.weight.toFixed(1)}% / {s.targetMin}–{s.targetMax}%</span>
                    <Badge variant={status === 'in-range' ? 'green' : status === 'over' ? 'orange' : 'blue'}>
                      {status === 'in-range' ? 'In Range' : status === 'over' ? 'Over' : 'Under'}
                    </Badge>
                  </div>
                </div>
                {/* target band + current bar */}
                <div className="relative h-5 bg-black/[0.03] rounded-md overflow-hidden mb-2">
                  <div className="absolute top-0 bottom-0 rounded-md" style={{ left: `${(s.targetMin / maxBar) * 100}%`, width: `${((s.targetMax - s.targetMin) / maxBar) * 100}%`, backgroundColor: s.color, opacity: 0.14 }} />
                  <div className="absolute top-0.5 bottom-0.5 rounded-sm" style={{ width: `${Math.min((s.weight / maxBar) * 100, 100)}%`, backgroundColor: s.color, opacity: 0.8 }} />
                </div>
                {g && <p className="text-xs text-black/50 leading-relaxed">{g.note}</p>}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Quick metrics */}
      {portfolio && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Portfolio Value" value={formatCurrency(portfolio.portfolioValue)} change={`${portfolio.dayChange >= 0 ? '+' : ''}${formatCurrency(portfolio.dayChange)}`} changeLabel="today" trend={portfolio.dayChange >= 0 ? 'up' : 'down'} />
          <MetricCard label="Positions" value={portfolio.positions.length.toString()} />
          <MetricCard label="Sleeves Off-Target" value={actions.filter((a) => a.tone !== 'info').length.toString()} change={actions.length === 0 ? 'balanced' : 'needs action'} />
          <MetricCard label="SPY vs 3-Mo High" value={drawdown ? `${drawdown.pct.toFixed(1)}%` : '—'} change={drawdown ? drawdown.severity : ''} trend={drawdown && drawdown.pct < 0 ? 'down' : 'up'} />
        </div>
      )}
    </div>
  );
}
