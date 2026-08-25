// Volatility signal + Bottom Timing Score engine — shared between the
// Portfolio Analytics and Watchlist Analytics pages so the methodology never
// drifts between the two (same reason lib/sleeves.ts exists).
//
// ═══ METHODOLOGY (v2) ═══
//
// All signal math runs over the FULL fetched lookback (~1 year of daily bars),
// regardless of which display period the user has selected — a stock's
// drawdown, vol percentile, and price position are properties of the stock,
// not of the chart tab. (v1 computed everything over the selected period,
// which made the same stock score differently per tab and blanked the whole
// section on 1M, where 21 trading bars failed the 30-bar minimum.)
//
// Volatility signals combine four ingredients:
//   • Vol regime — current 20-day rolling vol as a percentile of the stock's
//     own rolling-vol history (is it unusually stormy or calm, for THIS stock).
//   • Price position & drawdown — where price sits in the 1Y range.
//   • Vol mean-reversion state — has the vol spike peaked and turned? Entries
//     into still-rising volatility are knife-catching; the buy-zone signal now
//     REQUIRES vol to be past its peak, otherwise it stays "Capitulation Watch".
//   • Trend filter — price vs its own 200-day moving average. High vol near
//     the lows of an intact uptrend is a dip; the same picture below a falling
//     200-day trend is a downtrend rebound bet and is labeled as such.
// Momentum is measured in units of the stock's own 20-day sigma (a +5% month
// is "strong" for VTV and noise for a 60%-vol name).
//
// The Bottom Timing Score (0–100) grades how consistent conditions are with a
// capitulation low, using smooth piecewise-linear scoring (no bucket cliffs):
//   Drawdown severity (20) · Vol spike percentile (15) · Down-day volume (15)
//   · VIX (15) · HY credit spread (10) · Price position (10) · Vol
//   mean-reversion (15).
// Down-day volume only counts volume on days the stock CLOSED DOWN — an
// earnings pop or index-rebalance print no longer reads as capitulation.
// VIX and HY spreads score on the max of their absolute level (classic-regime
// anchors) and their percentile within trailing ~3y history (regime-aware),
// with the percentile path capped below the absolute path so a full score
// still requires genuinely extreme levels.
// Components with missing data (volume history, VIX, HY) are reported as
// unavailable and excluded from the achievable maximum — the score displays
// as X / maxPossible instead of silently reading "calm".
// Note the deliberate ceiling: with a calm market (VIX + HY near zero points),
// a single-name crash tops out at ~75 — "Extreme Capitulation" is reserved
// for stock capitulation confirmed by market-wide stress.

import { type Anchor, lerpScore, percentileRank, round1 } from './scoring-utils';

// ─── Basic math (shared by the analytics pages' other sections too) ───

export interface Bar {
  date: string;
  close: number;
  volume: number;
}

export function computeReturns(closes: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  return returns;
}

export function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function stdDev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const aSlice = a.slice(-n);
  const bSlice = b.slice(-n);
  const ma = mean(aSlice);
  const mb = mean(bSlice);
  const sa = stdDev(aSlice);
  const sb = stdDev(bSlice);
  if (sa === 0 || sb === 0) return 0;
  let cov = 0;
  for (let i = 0; i < n; i++) {
    cov += (aSlice[i] - ma) * (bSlice[i] - mb);
  }
  cov /= n - 1;
  return cov / (sa * sb);
}

/**
 * Zero-mean (RMS) volatility of a return series. For the rolling-vol regime
 * series we deliberately do NOT subtract the window mean: centered stdev peaks
 * when a calm→crash boundary passes through the window (mixed regimes inflate
 * dispersion around the mean) and reads a steady -4%/day grind as "calm".
 * RMS tracks the magnitude of moves, so "vol past peak" fires when panic
 * actually subsides — which is what the mean-reversion signal is for.
 */
export function rmsVol(returns: number[]): number {
  if (returns.length === 0) return 0;
  return Math.sqrt(returns.reduce((s, r) => s + r * r, 0) / returns.length);
}

export function corrColor(r: number): string {
  if (r > 0.7) return 'bg-accent-red/20 text-red-800';
  if (r > 0.4) return 'bg-accent-orange/15 text-orange-700';
  if (r > 0.1) return 'bg-accent-orange/[0.06] text-orange-600';
  if (r > -0.1) return 'bg-black/[0.04] text-black/55';
  if (r > -0.4) return 'bg-accent-blue/[0.06] text-blue-600';
  if (r > -0.7) return 'bg-accent-blue/15 text-blue-700';
  return 'bg-accent-blue/25 text-blue-800';
}

