'use client';

// Recommended Updates — today's specific rebalance suggestions, computed live
// from the current portfolio by src/lib/rebalance.ts. Every line is a mechanical
// application of the portfolio's own rules; the reason under each trade says
// exactly which rule fired and with what live numbers.

import { Card, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Term } from '@/components/ui/Term';
import { formatCurrency } from '@/lib/format';
import type { HoldingPosition } from '@/lib/holdings';
import { buildRebalancePlan, nextQuarterEnd, type RebalanceRec } from '@/lib/rebalance';

const fmtUsd = (v: number) => formatCurrency(v, { decimals: 0 });

function fmtShares(rec: RebalanceRec): string | null {
  if (rec.shares == null || rec.price == null || rec.price <= 0) return null;
  const decimals = rec.shares >= 1 ? 3 : 5;
  return `≈ ${rec.shares.toFixed(decimals)} sh @ ${formatCurrency(rec.price)}`;
}

function UrgencyBadge({ urgency }: { urgency: RebalanceRec['urgency'] }) {
  if (urgency === 'now') return <Badge variant="red">Act now — &gt;5pp drift</Badge>;
  if (urgency === 'quarterly') return <Badge variant="neutral">Quarterly window</Badge>;
  return null;
}

function RecRow({ rec }: { rec: RebalanceRec }) {
  const shares = fmtShares(rec);
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-black/[0.04] last:border-0">
      <Badge variant={rec.kind === 'sell' ? 'red' : rec.kind === 'buy' ? 'green' : 'blue'}>
        {rec.kind === 'sell' ? 'Sell' : rec.kind === 'buy' ? 'Buy' : 'Note'}
      </Badge>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-black/75">{rec.action}</p>
          {shares && <span className="text-xs text-black/40 tabular-nums">{shares}</span>}
          <UrgencyBadge urgency={rec.urgency} />
        </div>
        <p className="text-xs text-black/45 leading-relaxed mt-0.5">{rec.reason}</p>
      </div>
    </div>
  );
}

export function RecommendedUpdates({
  positions,
  portfolioValue,
}: {
  positions: HoldingPosition[];
  portfolioValue: number;
}) {
  const plan = buildRebalancePlan(positions, portfolioValue);
  const trades = [...plan.sells, ...plan.buys];

  return (
    <Card>
      <div className="flex items-center gap-3 flex-wrap">
        <CardTitle>Recommended Updates — Today</CardTitle>
        {plan.allInRange ? (
          <Badge variant="green">All in range</Badge>
        ) : plan.urgent ? (
          <Badge variant="red">Threshold trigger active</Badge>
        ) : (
          <Badge variant="orange">{trades.length} suggested trade{trades.length === 1 ? '' : 's'}</Badge>
        )}
      </div>
      <p className="text-xs text-black/40 mt-1 leading-relaxed max-w-3xl">
        Specific trades generated from today&apos;s live prices by mechanically applying your own rules — the <Term k="sleeve">sleeve</Term> target bands, the sell priority (high-conviction → compounders → core last), the buy priority (VTI first), the BTC no-forced-<Term k="rebalancing">rebalance</Term> buffer, and the {formatCurrency(150, { decimals: 0 })} SGOV floor. Amounts shift daily as prices move. Suggestions, not orders — nothing here executes anything.
      </p>

      {plan.allInRange ? (
        <div className="mt-4 flex items-start gap-2 text-sm text-black/55">
          <span className="inline-block w-2 h-2 rounded-full bg-accent-green mt-1.5 shrink-0" />
          <p className="leading-relaxed">
            Every sleeve and sub-sleeve is inside its target band at today&apos;s prices — no trades suggested. Doing nothing is the correct move. Next scheduled checkpoint: the quarterly rebalance around <span className="font-medium text-black/70">{nextQuarterEnd()}</span>, or sooner if any sleeve drifts more than 5 points past its band.
          </p>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {plan.sells.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-black/40 mb-1">
                Sells — {fmtUsd(plan.totalSell)} total
              </p>
              <div>{plan.sells.map((r, i) => <RecRow key={`s${i}`} rec={r} />)}</div>
            </div>
          )}
          {plan.buys.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-black/40 mb-1">
                Buys — {fmtUsd(plan.totalBuy)} total
              </p>
              <div>{plan.buys.map((r, i) => <RecRow key={`b${i}`} rec={r} />)}</div>
            </div>
          )}
        </div>
      )}

      {plan.notes.length > 0 && (
        <div className="mt-4 pt-3 border-t border-black/[0.05]">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-black/40 mb-1">
            Standing notes
          </p>
          <div>{plan.notes.map((r, i) => <RecRow key={`n${i}`} rec={r} />)}</div>
        </div>
      )}

      {!plan.allInRange && (
        <p className="text-xs text-black/35 italic leading-relaxed mt-4">
          Execution habits from the plan: spread orders over 1–3 trading days rather than all at once, prefer down days for buys, and re-check this card after any fill — amounts recompute from live weights, so partial execution updates the remaining suggestions automatically.
        </p>
      )}
    </Card>
  );
}
