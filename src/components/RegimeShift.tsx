'use client';

// Regime Shift — when the economic regime last changed, from what, and how far
// each sleeve's target band moved as a result. Sits under the sleeve allocation
// chart on the Holdings page. History comes from lib/regime-history.ts (a replay of
// the regime model on the dashboard's own FRED data, computed server-side).

import { Card, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Explainer, Term } from '@/components/ui/Term';
import { formatCurrency } from '@/lib/format';
import type { RegimeKey } from '@/lib/sleeves';
import { sleeveShifts, type RegimeHistory } from '@/lib/regime-history';

const REGIME_META: Record<RegimeKey, { name: string; color: string; badge: 'green' | 'orange' | 'red' | 'blue' | 'neutral' }> = {
  goldilocks:  { name: 'Goldilocks',  color: '#34C759', badge: 'green' },
  reflation:   { name: 'Reflation',   color: '#FF9500', badge: 'orange' },
  stagflation: { name: 'Stagflation', color: '#FF3B30', badge: 'red' },
  deflation:   { name: 'Deflation',   color: '#007AFF', badge: 'blue' },
  unknown:     { name: 'Unclear',     color: '#C7C7CC', badge: 'neutral' },
};

const fmtDate = (iso: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });

const daysSince = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(`${iso}T00:00:00Z`)) / 86400000));

function RegimePill({ regime }: { regime: RegimeKey }) {
  const m = REGIME_META[regime];
  return <Badge variant={m.badge} size="md">{m.name}</Badge>;
}