// ─── Per-stock volatility stats (full-lookback) ───

export interface VolStats {
  symbol: string;
  category: string;
  currentPrice: number;
  /** annualized 20-day rolling vol, % */
  currentVol: number;
  /** median of all 20-day rolling vols over the lookback, % */
  medianVol: number;
  /** percentile of current vol within its own rolling-vol history, 0..1 */
  volPercentile: number;
  /** 0 = at lookback low, 1 = at lookback high */
  pricePosition: number;
  /** 20-day price return, % */
  momentum20d: number;
  /** momentum20d expressed in units of the stock's own expected 20-day sigma */
  momentumSigma: number;
  /** % from lookback high (negative) */
  drawdown: number;
  /** chronological 20-day rolling vols (annualized, %) */
  rollingVols: number[];
  /** vol spike has peaked and pulled back >10% from its recent (30-window) peak */
  volPastPeak: boolean;
  /** rolling vol lower than 3 windows ago — early sign the spike is fading */
  volDeclining: boolean;
  /** price vs 200-day SMA: % above (positive) / below; null if <200 bars */
  trendPct: number | null;
  /** null when <200 bars of history */
  aboveTrend: boolean | null;
  barsUsed: number;
}

/**
 * Compute signal stats from the FULL fetched history (pass unsliced ~1Y bars).
 * Returns null below 30 bars (not enough for a stable rolling-vol history).
 */
export function computeVolStats(symbol: string, category: string, bars: Bar[]): VolStats | null {
  const closes = bars.map((b) => b.close);
  if (closes.length < 30) return null;

  // Chronological 20-day rolling vols — zero-mean RMS, see rmsVol() for why
  const rollingVols: number[] = [];
  for (let i = 20; i < closes.length; i++) {
    const w = computeReturns(closes.slice(i - 20, i + 1));
    rollingVols.push(rmsVol(w) * Math.sqrt(252) * 100);
  }
  const currentVol = rollingVols[rollingVols.length - 1] ?? 0;

  const sortedVols = [...rollingVols].sort((a, b) => a - b);
  const medianVol = sortedVols[Math.floor(sortedVols.length / 2)] || currentVol;
  const volPercentile = percentileRank(currentVol, rollingVols);

  const lookbackHigh = Math.max(...closes);
  const lookbackLow = Math.min(...closes);
  const currentPrice = closes[closes.length - 1];
  const range = lookbackHigh - lookbackLow;
  const pricePosition = range > 0 ? (currentPrice - lookbackLow) / range : 0.5;

  const momentum20d = closes.length >= 21
    ? ((currentPrice - closes[closes.length - 21]) / closes[closes.length - 21]) * 100
    : 0;
  // Expected 20-day move at current vol: dailyVol × √20 (as %)
  const dailyVol20 = stdDev(computeReturns(closes.slice(-21)));
  const expected20d = dailyVol20 * Math.sqrt(20) * 100;
  const momentumSigma = expected20d > 0 ? momentum20d / expected20d : 0;

  const drawdown = ((currentPrice - lookbackHigh) / lookbackHigh) * 100;

  // Vol mean-reversion state — peak over the last 30 windows (~6 weeks), so a
  // spike a few weeks back that's been fading steadily still registers.
  const recentPeak = Math.max(...rollingVols.slice(-30));
  const volPastPeak = recentPeak > 0 && (recentPeak - currentVol) / recentPeak > 0.10;
  const volDeclining = rollingVols.length >= 3
    && currentVol < rollingVols[rollingVols.length - 3];

  // Trend filter: 200-day SMA from the same bars (no extra API call)
  let trendPct: number | null = null;
  let aboveTrend: boolean | null = null;
  if (closes.length >= 200) {
    const sma200 = mean(closes.slice(-200));
    if (sma200 > 0) {
      trendPct = ((currentPrice - sma200) / sma200) * 100;
      aboveTrend = currentPrice >= sma200;
    }
  }

  return {
    symbol, category, currentPrice, currentVol, medianVol, volPercentile,
    pricePosition, momentum20d, momentumSigma, drawdown, rollingVols,
    volPastPeak, volDeclining, trendPct, aboveTrend, barsUsed: closes.length,
  };
}

// ─── Signal classification ───

export type SignalMode = 'holdings' | 'watchlist';

export interface VolSignal {
  signal: string;
  badge: 'green' | 'blue' | 'orange' | 'red' | 'neutral';
  reason: string;
  /** capitulation-flavored signals that warrant showing the Bottom Timing Score */
  isBottomCandidate: boolean;
}

