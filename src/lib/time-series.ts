// Pure, date-aware transformations. Missing periods stay missing.
export interface Observation { date: string; value: number | null }
export interface Point { date: string; value: number }

export function cleanSeries(series: Observation[], asOf = '9999-12-31'): Point[] {
  const values = new Map<string, number>();
  for (const p of series) {
    const date = p.date.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date <= asOf && p.value !== null && Number.isFinite(p.value)) values.set(date, p.value);
  }
  return Array.from(values).sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, value }));
}

export function monthOffset(date: string, months: number): string {
  const d = new Date(`${date.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 7);
}

export function monthlyMean(series: Observation[], asOf?: string): Point[] {
  const groups = new Map<string, number[]>();
  for (const p of cleanSeries(series, asOf)) {
    const key = p.date.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), p.value]);
  }
  return Array.from(groups).map(([month, values]) => ({ date: `${month}-01`, value: values.reduce((a, b) => a + b, 0) / values.length }));
}

export function percentChange(series: Observation[], months = 12, annualized = false): Point[] {
  const points = cleanSeries(series);
  const byMonth = new Map(points.map(p => [p.date.slice(0, 7), p.value]));
  return points.flatMap(p => {
    const previous = byMonth.get(monthOffset(p.date, -months));
    if (previous === undefined || previous <= 0 || p.value <= 0) return [];
    return [{ date: p.date, value: ((p.value / previous) ** (annualized ? 12 / months : 1) - 1) * 100 }];
  });
}

export interface Close { date: string; close: number }
// Join price levels first, THEN compute identical holding-period returns.
// BTC therefore includes its weekend move in the next shared equity interval.
export function alignedReturns(series: Close[][]): { dates: string[]; returns: number[][] } {
  if (!series.length) return { dates: [], returns: [] };
  const maps = series.map(s => new Map(cleanSeries(s.map(p => ({ date: p.date, value: p.close }))).filter(p => p.value > 0).map(p => [p.date, p.value])));
  const dates = Array.from(maps[0].keys()).filter(d => maps.every(m => m.has(d))).sort();
  return { dates: dates.slice(1), returns: maps.map(m => dates.slice(1).map((d, i) => m.get(d)! / m.get(dates[i])! - 1)) };
}

export function covariance(a: number[], b: number[]): number | null {
  if (a.length !== b.length || a.length < 2) return null;
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  return a.reduce((s, v, i) => s + (v - ma) * (b[i] - mb), 0) / (a.length - 1);
}

export function datedCorrelation(a: Close[], b: Close[], minimum = 20): { value: number | null; observations: number } {
  const aligned = alignedReturns([a, b]);
  const [x, y] = aligned.returns;
  const observations = aligned.dates.length;
  if (observations < minimum) return { value: null, observations };
  const variance = covariance(x, x)! * covariance(y, y)!;
  return { value: variance > 0 ? Math.max(-1, Math.min(1, covariance(x, y)! / Math.sqrt(variance))) : null, observations };
}
