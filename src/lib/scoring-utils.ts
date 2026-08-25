// Shared scoring primitives — piecewise-linear metric scoring and percentile
// helpers, used by the fundamentals score (lib/fundamentals-score.ts) and the
// volatility/bottom-timing engine (lib/vol-signals.ts).

/** [metricValue, points] — anchors sorted ascending by value; clamped at both ends */
export type Anchor = readonly [number, number];

export const round1 = (v: number) => Math.round(v * 10) / 10;

/**
 * Piecewise-linear scoring: maps a value through anchor points with linear
 * interpolation between them, so scores change smoothly instead of jumping a
 * whole bucket on data noise. Works for descending point curves too (lower is
 * better) as long as anchors are sorted ascending by value.
 */
export function lerpScore(value: number | null, anchors: readonly Anchor[] | null): number | null {
  if (value === null || anchors === null || !Number.isFinite(value)) return null;
  if (value <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (value >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i - 1];
    const [x2, y2] = anchors[i];
    if (value <= x2) {
      const t = (value - x1) / (x2 - x1);
      return round1(y1 + t * (y2 - y1));
    }
  }
  return last[1];
}

/**
 * Percentile rank of `value` within `series` (0..1), using the midpoint
 * convention for ties so a value equal to many others doesn't read as extreme.
 */
export function percentileRank(value: number, series: number[]): number {
  if (series.length === 0) return 0.5;
  let less = 0;
  let equal = 0;
  for (const v of series) {
    if (v < value) less++;
    else if (v === value) equal++;
  }
  return (less + equal * 0.5) / series.length;
}