export function getVolSignal(s: VolStats, mode: SignalMode = 'holdings'): VolSignal {
  const volExpanded = s.volPercentile > 0.75;
  const volContracted = s.volPercentile < 0.25;
  const nearLow = s.pricePosition < 0.25;
  const nearHigh = s.pricePosition > 0.85;
  const strongMomentum = s.momentumSigma > 1; // >1σ of the stock's OWN expected 20d move
  const deepDrawdown = s.drawdown < -15;
  const belowTrend = s.aboveTrend === false;
  const distressed = volExpanded && (nearLow || deepDrawdown);
  const watch = mode === 'watchlist';

  const volDesc = `${s.currentVol.toFixed(0)}% vs median ${s.medianVol.toFixed(0)}%`;
  const trendDesc = s.trendPct !== null
    ? `${s.trendPct >= 0 ? '+' : ''}${s.trendPct.toFixed(1)}% vs its 200-day average`
    : 'trend unknown (short history)';

  // 1. Distressed but vol has NOT peaked yet — the cautious read wins.
  //    (v1 checked "buy zone" first, so the most dangerous overlap — near lows
  //    AND deep drawdown with vol still rising — got the green badge.)
  if (distressed && !s.volPastPeak) {
    return {
      signal: 'Capitulation Watch',
      badge: 'blue',
      isBottomCandidate: true,
      reason: `Down ${Math.abs(s.drawdown).toFixed(1)}% from its 1Y high with volatility ${s.volPercentile > 0.9 ? 'in the top 10%' : 'in the top 25%'} of its own range (${volDesc}) — and the vol spike has not peaked yet. ${watch ? 'Not an entry yet: ' : ''}capitulation can mark bottoms, but adding while volatility is still rising is knife-catching. Wait for vol to roll over${belowTrend ? ` — note it's also ${trendDesc}, so any bounce is against the trend` : ''}.`,
    };
  }

  // 2. Distressed AND vol has peaked — entry window, split by trend.
  if (distressed && s.volPastPeak) {
    if (belowTrend) {
      return {
        signal: 'Rebound Watch — Downtrend',
        badge: 'orange',
        isBottomCandidate: true,
        reason: `Volatility has peaked and is fading (${volDesc}) with price near its 1Y lows (${s.drawdown.toFixed(1)}% from high) — but the stock sits ${trendDesc}. That makes this a downtrend rebound bet, not a dip in an uptrend: historically the weaker setup. ${watch ? 'If entering, start small' : 'If adding, scale slowly'} and let a reclaim of the 200-day trend upgrade the signal.`,
      };
    }
    return {
      signal: watch ? 'Entry Window Opening' : 'Potential Buy Zone',
      badge: 'green',
      isBottomCandidate: true,
      reason: `Volatility spiked and has now peaked and turned (${volDesc}) while price sits near its 1Y lows (${s.drawdown.toFixed(1)}% from high)${s.trendPct !== null ? `, with the longer trend intact (${trendDesc})` : ''}. Fear passing its crest near depressed prices is historically the best risk/reward entry — ${watch ? 'consider scaling in if the fundamentals pass the quality gate below' : 'consider scaling in if your thesis is intact'}.`,
    };
  }

  // 3. Calm, extended, and running hot — risk management, not prediction.
  if (volContracted && nearHigh && strongMomentum) {
    return {
      signal: watch ? 'Extended — Wait for Pullback' : 'Extended — Watch Risk',
      badge: 'orange',
      isBottomCandidate: false,
      reason: watch
        ? `Price is near its 1Y highs after a ${s.momentumSigma.toFixed(1)}σ 20-day run (${s.momentum20d.toFixed(1)}%) with unusually calm volatility (bottom 25% of its range). Chasing strength after an outsized move is a poor entry price — keep it on watch and let it pull back or consolidate.`
        : `Price is near its 1Y highs after a ${s.momentumSigma.toFixed(1)}σ 20-day run (${s.momentum20d.toFixed(1)}%) with unusually calm volatility (bottom 25%). Compressed vol often precedes a sharp move. No action required by itself — the sleeve bands and sell rules decide trims, not this signal — but know this position is priced for calm.`,
    };
  }

  // 4. Vol expanding into the highs — distribution risk.
  if (volExpanded && nearHigh) {
    return {
      signal: 'Caution — Elevated Risk',
      badge: 'red',
      isBottomCandidate: false,
      reason: `Price is near its 1Y highs but volatility is expanding (${volDesc}, top 25% of its range). Turbulence into strength can mark distribution. ${watch ? 'Hold off on new entries until vol settles or price consolidates.' : 'Watch for failed breakouts; if a trim is due under the rebalance rules, this is a reasonable time to take it.'}`,
    };
  }

  // 5. Quiet near the lows — coiled spring, direction unknown.
  if (volContracted && nearLow) {
    return {
      signal: 'Coiling — Watch for Breakout',
      badge: 'blue',
      isBottomCandidate: false,
      reason: `Volatility is compressed (bottom 25% of its range) while price sits near its 1Y lows${belowTrend ? `, ${trendDesc}` : ''}. This "coiling" often precedes a significant directional move — but it can break either way. Wait for a clear breakout with volume before ${watch ? 'entering' : 'adding'}.`,
    };
  }

  // 6. Nothing extreme.
  return {
    signal: watch ? 'No Edge — Monitor' : 'Neutral',
    badge: 'neutral',
    isBottomCandidate: false,
    reason: `Volatility is near its historical median (${volDesc}) with no extreme price positioning${s.trendPct !== null ? ` (${trendDesc})` : ''}. Timing offers no edge here — ${watch ? 'let fundamentals and price decide when this earns a closer look' : 'fundamentals and the rebalance bands are the guide'}.`,
  };
}

