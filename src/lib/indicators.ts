// Technical indicators computed from daily closes. Replaces the Massive
// (Polygon) /v1/indicators endpoints so price history alone (Alpaca's free
// plan) is enough. Each function returns one point per bar once its window has
// filled, oldest first, keyed by the bar's date.

export interface IndicatorBar {
  date: string;
  close: number;
}

export interface IndicatorPoint {
  date: string;
  value: number;
}

export interface MACDValue {
  date: string;
  macd: number;
  signal: number;
  histogram: number;
}

export function computeSMA(bars: IndicatorBar[], window: number): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].close;
    if (i >= window) sum -= bars[i - window].close;
    if (i >= window - 1) out.push({ date: bars[i].date, value: sum / window });
  }
  return out;
}

// Exponential average seeded with the plain average of the first `window` values.
function emaSeries(values: number[], window: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  if (values.length < window) return out;
  const k = 2 / (window + 1);
  let prev = values.slice(0, window).reduce((s, v) => s + v, 0) / window;
  out[window - 1] = prev;
  for (let i = window; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

export function computeEMA(bars: IndicatorBar[], window: number): IndicatorPoint[] {
  const series = emaSeries(bars.map((b) => b.close), window);
  return bars.flatMap((b, i) => (series[i] == null ? [] : [{ date: b.date, value: series[i]! }]));
}

// Wilder's RSI: the first average gain/loss is a plain mean of `window`
// changes, then each step keeps (window - 1)/window of the previous average.
export function computeRSI(bars: IndicatorBar[], window = 14): IndicatorPoint[] {
  const out: IndicatorPoint[] = [];
  if (bars.length <= window) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= window; i++) {
    const change = bars[i].close - bars[i - 1].close;
    if (change > 0) gain += change; else loss -= change;
  }
  gain /= window;
  loss /= window;
  const rsi = () => (loss === 0 ? 100 : 100 - 100 / (1 + gain / loss));
  out.push({ date: bars[window].date, value: rsi() });
  for (let i = window + 1; i < bars.length; i++) {
    const change = bars[i].close - bars[i - 1].close;
    gain = (gain * (window - 1) + Math.max(change, 0)) / window;
    loss = (loss * (window - 1) + Math.max(-change, 0)) / window;
    out.push({ date: bars[i].date, value: rsi() });
  }
  return out;
}

export function computeMACD(
  bars: IndicatorBar[],
  shortWindow = 12,
  longWindow = 26,
  signalWindow = 9
): MACDValue[] {
  const closes = bars.map((b) => b.close);
  const fast = emaSeries(closes, shortWindow);
  const slow = emaSeries(closes, longWindow);
  const macdIdx: number[] = [];
  const macd: number[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (fast[i] == null || slow[i] == null) continue;
    macdIdx.push(i);
    macd.push(fast[i]! - slow[i]!);
  }
  const signal = emaSeries(macd, signalWindow);
  const out: MACDValue[] = [];
  for (let j = 0; j < macd.length; j++) {
    if (signal[j] == null) continue;
    out.push({ date: bars[macdIdx[j]].date, macd: macd[j], signal: signal[j]!, histogram: macd[j] - signal[j]! });
  }
  return out;
}
