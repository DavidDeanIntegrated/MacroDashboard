'use client';

// Shared UI for the volatility-signal sections of the Portfolio Analytics and
// Watchlist Analytics pages: the inline Bottom Timing Score panel and the two
// methodology/guide cards. Logic lives in lib/vol-signals.ts.

import { Card, CardTitle } from '@/components/ui/Card';
import type { BottomScoreBreakdown, SignalMode } from '@/lib/vol-signals';

const COMPONENT_LABELS: Array<{ key: keyof BottomScoreBreakdown; label: string; max: number; unavailableKey?: 'volume' | 'vix' | 'hySpread' }> = [
  { key: 'drawdownPts', label: 'Drawdown', max: 20 },
  { key: 'volSpikePts', label: 'Vol Spike', max: 15 },
  { key: 'volumePts', label: 'Down Vol', max: 15, unavailableKey: 'volume' },
  { key: 'vixPts', label: 'VIX', max: 15, unavailableKey: 'vix' },
  { key: 'hySpreadPts', label: 'HY Spread', max: 10, unavailableKey: 'hySpread' },
  { key: 'pricePositionPts', label: 'Price Pos', max: 10 },
  { key: 'volMeanReversionPts', label: 'Vol Revert', max: 15 },
];

export function BottomScorePanel({ score }: { score: BottomScoreBreakdown }) {
  return (
    <div className={`mt-3 rounded-xl border p-4 ${score.gradeColor}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider">Bottom Timing Score</span>
          <span className="text-lg font-black tabular-nums">{score.total}</span>
          <span className="text-xs font-medium opacity-60">/ {score.maxPossible}</span>
        </div>
        <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-white/40">{score.grade}</span>
      </div>
      {/* Score bar */}
      <div className="w-full h-2.5 rounded-full bg-black/[0.08] mb-3 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            score.total >= 75 ? 'bg-accent-red' :
            score.total >= 55 ? 'bg-accent-orange' :
            score.total >= 35 ? 'bg-accent-blue' :
            'bg-black/25'
          }`}
          style={{ width: `${score.total}%` }}
        />
      </div>
      {/* Component breakdown */}
      <div className="grid grid-cols-4 md:grid-cols-7 gap-2 text-[10px]">
        {COMPONENT_LABELS.map((c) => {
          const missing = c.unavailableKey && score.unavailable.includes(c.unavailableKey);
          return (
            <div key={c.label} className="text-center">
              <p className="opacity-60 uppercase tracking-wider mb-0.5">{c.label}</p>
              <p className="font-bold tabular-nums">
                {missing ? 'n/a' : `${score[c.key] as number}/${c.max}`}
              </p>
            </div>
          );
        })}
      </div>
      {score.unavailable.length > 0 && (
        <p className="text-[10px] opacity-60 mt-2">
          {score.unavailable.length} component{score.unavailable.length > 1 ? 's' : ''} lacked data and {score.unavailable.length > 1 ? 'are' : 'is'} excluded from the achievable maximum — missing data is reported, never scored as &quot;calm&quot;.
        </p>
      )}
    </div>
  );
}