// ─── Bottom Timing Score ───

export interface BottomScoreBreakdown {
  total: number;
  /** achievable maximum given available data (100 when everything is present) */
  maxPossible: number;
  drawdownPts: number;
  volSpikePts: number;
  volumePts: number;
  vixPts: number;
  hySpreadPts: number;
  pricePositionPts: number;
  volMeanReversionPts: number;
  /** components excluded from maxPossible because their data was missing */
  unavailable: Array<'volume' | 'vix' | 'hySpread'>;
  grade: 'Extreme Capitulation' | 'Heavy Selling' | 'Moderate Distress' | 'Mild Weakness' | 'No Signal';
  gradeColor: string;
}

const DRAWDOWN_ANCHORS: readonly Anchor[] = [[5, 0], [10, 5], [15, 10], [20, 14], [25, 17], [30, 20]];
const VOL_SPIKE_ANCHORS: readonly Anchor[] = [[0.5, 0], [0.6, 4], [0.75, 8], [0.9, 12], [0.95, 15]];
const DOWN_VOLUME_ANCHORS: readonly Anchor[] = [[1, 0], [1.5, 5], [2, 10], [3, 15]];
const VIX_LEVEL_ANCHORS: readonly Anchor[] = [[18, 0], [20, 4], [25, 8], [30, 12], [40, 15]];
const VIX_PCTL_ANCHORS: readonly Anchor[] = [[0.5, 0], [0.75, 4], [0.85, 8], [0.95, 12]];
const HY_LEVEL_ANCHORS: readonly Anchor[] = [[3.5, 0], [4, 3], [5, 5], [6, 7], [8, 10]];
const HY_PCTL_ANCHORS: readonly Anchor[] = [[0.5, 0], [0.75, 3], [0.85, 5], [0.95, 8]];
const PRICE_POS_ANCHORS: readonly Anchor[] = [[0.1, 10], [0.2, 7], [0.3, 4], [0.35, 0]];
const VOL_REVERT_ANCHORS: readonly Anchor[] = [[0.1, 10], [0.25, 15]];

/** ~3 trading years — the trailing window for VIX/HY percentile context */
const MACRO_PCTL_WINDOW = 750;
const MACRO_PCTL_MIN_OBS = 250;

/**
 * Score a macro stress series on the max of its absolute level (classic-regime
 * anchors) and its percentile within trailing history (regime-aware). The
 * percentile path is capped below the level path's max, so a full score still
 * requires genuinely extreme absolute readings.
 */
function scoreMacroStress(
  series: Array<{ value: number }> | undefined,
  levelAnchors: readonly Anchor[],
  pctlAnchors: readonly Anchor[],
): number | null {
  if (!series || series.length === 0) return null;
  const latest = series[series.length - 1].value;
  const levelPts = lerpScore(latest, levelAnchors) ?? 0;

  const trailing = series.slice(-MACRO_PCTL_WINDOW).map((d) => d.value);
  if (trailing.length < MACRO_PCTL_MIN_OBS) return levelPts;
  const pctl = percentileRank(latest, trailing);
  const pctlPts = lerpScore(pctl, pctlAnchors) ?? 0;
  return round1(Math.max(levelPts, pctlPts));
}

/**
 * Compute the Bottom Timing Score from full-lookback stats and bars.
 * `vixSeries` / `hySeries` are the raw FRED series (full history, ascending).
 */