// One colored segment per month-end snapshot; year ticks under the first month of each year.
function RegimeTimeline({ history }: { history: RegimeHistory }) {
  const pts = history.points;
  const changeIdx = history.change ? pts.findIndex((p) => p.asOf >= history.change!.date) : -1;
  const present = Array.from(new Set(pts.map((p) => p.regime)));
  return (
    <div className="mt-5">
      <div className="flex gap-[2px] h-7" role="img" aria-label="Regime by month over the last three years">
        {pts.map((p, i) => (
          <div
            key={p.asOf}
            title={`${fmtDate(p.asOf, { month: 'short', year: 'numeric' })}: ${REGIME_META[p.regime].name}`}
            className={`flex-1 first:rounded-l-md last:rounded-r-md relative ${i === changeIdx ? 'ring-2 ring-black/70 ring-offset-1 z-10' : ''}`}
            style={{ backgroundColor: REGIME_META[p.regime].color, opacity: changeIdx < 0 || i >= changeIdx ? 1 : 0.55 }}
          />
        ))}
      </div>
      <div className="flex gap-[2px] mt-1">
        {pts.map((p, i) => {
          const month = new Date(`${p.asOf}T00:00:00Z`).getUTCMonth();
          return (
            <div key={p.asOf} className={`flex-1 text-[10px] text-black/35 tabular-nums whitespace-nowrap ${i === pts.length - 1 ? 'flex justify-end' : ''}`}>
              {month === 0 ? p.asOf.slice(0, 4) : i === pts.length - 1 ? 'Now' : ''}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2">
        {present.map((r) => (
          <span key={r} className="flex items-center gap-1.5 text-[11px] text-black/50">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: REGIME_META[r].color }} />
            {REGIME_META[r].name}
          </span>
        ))}
      </div>
    </div>
  );
}

// Old band (outlined) and new band (filled), zoomed to a fixed 16-point window centred
// on both bands — the same scale on every row, so shift lengths compare across sleeves.
const ZOOM_PP = 16;
function BandShift({ color, fromMin, fromMax, toMin, toMax }: { color: string; fromMin: number; fromMax: number; toMin: number; toMax: number }) {
  const centre = (Math.min(fromMin, toMin) + Math.max(fromMax, toMax)) / 2;
  const lo = Math.max(0, centre - ZOOM_PP / 2);
  const pct = (v: number) => `${((v - lo) / ZOOM_PP) * 100}%`;
  const width = (a: number, b: number) => `${((b - a) / ZOOM_PP) * 100}%`;
  return (
    <div className="relative h-4 bg-black/[0.03] rounded-md">
      <div className="absolute top-0.5 bottom-0.5 rounded border border-dashed" style={{ left: pct(fromMin), width: width(fromMin, fromMax), borderColor: color, opacity: 0.7 }} />
      <div className="absolute top-1 bottom-1 rounded-sm" style={{ left: pct(toMin), width: width(toMin, toMax), backgroundColor: color, opacity: 0.85 }} />
    </div>
  );
}

export function RegimeShiftCard({ history, portfolioValue }: { history?: RegimeHistory | null; portfolioValue: number }) {
  if (!history || history.points.length === 0) return null;
  const current = history.points[history.points.length - 1].regime;
  const change = history.change;
  const shifts = change ? sleeveShifts(change.from, change.to) : [];
  const moved = shifts.filter((s) => s.delta !== 0);
  const up = moved.filter((s) => s.delta > 0).map((s) => `${s.name} (+${s.delta}pp)`);
  const down = moved.filter((s) => s.delta < 0).map((s) => `${s.name} (−${Math.abs(s.delta)}pp)`);
  const days = change ? daysSince(change.date) : 0;

  return (
    <Card>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <CardTitle>Regime Shift — What Moved the Targets</CardTitle>
          <p className="text-xs text-black/40 mt-1">When the economic season last changed, and how that moved each sleeve&apos;s target band</p>
        </div>
        {change && (
          <div className="sm:text-right">
            <p className="text-[10px] uppercase tracking-wider text-black/35">Last change</p>
            <p className="text-lg font-semibold text-black/85 tabular-nums">{fmtDate(change.date)}</p>
            <p className="text-xs text-black/45 tabular-nums">{days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}</p>
          </div>
        )}
      </div>

      {change ? (
        <>
          <div className="mt-4 flex items-center gap-2.5 flex-wrap">
            <RegimePill regime={change.from} />
            <svg className="w-5 h-5 text-black/35" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
            <RegimePill regime={change.to} />
          </div>
          <p className="text-sm text-black/60 leading-relaxed mt-3 max-w-3xl">
            {moved.length === 0
              ? 'The two regimes carry the same tilts, so no sleeve target moved.'
              : <>Targets shifted {up.length > 0 && <>toward <span className="font-medium text-black/75">{up.join(', ')}</span></>}{up.length > 0 && down.length > 0 && ' and '}{down.length > 0 && <>away from <span className="font-medium text-black/75">{down.join(', ')}</span></>}. The rebalance rules now trade to the new bands.</>}
          </p>
        </>
      ) : (
        <p className="text-sm text-black/60 leading-relaxed mt-3">
          No regime change in the last three years — <span className="font-medium text-black/75">{REGIME_META[current].name}</span> since at least {fmtDate(history.windowStart, { month: 'short', year: 'numeric' })}.
        </p>
      )}

      <RegimeTimeline history={history} />

      {change && (
        <div className="mt-5 divide-y divide-black/[0.04]">
          {shifts.map((s) => {
            const usd = (s.delta / 100) * portfolioValue;
            return (
              <div key={s.name} className="py-2.5 grid grid-cols-[1fr_auto] sm:grid-cols-[9rem_1fr_9rem_6.5rem] items-center gap-x-4 gap-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
                  <span className="text-sm font-medium text-black/75 truncate">{s.name}</span>
                </div>
                <div className="col-span-2 sm:col-span-1 order-3 sm:order-none"><BandShift {...s} /></div>
                <div className="text-xs tabular-nums text-black/45 col-span-2 sm:col-span-1 order-4 sm:order-none">
                  <span className="text-black/35 line-through decoration-black/20">{s.fromMin}–{s.fromMax}%</span>
                  <span className="mx-1 text-black/30">→</span>
                  <span className="font-medium text-black/75">{s.toMin}–{s.toMax}%</span>
                </div>
                <div className="text-right order-2 sm:order-none">
                  {s.delta === 0 ? (
                    <span className="text-xs text-black/35">unchanged</span>
                  ) : (
                    <span className={`inline-flex flex-col items-end leading-tight ${s.delta > 0 ? 'text-accent-green' : 'text-accent-red'}`}>
                      <span className="text-sm font-semibold tabular-nums">{s.delta > 0 ? '▲ +' : '▼ −'}{Math.abs(s.delta)}pp</span>
                      <span className="text-[11px] tabular-nums opacity-80">{s.delta > 0 ? '+' : '−'}{formatCurrency(Math.abs(usd), { decimals: 0 })} target</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
          <p className="pt-2.5 text-[11px] text-black/40">
            Dashed outline = old band, solid = new band. Dollar amounts are the target change at today&apos;s portfolio value, not trades — the Strategic Rebalance Rules card below says what (if anything) to actually do.
          </p>
        </div>
      )}

      <Explainer title="How is the change date found?">
        <p>
          The dashboard re-runs today&apos;s regime model at the end of each of the last 36 months, using the same economic data it already has, then narrows the switch to the day. Each colored block above is one month.
        </p>
        <p>
          <span className="font-medium text-black/70">Treat the date as approximate.</span> The replay uses today&apos;s revised numbers, not what was published at the time, and the regime only changes when new data is released. The model also flips fairly often (about every 4–5 months in 2005–2024 testing), which is why a regime change alone never triggers an &ldquo;act now&rdquo; trade.
        </p>
        <p>
          Each regime nudges the sleeve <Term k="sleeve">target bands</Term> by a fixed number of points that add up to about zero, so only the mix changes. Conviction Core (SPCX) is never tilted — it follows its own 5-year build rules.
        </p>
      </Explainer>
    </Card>
  );
}