export function BottomScoreMethodologyCard() {
  return (
    <Card>
      <CardTitle>Bottom Timing Score — Methodology</CardTitle>
      <p className="text-xs text-black/40 mt-1 mb-4">
        A composite framework score (0–100) for gauging how consistent conditions are with a capitulation bottom, computed over a fixed 1-year lookback (independent of the period selector). Metrics score on smooth piecewise-linear curves — no bucket cliffs. Shown for stocks whose volatility signal is capitulation-flavored.
      </p>
      <div className="space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-lg border border-black/[0.06] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-black/50 mb-1">Drawdown Severity (0-20)</p>
            <p className="text-xs text-black/55 leading-relaxed">
              How far the stock has fallen from its 1Y high, scaling smoothly from 0pts at −5% to the full 20pts at −30% or deeper.
            </p>
          </div>
          <div className="rounded-lg border border-black/[0.06] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-black/50 mb-1">Volatility Spike (0-15)</p>
            <p className="text-xs text-black/55 leading-relaxed">
              Current 20-day rolling vol as a percentile of the stock&apos;s own 1Y history — top 5% earns the full 15pts. Extreme vol spikes historically coincide with capitulation selling.
            </p>
          </div>
          <div className="rounded-lg border border-black/[0.06] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-black/50 mb-1">Down-Day Volume (0-15)</p>
            <p className="text-xs text-black/55 leading-relaxed">
              Heaviest volume among the last 5 sessions <span className="font-medium">that closed down</span>, vs the prior average — 3x earns the full 15pts. Only down-day volume counts, so an earnings pop or index-rebalance print no longer reads as capitulation.
            </p>
          </div>
          <div className="rounded-lg border border-black/[0.06] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-black/50 mb-1">VIX (0-15)</p>
            <p className="text-xs text-black/55 leading-relaxed">
              Market-wide fear, scored on the higher of its absolute level (full points at 40+) and its percentile within trailing ~3 years — so a regime where 30 is extreme still registers, while full points always require genuinely extreme levels.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-lg border border-black/[0.06] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-black/50 mb-1">HY Credit Spread (0-10)</p>
            <p className="text-xs text-black/55 leading-relaxed">
              High-yield spread over Treasuries, scored like VIX (level and trailing percentile, whichever is higher). Widening spreads confirm systemic stress — credit markets lead equities.
            </p>
          </div>
          <div className="rounded-lg border border-black/[0.06] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-black/50 mb-1">Price Position (0-10)</p>
            <p className="text-xs text-black/55 leading-relaxed">
              Where the current price sits in the 1Y range — the bottom 10% of the range earns the full 10pts, fading to 0 above the bottom 35%.
            </p>
          </div>
          <div className="rounded-lg border border-black/[0.06] p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-black/50 mb-1">Vol Mean Reversion (0-15)</p>
            <p className="text-xs text-black/55 leading-relaxed">
              Has the vol spike peaked and turned? Full points require vol to have pulled back 25%+ from its recent peak while still elevated; an extreme that hasn&apos;t peaked earns 8. The best entries come as vol crests — not while it&apos;s still rising.
            </p>
          </div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 md:grid-cols-5 gap-2">
        <div className="text-center py-2 rounded-lg bg-accent-red/10 border border-accent-red/15">
          <p className="text-[10px] font-bold text-red-700">75-100</p>
          <p className="text-[10px] text-red-600">Extreme Capitulation</p>
        </div>
        <div className="text-center py-2 rounded-lg bg-accent-orange/10 border border-accent-orange/15">
          <p className="text-[10px] font-bold text-orange-700">55-74</p>
          <p className="text-[10px] text-orange-600">Heavy Selling</p>
        </div>
        <div className="text-center py-2 rounded-lg bg-accent-blue/10 border border-accent-blue/15">
          <p className="text-[10px] font-bold text-blue-700">35-54</p>
          <p className="text-[10px] text-blue-600">Moderate Distress</p>
        </div>
        <div className="text-center py-2 rounded-lg bg-black/[0.04] border border-black/[0.06]">
          <p className="text-[10px] font-bold text-black/60">20-34</p>
          <p className="text-[10px] text-black/45">Mild Weakness</p>
        </div>
        <div className="text-center py-2 rounded-lg bg-black/[0.02] border border-black/[0.04]">
          <p className="text-[10px] font-bold text-black/40">0-19</p>
          <p className="text-[10px] text-black/30">No Signal</p>
        </div>
      </div>
      <p className="text-xs text-black/35 mt-4 italic leading-relaxed">
        This is a framework, not a prediction, and it has not been backtested — treat the components as a structured checklist, not measured probabilities. The market-stress components (VIX + HY, 25pts) mean a single-name crash in a calm market tops out around 75 by design: the top grade is reserved for stock capitulation confirmed by market-wide stress. If a component&apos;s data is missing, the score reports it and shrinks the achievable maximum instead of quietly reading &quot;calm&quot;. Always scale in rather than going all-in, and confirm the fundamental thesis before acting.
      </p>
    </Card>
  );
}

export function VolSignalGuideCard({ mode }: { mode: SignalMode }) {
  const watch = mode === 'watchlist';
  return (
    <Card>
      <CardTitle>How to Read Volatility Signals</CardTitle>
      <p className="text-xs text-black/40 mt-1 mb-4">
        A framework for using volatility to time {watch ? 'entries' : 'adds and risk decisions'} — computed over a fixed 1Y lookback, with momentum measured in units of each stock&apos;s own volatility
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-accent-green/20 rounded-xl p-4 bg-accent-green/[0.03]">
          <p className="text-xs font-semibold text-accent-green uppercase tracking-wider mb-2">When to Consider Buying</p>
          <ul className="text-xs text-black/55 space-y-1.5 leading-relaxed">
            <li><span className="font-medium text-black/70">High vol near the lows, after vol peaks:</span> Fear cresting at depressed prices is historically the best risk/reward entry — the buy-zone signal requires the vol spike to have turned, so it never fires into still-rising panic.</li>
            <li><span className="font-medium text-black/70">Above the 200-day trend:</span> The same setup below a falling 200-day average is a downtrend rebound bet — it gets the more cautious &quot;Rebound Watch&quot; label. Dips in uptrends beat knife-catches in downtrends.</li>
            <li><span className="font-medium text-black/70">Low vol coiling near support:</span> Compressed volatility suggests a big move is brewing. Wait for the breakout with volume — it can break either way.</li>
          </ul>
        </div>
        <div className="border border-accent-red/20 rounded-xl p-4 bg-accent-red/[0.03]">
          <p className="text-xs font-semibold text-accent-red uppercase tracking-wider mb-2">{watch ? 'When to Wait' : 'When to Be Careful'}</p>
          <ul className="text-xs text-black/55 space-y-1.5 leading-relaxed">
            <li><span className="font-medium text-black/70">Low vol + price at highs after a big run:</span> Complacency priced for perfection. {watch ? 'A poor entry price — let it pull back or consolidate first.' : 'No forced action — but know the position is priced for calm.'}</li>
            <li><span className="font-medium text-black/70">Rising vol + price at highs:</span> Turbulence into strength can mark distribution. {watch ? 'Hold off on entries until it resolves.' : 'If a trim is due under the rebalance rules anyway, this is a reasonable time to take it.'}</li>
            <li><span className="font-medium text-black/70">Vol still rising near the lows:</span> Capitulation Watch, not a buy — adding into an accelerating vol spike is how falling knives get caught.</li>
          </ul>
        </div>
      </div>
      <p className="text-xs text-black/35 mt-4 italic leading-relaxed">
        {watch
          ? 'Timing signals are the second gate, not the first: quality comes from the fundamentals score below, and a great entry price on a weak business is still a weak business. Size positions inversely to volatility.'
          : 'These signals are context, not instructions — the sleeve bands, sell rules, and rebalance engine decide actual trades. Volatility tells you about sentiment and positioning, not intrinsic value. Size positions inversely to volatility.'}
      </p>
    </Card>
  );
}