export function computeBottomScore(
  s: VolStats,
  bars: Bar[],
  vixSeries: Array<{ date: string; value: number }> | undefined,
  hySeries: Array<{ date: string; value: number }> | undefined,
): BottomScoreBreakdown {
  const unavailable: BottomScoreBreakdown['unavailable'] = [];

  // 1. Drawdown severity (0-20)
  const drawdownPts = lerpScore(Math.abs(s.drawdown), DRAWDOWN_ANCHORS) ?? 0;

  // 2. Volatility spike (0-15)
  const volSpikePts = lerpScore(s.volPercentile, VOL_SPIKE_ANCHORS) ?? 0;

  // 3. Down-day volume capitulation (0-15) — only volume on days the stock
  //    closed down counts; the baseline is the average daily volume before the
  //    last 5 sessions.
  let volumePts = 0;
  if (bars.length >= 25) {
    const baselineBars = bars.slice(0, -5);
    const avgVol = mean(baselineBars.map((b) => b.volume));
    let maxDownVol = 0;
    for (let i = Math.max(1, bars.length - 5); i < bars.length; i++) {
      if (bars[i].close < bars[i - 1].close) {
        maxDownVol = Math.max(maxDownVol, bars[i].volume);
      }
    }
    const ratio = avgVol > 0 ? maxDownVol / avgVol : 0;
    volumePts = lerpScore(ratio, DOWN_VOLUME_ANCHORS) ?? 0;
  } else {
    unavailable.push('volume');
  }

  // 4. VIX (0-15) — max of absolute level and trailing-3y percentile
  const vixScore = scoreMacroStress(vixSeries, VIX_LEVEL_ANCHORS, VIX_PCTL_ANCHORS);
  const vixPts = vixScore ?? 0;
  if (vixScore === null) unavailable.push('vix');

  // 5. HY credit spread (0-10) — same treatment
  const hyScore = scoreMacroStress(hySeries, HY_LEVEL_ANCHORS, HY_PCTL_ANCHORS);
  const hySpreadPts = hyScore ?? 0;
  if (hyScore === null) unavailable.push('hySpread');

  // 6. Price position (0-10)
  const pricePositionPts = lerpScore(s.pricePosition, PRICE_POS_ANCHORS) ?? 0;

  // 7. Vol mean reversion (0-15) — full points only once the spike has peaked
  //    and is fading; scaled by how far it has pulled back from the peak.
  let volMeanReversionPts = 0;
  if (s.rollingVols.length >= 3) {
    const recentPeak = Math.max(...s.rollingVols.slice(-30));
    const declineFrac = recentPeak > 0 ? (recentPeak - s.currentVol) / recentPeak : 0;
    if (declineFrac > 0.10 && s.volPercentile > 0.60) {
      volMeanReversionPts = lerpScore(declineFrac, VOL_REVERT_ANCHORS) ?? 0;
    } else if (s.volPercentile > 0.90) {
      volMeanReversionPts = 8; // at an extreme but hasn't peaked yet
    } else if (s.volDeclining && s.volPercentile > 0.50) {
      volMeanReversionPts = 5; // starting to fade from elevated levels
    }
  }

  const maxPossible = 100
    - (unavailable.includes('volume') ? 15 : 0)
    - (unavailable.includes('vix') ? 15 : 0)
    - (unavailable.includes('hySpread') ? 10 : 0);

  const total = Math.round(
    drawdownPts + volSpikePts + volumePts + vixPts + hySpreadPts + pricePositionPts + volMeanReversionPts
  );

  let grade: BottomScoreBreakdown['grade'];
  let gradeColor: string;
  if (total >= 75) {
    grade = 'Extreme Capitulation';
    gradeColor = 'bg-accent-red/15 text-red-700 border-accent-red/20';
  } else if (total >= 55) {
    grade = 'Heavy Selling';
    gradeColor = 'bg-accent-orange/15 text-orange-700 border-accent-orange/20';
  } else if (total >= 35) {
    grade = 'Moderate Distress';
    gradeColor = 'bg-accent-blue/15 text-blue-700 border-accent-blue/20';
  } else if (total >= 20) {
    grade = 'Mild Weakness';
    gradeColor = 'bg-black/[0.06] text-black/65 border-black/[0.08]';
  } else {
    grade = 'No Signal';
    gradeColor = 'bg-black/[0.04] text-black/45 border-black/[0.06]';
  }

  return {
    total, maxPossible,
    drawdownPts: round1(drawdownPts),
    volSpikePts: round1(volSpikePts),
    volumePts: round1(volumePts),
    vixPts: round1(vixPts),
    hySpreadPts: round1(hySpreadPts),
    pricePositionPts: round1(pricePositionPts),
    volMeanReversionPts: round1(volMeanReversionPts),
    unavailable, grade, gradeColor,
  };
}
