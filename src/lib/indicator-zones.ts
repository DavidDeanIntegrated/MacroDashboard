// One shared table of "what does this level mean" for the headline macro
// indicators. The Macro page indicator list and the Guide page both read from
// here, so a threshold can never drift between the two.
//
// Each zone function turns the latest level into a short label, a badge color,
// a one-line explanation, and a `tone` the Guide uses for its checklist.

export type ZoneBadge = 'green' | 'orange' | 'red' | 'blue' | 'neutral';
export type ZoneTone = 'bullish' | 'neutral' | 'bearish' | 'crisis';
export interface Zone { regime: string; badge: ZoneBadge; explanation: string; tone: ZoneTone }

export const INDICATOR_ZONES: Record<string, (v: number) => Zone> = {
  FEDFUNDS: (v) => {
    if (v < 1) return { regime: 'Crisis / Deflation', badge: 'blue', tone: 'crisis', explanation: 'Near-zero rates signal emergency conditions. The Fed has exhausted conventional tools and may be using QE.' };
    if (v < 2.5) return { regime: 'Goldilocks', badge: 'green', tone: 'bullish', explanation: 'Moderately low rates support asset valuations and economic growth without overheating.' };
    if (v < 4.5) return { regime: 'Reflation', badge: 'orange', tone: 'neutral', explanation: 'Rates are elevated — the Fed is tightening to combat inflation. Watch for yield curve inversion and slowing growth.' };
    return { regime: 'Restrictive / Stagflation risk', badge: 'red', tone: 'bearish', explanation: 'Very high rates compress multiples and raise recession risk. This level historically precedes downturns.' };
  },
  DGS2: (v) => {
    if (v < 1) return { regime: 'Deflation / Crisis', badge: 'blue', tone: 'crisis', explanation: 'Ultra-low short rates reflect expectations of prolonged easing or recession.' };
    if (v < 3) return { regime: 'Goldilocks', badge: 'green', tone: 'bullish', explanation: 'Moderate 2Y yield suggests the market expects stable, accommodative policy.' };
    if (v < 4.5) return { regime: 'Reflation', badge: 'orange', tone: 'neutral', explanation: 'Elevated 2Y yield shows the market pricing in more hikes or sustained tightness.' };
    return { regime: 'Stagflation risk', badge: 'red', tone: 'bearish', explanation: 'Very high short-term yields signal aggressive tightening expectations. Often precedes inversions and recessions.' };
  },
  DGS10: (v) => {
    if (v < 1.5) return { regime: 'Deflation / Crisis', badge: 'blue', tone: 'crisis', explanation: 'Ultra-low long rates signal a flight to safety. Investors accept near-zero returns for security.' };
    if (v < 3.5) return { regime: 'Goldilocks', badge: 'green', tone: 'bullish', explanation: 'Moderate long rates support equity valuations with a reasonable discount rate.' };
    if (v < 4.5) return { regime: 'Reflation', badge: 'orange', tone: 'neutral', explanation: 'Elevated yields reflect inflation expectations or rising term premium. Compressing equity multiples.' };
    return { regime: 'Restrictive', badge: 'red', tone: 'bearish', explanation: 'High long rates compete with equities for capital and raise government borrowing costs. Unsustainable above 5% for long.' };
  },
  T10Y2Y: (v) => {
    if (v < -0.3) return { regime: 'Recession warning', badge: 'red', tone: 'bearish', explanation: 'Deeply inverted curve. Historically signals recession within 6-24 months. Markets may not have priced in the risk yet.' };
    if (v < 0.1) return { regime: 'Late cycle', badge: 'orange', tone: 'neutral', explanation: 'Flat or slightly inverted curve. The economy is at a turning point — either heading into slowdown or the Fed is about to pivot.' };
    if (v < 1.5) return { regime: 'Goldilocks', badge: 'green', tone: 'bullish', explanation: 'Normal positive slope. Banks can lend profitably, credit flows freely, and growth expectations are healthy.' };
    return { regime: 'Early recovery', badge: 'blue', tone: 'bullish', explanation: 'Very steep curve typically occurs after Fed cuts — signals early recovery from recession. Bullish for cyclicals and banks.' };
  },
  CPIYOY: (v) => {
    if (v < 0) return { regime: 'Deflation / Depression', badge: 'blue', tone: 'crisis', explanation: 'Falling prices signal demand collapse. Consumers delay purchases, revenues shrink, debt burdens increase in real terms.' };
    if (v < 2.5) return { regime: 'Goldilocks', badge: 'green', tone: 'bullish', explanation: "Inflation in the Fed's comfort zone. No pressure to tighten. Supports steady growth and equity multiples." };
    if (v < 4) return { regime: 'Reflation', badge: 'orange', tone: 'neutral', explanation: 'Inflation above target but manageable. The Fed is likely tightening. Favors commodities and value over growth.' };
    return { regime: 'Stagflation risk', badge: 'red', tone: 'bearish', explanation: 'High inflation forces aggressive tightening, compresses margins, and erodes real returns. Historically very bearish for 60/40 portfolios.' };
  },
  UNRATE: (v) => {
    if (v > 8) return { regime: 'Depression / Crisis', badge: 'red', tone: 'crisis', explanation: 'Severe labor market deterioration. Requires massive fiscal stimulus. Historically, equities are near bottoms at these levels.' };
    if (v > 5.5) return { regime: 'Recession', badge: 'orange', tone: 'bearish', explanation: 'Unemployment at recessionary levels. The Fed is likely cutting aggressively. Defensive positioning and duration tend to outperform.' };
    if (v > 4.3) return { regime: 'Late cycle / Softening', badge: 'neutral', tone: 'neutral', explanation: 'Labor market softening from a strong base. Watch for Sahm Rule trigger. The cycle may be turning.' };
    return { regime: 'Expansion', badge: 'green', tone: 'bullish', explanation: 'Tight labor market supports consumer spending and wage growth. Favorable for risk assets when paired with moderate inflation.' };
  },
  BAMLH0A0HYM2: (v) => {
    if (v > 8) return { regime: 'Crisis / Panic', badge: 'red', tone: 'crisis', explanation: "Credit markets freezing. Companies can't refinance, defaults spike. The Fed typically intervenes with emergency facilities at these levels." };
    if (v > 5) return { regime: 'Stress / Bear', badge: 'orange', tone: 'bearish', explanation: 'Growing risk aversion. Weaker companies struggle to borrow. Often precedes equity sell-offs. Reduce credit exposure.' };
    if (v > 3.5) return { regime: 'Neutral', badge: 'neutral', tone: 'neutral', explanation: 'Credit conditions are normal. Not signaling stress, but not excessively loose either.' };
    return { regime: 'Risk-on / Bull', badge: 'green', tone: 'bullish', explanation: 'Very tight spreads indicate strong risk appetite and easy credit. Supportive of equity bull markets, but can signal complacency.' };
  },
  VIXCLS: (v) => {
    if (v > 40) return { regime: 'Extreme Fear / Capitulation', badge: 'red', tone: 'crisis', explanation: 'VIX above 40 signals panic selling and extreme fear. Historically rare and often marks major bottoms. Contrarian buy signal for long-term investors.' };
    if (v > 30) return { regime: 'High Fear', badge: 'orange', tone: 'bearish', explanation: 'Elevated fear — markets pricing in significant downside risk. Often seen during corrections. Conditions may be ripe for a reversal if catalysts emerge.' };
    if (v > 20) return { regime: 'Elevated Caution', badge: 'neutral', tone: 'neutral', explanation: 'Above-average volatility expectations. Market is uncertain but not panicking. Normal during mild pullbacks or ahead of major events.' };
    if (v > 12) return { regime: 'Calm / Normal', badge: 'green', tone: 'bullish', explanation: 'Low volatility reflects complacency and confidence. Supportive of steady equity gains, but extremely low VIX can precede sharp corrections.' };
    return { regime: 'Extreme Complacency', badge: 'blue', tone: 'neutral', explanation: 'VIX below 12 signals extreme complacency. Markets are pricing in near-zero risk. Historically, this level precedes volatility spikes and corrections.' };
  },
};

