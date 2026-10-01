// Regime history — replays assessEconomy at past dates on the data the dashboard
// already fetched, so "when did the regime last change, and from what?" costs no
// extra FRED requests. Caveat: the replay uses today's (revised) data, not what was
// known at the time, so the change date is approximate — see docs/regime-validation.md
// for the point-in-time study.

import { assessEconomy } from './economy';
import { REGIME_SLEEVE_TILT, SLEEVE_CONFIG, type RegimeKey } from './sleeves';
import type { Observation } from './time-series';

export interface RegimePoint { asOf: string; regime: RegimeKey }

export interface RegimeChange {
  /** First day the current regime reads (narrowed to the day by bisection between month-ends). */
  date: string;
  from: RegimeKey;
  to: RegimeKey;
}

export interface RegimeHistory {
  /** Month-end snapshots, oldest first; the last point is today's live call. */
  points: RegimePoint[];
  /** null when the regime has not changed within the replay window. */
  change: RegimeChange | null;
  windowStart: string;
}

export const REGIME_HISTORY_MONTHS = 36;

const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, n: number) => day(new Date(Date.parse(iso) + n * 86400000));
const monthEnd = (y: number, m: number) => day(new Date(Date.UTC(y, m + 1, 0)));

export function buildRegimeHistory(
  data: Record<string, Observation[]>,
  current: RegimeKey,
  asOf = day(new Date()),
  months = REGIME_HISTORY_MONTHS,
  regimeAt: (date: string) => RegimeKey = (d) => assessEconomy(data, d).regime,
): RegimeHistory {
  const t = new Date(`${asOf}T00:00:00Z`);
  const points: RegimePoint[] = [];
  for (let i = months; i >= 1; i--) {
    const d = monthEnd(t.getUTCFullYear(), t.getUTCMonth() - i);
    points.push({ asOf: d, regime: regimeAt(d) });
  }
  points.push({ asOf, regime: current });

  // Walk back to the start of the current run.
  let i = points.length - 1;
  while (i > 0 && points[i - 1].regime === current) i--;
  if (i === 0) return { points, change: null, windowStart: points[0].asOf };

  // Bisect the days between the last month-end of the old regime and the first of the new.
  let lo = points[i - 1].asOf, hi = points[i].asOf;
  while (Date.parse(hi) - Date.parse(lo) > 86400000) {
    const mid = addDays(lo, Math.floor((Date.parse(hi) - Date.parse(lo)) / 86400000 / 2));
    if (regimeAt(mid) === current) hi = mid; else lo = mid;
  }
  return { points, change: { date: hi, from: points[i - 1].regime, to: current }, windowStart: points[0].asOf };
}

export interface SleeveShift {
  name: string;
  color: string;
  fromMin: number; fromMax: number;
  toMin: number; toMax: number;
  /** New tilt minus old tilt, in percentage points. */
  delta: number;
}

// How each sleeve's target band moved between two regimes (base band + tilt, clamped >= 0).
export function sleeveShifts(from: RegimeKey, to: RegimeKey): SleeveShift[] {
  return SLEEVE_CONFIG.map((s) => {
    const a = REGIME_SLEEVE_TILT[from]?.[s.name] ?? 0;
    const b = REGIME_SLEEVE_TILT[to]?.[s.name] ?? 0;
    return {
      name: s.name, color: s.color,
      fromMin: Math.max(0, s.targetMin + a), fromMax: Math.max(0, s.targetMax + a),
      toMin: Math.max(0, s.targetMin + b), toMax: Math.max(0, s.targetMax + b),
      delta: b - a,
    };
  });
}