export function zoneSignal(key: string) {
  return (v: number): Zone => INDICATOR_ZONES[key](v);
}

// Which direction is "good news" for a rising reading. Anything not listed is
// treated as "rising = worse" (rates, inflation, spreads, volatility, unemployment).
export const HIGHER_IS_BETTER: Record<string, boolean> = {
  T10Y2Y: true, // un-inverting yield curve
  USALOLITONOSTSAM: true, // LEI
  UMCSENT: true, // consumer sentiment
  PERMIT: true, // building permits
  MANEMP: true, // manufacturing employment (YoY growth)
  M2SL: true, // M2 money supply (YoY growth)
  COREPCE: false, // rising core inflation pressures the Fed to stay tight
  T10YIE: false, // rising inflation expectations
};

// Color a change by whether it is good news, not by its sign.
export function changeTone(change: number, higherIsBetter: boolean, deadband = 0.1): 'up' | 'down' | 'neutral' {
  if (!Number.isFinite(change) || Math.abs(change) <= deadband) return 'neutral';
  return (change > 0) === higherIsBetter ? 'up' : 'down';
}

export type Trend = 'rising' | 'falling' | 'flat';
// Trend over a fixed calendar window (default one month), so a daily series and
// a monthly series are judged on the same horizon instead of "last 3 points".
export function trendOverDays(data: Array<{ date: string; value: number }>, days = 30, threshold = 0.15): { trend: Trend; change: number; from: string | null } {
  if (!data.length) return { trend: 'flat', change: NaN, from: null };
  const last = data[data.length - 1];
  const cutoff = new Date(Date.parse(last.date) - days * 86400000).toISOString().slice(0, 10);
  let prior = data[0];
  for (let i = data.length - 1; i >= 0; i--) { if (data[i].date <= cutoff) { prior = data[i]; break; } }
  if (prior === last) return { trend: 'flat', change: NaN, from: null };
  const change = last.value - prior.value;
  return { trend: Math.abs(change) < threshold ? 'flat' : change > 0 ? 'rising' : 'falling', change, from: prior.date };
}
