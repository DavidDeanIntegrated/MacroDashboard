'use client';

import { Card, CardTitle } from '@/components/ui/Card';
import { Badge, RegimeBadge } from '@/components/ui/Badge';
import { LoadingPage, ErrorState } from '@/components/ui/Loading';
import { useApi } from '@/lib/hooks';
import { formatPercent } from '@/lib/format';

interface MacroDashboard {
  fedFunds: Array<{ date: string; value: number }>;
  t10y: Array<{ date: string; value: number }>;
  t10y2y: Array<{ date: string; value: number }>;
  cpiYoY: Array<{ date: string; value: number }>;
  unemployment: Array<{ date: string; value: number }>;
  highYieldSpread: Array<{ date: string; value: number }>;
  industrialProduction: Array<{ date: string; value: number }>;
  regime: {
    regime: string;
    label: string;
    description: string;
    inflationTrend: string;
    growthTrend: string;
    latestInflation: number | null;
    latestUnemployment: number | null;
  };
}

function getLatest(data: Array<{ date: string; value: number }>): number {
  return data.length > 0 ? data[data.length - 1].value : 0;
}

function getTrend(data: Array<{ date: string; value: number }>, lookback = 3): 'rising' | 'falling' | 'flat' {
  if (data.length < lookback + 1) return 'flat';
  const recent = data[data.length - 1].value;
  const prior = data[data.length - 1 - lookback].value;
  const diff = recent - prior;
  if (Math.abs(diff) < 0.15) return 'flat';
  return diff > 0 ? 'rising' : 'falling';
}

// Section component for consistent styling
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <h3 className="text-lg font-semibold text-black/85 mb-4">{title}</h3>
      {children}
    </Card>
  );
}

function Indicator({
  name,
  format,
  trend,
  description,
  bullish,
  bearish,
  crisis,
}: {
  name: string;
  format: string;
  trend: 'rising' | 'falling' | 'flat';
  description: string;
  bullish: string;
  bearish: string;
  crisis: string;
}) {
  const trendBadge = trend === 'rising' ? 'red' : trend === 'falling' ? 'green' : 'neutral';
  const trendLabel = trend === 'rising' ? 'Rising' : trend === 'falling' ? 'Falling' : 'Stable';

  return (
    <div className="py-5 border-b border-black/[0.06] last:border-0">
      <div className="flex items-start justify-between mb-2">
        <h4 className="text-base font-semibold text-black/80">{name}</h4>
        <div className="flex items-center gap-2 shrink-0 ml-4">
          <Badge variant={trendBadge}>{trendLabel}</Badge>
          <span className="text-sm font-semibold text-black/85 tabular-nums">{format}</span>
        </div>
      </div>
      <p className="text-sm text-black/55 leading-relaxed mb-3">{description}</p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="bg-accent-green/[0.06] rounded-xl px-3 py-2.5">
          <p className="text-xs font-semibold text-accent-green uppercase tracking-wider mb-1">Bull signal</p>
          <p className="text-xs text-black/60 leading-relaxed">{bullish}</p>
        </div>
        <div className="bg-accent-red/[0.06] rounded-xl px-3 py-2.5">
          <p className="text-xs font-semibold text-accent-red uppercase tracking-wider mb-1">Bear signal</p>
          <p className="text-xs text-black/60 leading-relaxed">{bearish}</p>
        </div>
        <div className="bg-black/[0.04] rounded-xl px-3 py-2.5">
          <p className="text-xs font-semibold text-black/50 uppercase tracking-wider mb-1">Crisis / Depression</p>
          <p className="text-xs text-black/60 leading-relaxed">{crisis}</p>
        </div>
      </div>
    </div>
  );
}

export default function GuidePage() {
  const { data, error, loading, refresh } = useApi<MacroDashboard>('/api/fred?action=dashboard');

  if (loading) return <LoadingPage />;
  if (error) return <ErrorState message={error} onRetry={refresh} />;
  if (!data) return null;

  const regime = data.regime;
  const fedFunds = getLatest(data.fedFunds);
  const t10y = getLatest(data.t10y);
  const spread10y2y = getLatest(data.t10y2y);
  // The assessment reports null when a series is unavailable; NaN keeps the
  // comparisons below false and the formatters render '—' instead of crashing.
  const cpi = regime.latestInflation ?? NaN;
  const unemp = regime.latestUnemployment ?? NaN;
  const pct1 = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)}%` : '—');
  const hySpread = getLatest(data.highYieldSpread);

  // Determine overall assessment
  const signals: Array<{ label: string; sentiment: 'bullish' | 'bearish' | 'neutral' }> = [];

  // CPI assessment
  if (!Number.isFinite(cpi)) { /* no CPI reading — no inflation signal */ }
  else if (cpi < 2.5) signals.push({ label: 'Inflation contained', sentiment: 'bullish' });
  else if (cpi > 4.0) signals.push({ label: 'Inflation elevated', sentiment: 'bearish' });
  else signals.push({ label: 'Inflation moderate', sentiment: 'neutral' });

  // Unemployment
  if (!Number.isFinite(unemp)) { /* no unemployment reading — no labor signal */ }
  else if (unemp < 4.5) signals.push({ label: 'Labor market strong', sentiment: 'bullish' });
  else if (unemp > 6.0) signals.push({ label: 'Labor market weak', sentiment: 'bearish' });
  else signals.push({ label: 'Labor market softening', sentiment: 'neutral' });

  // Yield curve
  if (spread10y2y > 0.5) signals.push({ label: 'Yield curve normal', sentiment: 'bullish' });
  else if (spread10y2y < 0) signals.push({ label: 'Yield curve inverted', sentiment: 'bearish' });
  else signals.push({ label: 'Yield curve flat', sentiment: 'neutral' });

  // HY spread
  if (hySpread < 3.5) signals.push({ label: 'Credit stress low', sentiment: 'bullish' });
  else if (hySpread > 6.0) signals.push({ label: 'Credit stress elevated', sentiment: 'bearish' });
  else signals.push({ label: 'Credit conditions tightening', sentiment: 'neutral' });

  // Fed funds vs CPI
  const realRate = fedFunds - cpi;
  if (!Number.isFinite(realRate)) { /* no policy signal without both readings */ }
  else if (realRate > 1.5) signals.push({ label: 'Policy restrictive', sentiment: 'bearish' });
  else if (realRate < 0) signals.push({ label: 'Policy accommodative', sentiment: 'bullish' });
  else signals.push({ label: 'Policy neutral', sentiment: 'neutral' });

  const bullCount = signals.filter(s => s.sentiment === 'bullish').length;
  const bearCount = signals.filter(s => s.sentiment === 'bearish').length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-semibold text-black/85 tracking-tight">Macro Guide</h2>
        <p className="text-sm text-black/45 mt-1">
          What each indicator means and where we are in the cycle
        </p>
      </div>

      {/* Current Cycle Assessment */}
      <Card className="bg-gradient-to-r from-white/80 to-white/60">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs font-medium text-black/45 uppercase tracking-wider mb-2">
              Current Macro Regime
            </p>
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-xl font-semibold text-black/85">{regime.label}</h3>
              <RegimeBadge regime={regime.regime} />
            </div>
            <p className="text-sm text-black/55 max-w-2xl leading-relaxed">
              {regime.description}
            </p>
          </div>
          <div className="text-right shrink-0 ml-8">
            <p className="text-xxs text-black/35 uppercase">Signals</p>
            <p className="text-lg font-semibold text-black/85">
              {bullCount} bull / {bearCount} bear
            </p>
          </div>
        </div>

        {/* Signal chips */}
        <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-black/[0.06]">
          {signals.map((s, i) => (
            <Badge
              key={i}
              variant={s.sentiment === 'bullish' ? 'green' : s.sentiment === 'bearish' ? 'red' : 'neutral'}
            >
              {s.label}
            </Badge>
          ))}
        </div>
      </Card>

      {/* Where Are We in the Cycle */}
      <Section title="Where Are We in the Economic Cycle?">
        <div className="text-sm text-black/65 leading-relaxed space-y-3">
          <p>
            The economy moves through four broad phases: <strong>expansion</strong> (rising growth, low unemployment),
            {' '}<strong>peak</strong> (overheating, inflation pressures build), <strong>contraction</strong> (slowing growth,
            rising unemployment), and <strong>trough</strong> (bottoming out before recovery). Identifying the current phase
            helps determine which asset classes are likely to outperform.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div className="bg-accent-green/[0.06] rounded-xl p-4">
              <p className="text-sm font-semibold text-accent-green mb-2">Current Assessment</p>
              <p className="text-sm text-black/65">
                With CPI at {formatPercent(cpi)}, unemployment at {pct1(unemp)},
                and the Fed Funds rate at {fedFunds.toFixed(2)}%,
                {!Number.isFinite(cpi) || !Number.isFinite(unemp)
                  ? ' a cycle-phase read is not possible until both the inflation and unemployment series are available.'
                  : cpi < 3 && unemp < 5
                  ? ' the economy appears to be in a mid-to-late expansion phase. Growth is solid and inflation is manageable. This is historically favorable for equities, especially quality growth stocks.'
                  : cpi > 3 && unemp < 5
                    ? ' the economy is showing signs of overheating. Strong employment but elevated inflation creates pressure for tighter monetary policy. Commodities, TIPS, and value stocks tend to outperform.'
                    : cpi > 3 && unemp > 5
                      ? ' the economy is exhibiting stagflationary characteristics. This is the most challenging environment for investors. Hard assets (gold, commodities) and cash tend to hold up best.'
                      : ' the economy is in a disinflationary slowdown. Falling inflation with weakening employment suggests the cycle is turning. Bonds and defensive equities tend to outperform.'
                }
              </p>
            </div>
            <div className="bg-accent-blue/[0.06] rounded-xl p-4">
              <p className="text-sm font-semibold text-accent-blue mb-2">Real Interest Rate</p>
              <p className="text-sm text-black/65">
                The real Fed Funds rate (Fed Funds minus CPI) is currently {formatPercent(realRate)}.
                {realRate > 2
                  ? ' This is very restrictive. The Fed is actively fighting inflation, which typically slows the economy and puts downward pressure on risk assets. Watch for pivot signals.'
                  : realRate > 0.5
                    ? ' Policy is moderately restrictive. The Fed is maintaining pressure on inflation without being aggressive. This is a neutral-to-cautious environment for risk assets.'
                    : realRate > -0.5
                      ? ' Policy is roughly neutral — neither stimulating nor restricting. This suggests the Fed is comfortable with current conditions.'
                      : ' Policy is accommodative — real rates are negative, meaning inflation is eroding the cost of borrowing. This is typically supportive of risk assets and hard assets.'
                }
              </p>
            </div>
          </div>
        </div>
      </Section>

      {/* Indicator Deep-Dives */}
      <Card padding="none">
        <div className="px-6 pt-6 pb-2">
          <CardTitle>Indicator Reference</CardTitle>
          <p className="text-sm text-black/45 mt-1">Each indicator with current reading, trend, and what to watch for</p>
        </div>
        <div className="px-6">
          <Indicator
            name="Fed Funds Rate"

            format={`${fedFunds.toFixed(2)}%`}
            trend={getTrend(data.fedFunds)}
            description="The interest rate at which banks lend to each other overnight. Set by the Federal Reserve, this is the most important lever for monetary policy. It ripples through all borrowing costs — mortgages, corporate debt, consumer loans. When the Fed raises rates, it cools the economy; when it cuts, it stimulates."
            bullish="Rate cuts (or pivot expectations) signal the Fed is easing. Falling rates boost asset valuations, especially for growth stocks and bonds. Historical avg: 1.5-2.5% in expansions."
            bearish="Rapid hikes above 4-5% signal the Fed is fighting inflation aggressively. This raises the cost of capital, compresses multiples, and can trigger recession. Watch for an inversion in the yield curve."
            crisis="Near-zero rates (0-0.25%) signal emergency conditions. The Fed has exhausted conventional tools and may resort to QE. Seen in 2008-2015 and 2020-2022."
          />

          <Indicator
            name="10-Year Treasury Yield"

            format={`${t10y.toFixed(2)}%`}
            trend={getTrend(data.t10y)}
            description="The yield on 10-year U.S. government bonds. This is the benchmark 'risk-free' rate used to value nearly every financial asset. It reflects market expectations for future growth, inflation, and Fed policy over the next decade."
            bullish="Stable yields between 2-4% with a normal curve suggest healthy growth expectations. Moderate yields support equity valuations (lower discount rate). Falling yields boost bond prices."
            bearish="Yields above 4.5-5% compress equity multiples significantly. Rapid rises (100bps+ in months) cause volatility. High yields mean bonds compete with stocks for capital."
            crisis="Yields below 1% signal a flight to safety — investors are accepting near-zero returns for security. 10Y hit 0.52% in Aug 2020. Yields above 5% (if sustained) can trigger a debt crisis as government borrowing costs surge."
          />

          <Indicator
            name="10Y-2Y Yield Spread"

            format={`${spread10y2y.toFixed(2)}%`}
            trend={getTrend(data.t10y2y)}
            description="The difference between 10-year and 2-year Treasury yields. This 'yield curve slope' is one of the most reliable recession indicators in history. When short-term rates exceed long-term rates, the curve inverts — and every U.S. recession since 1955 was preceded by an inversion."
            bullish="A positive spread (0.5-2.0%) indicates a normal, healthy curve. The market expects growth to continue and the Fed to maintain stability. Banks profit from the spread (borrow short, lend long), supporting credit flow."
            bearish="An inverted curve (negative spread) has preceded every recession in modern history, typically 6-24 months ahead. It means the market expects the Fed to cut rates due to weakening conditions."
            crisis="Deep and prolonged inversion (below -0.5%) signals severe recession risk. The un-inversion (when curve normalizes after being inverted) is actually when recession typically starts, as the Fed begins emergency cuts."
          />

          <Indicator
            name="CPI Year-over-Year"

            format={formatPercent(cpi)}
            trend={getTrend(data.cpiYoY)}
            description="Consumer Price Index measures inflation — the rate at which prices for goods and services are rising. The Fed targets 2% inflation. Too high erodes purchasing power; too low (deflation) signals weak demand and can lead to a debt-deflation spiral."
            bullish="CPI between 1.5-2.5% is the 'Goldilocks' zone — enough inflation to signal healthy demand without eroding purchasing power. Allows the Fed to maintain easy policy. Supportive of earnings growth and equity multiples."
            bearish="CPI above 3.5-4% forces the Fed to tighten, raising rates and reducing liquidity. Margin compression for companies that can't pass costs through. Bonds lose value as yields rise to match inflation."
            crisis="Deflation (CPI below 0%) signals demand collapse — prices falling means consumers delay purchases, revenues shrink, debt burdens increase in real terms. Japan's 'lost decades' were characterized by persistent deflation. Hyperinflation (10%+) destroys currency value and savings."
          />

          <Indicator
            name="Unemployment Rate"

            format={pct1(unemp)}
            trend={getTrend(data.unemployment)}
            description="The percentage of the labor force that is jobless and actively seeking work. This is a lagging indicator — by the time unemployment rises meaningfully, recession has usually begun. The Sahm Rule states that recession starts when the 3-month moving average rises 0.5% above its 12-month low."
            bullish="Unemployment below 4.5% signals a tight labor market. Workers have bargaining power (wage growth), consumer spending stays strong. Businesses invest to compete for talent. Historically, equity returns are strong when unemployment is low and stable."
            bearish="Unemployment rising from a low base (even slightly from 3.5% to 4.5%) can trigger the Sahm Rule, signaling recession onset. Rising unemployment means falling consumer spending, lower corporate revenues, and higher credit defaults."
            crisis="Unemployment above 8-10% indicates severe recession or depression. During 2008-09 it hit 10%, and during COVID it briefly touched 14.7%. Depression-era unemployment exceeded 20%. At these levels, fiscal stimulus and emergency monetary policy are required."
          />

          <Indicator
            name="High Yield Credit Spread"

            format={`${hySpread.toFixed(2)}%`}
            trend={getTrend(data.highYieldSpread)}
            description="The additional yield investors demand for holding risky corporate bonds over Treasuries. This measures credit stress and risk appetite. When spreads are tight, investors are complacent; when they blow out, fear is dominant. It's one of the best real-time measures of financial stress."
            bullish="Spreads below 3.5% indicate strong risk appetite and easy credit conditions. Companies can borrow cheaply, supporting investment and buybacks. Low spreads often coincide with equity bull markets."
            bearish="Spreads between 5-6% signal growing caution. Weaker companies struggle to refinance debt. It often precedes equity sell-offs by weeks. Watch for rapid widening — a 100bps move in weeks is a warning sign."
            crisis="Spreads above 8-10% signal panic. In 2008 they hit 21%, in March 2020 they touched 11%. At these levels, credit markets freeze, companies can't borrow, and defaults spike. This is typically when the Fed intervenes with emergency facilities."
          />
        </div>
      </Card>

      {/* Market Scenarios */}
      <Section title="Market Regime Scenarios">
        <div className="space-y-6">
          {/* Goldilocks / Bull */}
          <div className="border border-accent-green/20 rounded-xl p-5 bg-accent-green/[0.03]">
            <div className="flex items-center gap-2 mb-3">
              <Badge variant="green" size="md">Bull Market / Goldilocks</Badge>
            </div>
            <p className="text-sm text-black/65 mb-3">
              The ideal environment for risk assets. Characterized by moderate growth, contained inflation,
              and accommodative or neutral monetary policy. Equity bull markets typically last 3-7 years.
            </p>
            <div className="bg-white/60 rounded-lg p-3">
              <p className="text-xs font-semibold text-black/50 uppercase mb-2">Typical Data Profile</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs text-black/65">
                <span>CPI: 1.5-2.5%</span>
                <span>Unemployment: 3.5-4.5%</span>
                <span>Fed Funds: 1.5-3.0%</span>
                <span>10Y-2Y Spread: +0.5 to +2.0%</span>
                <span>HY Spread: 2.5-4.0%</span>
                <span>Industrial Prod: Growing</span>
              </div>
            </div>
            <p className="text-xs text-black/50 mt-3 leading-relaxed">
              <strong>Favored assets:</strong> Growth stocks, small caps, high-yield bonds, REITs.
              {' '}<strong>Example periods:</strong> 2013-2018, mid-2023 to 2024.
            </p>
          </div>

          {/* Reflation */}
          <div className="border border-accent-orange/20 rounded-xl p-5 bg-accent-orange/[0.03]">
            <div className="flex items-center gap-2 mb-3">
              <Badge variant="orange" size="md">Reflation / Late Cycle</Badge>
            </div>
            <p className="text-sm text-black/65 mb-3">
              The economy is running hot. Growth is strong but inflation is rising, forcing the Fed toward tighter policy.
              Equities can still rally but leadership shifts from growth to value and commodities. The risk is overshooting into stagflation.
            </p>
            <div className="bg-white/60 rounded-lg p-3">
              <p className="text-xs font-semibold text-black/50 uppercase mb-2">Typical Data Profile</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs text-black/65">
                <span>CPI: 3.0-5.0%</span>
                <span>Unemployment: 3.5-4.5% (tight)</span>
                <span>Fed Funds: Rising (3-5%)</span>
                <span>10Y-2Y Spread: Flattening</span>
                <span>HY Spread: 3.0-5.0%</span>
                <span>Industrial Prod: Peaking</span>
              </div>
            </div>
            <p className="text-xs text-black/50 mt-3 leading-relaxed">
              <strong>Favored assets:</strong> Commodities, value stocks, energy, TIPS, floating-rate debt.
              {' '}<strong>Example periods:</strong> 2021-2022 (post-COVID reopening inflation).
            </p>
          </div>

          {/* Stagflation */}
          <div className="border border-accent-red/20 rounded-xl p-5 bg-accent-red/[0.03]">
            <div className="flex items-center gap-2 mb-3">
              <Badge variant="red" size="md">Stagflation / Bear Market</Badge>
            </div>
            <p className="text-sm text-black/65 mb-3">
              The worst of both worlds: high inflation combined with rising unemployment and slowing growth.
              The Fed is trapped — cutting rates would fuel inflation, raising rates would deepen the slowdown.
              This is historically the most destructive environment for traditional 60/40 portfolios.
            </p>
            <div className="bg-white/60 rounded-lg p-3">
              <p className="text-xs font-semibold text-black/50 uppercase mb-2">Typical Data Profile</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs text-black/65">
                <span>CPI: 4.0-8.0%+</span>
                <span>Unemployment: Rising (5-7%+)</span>
                <span>Fed Funds: Elevated, may be cutting</span>
                <span>10Y-2Y Spread: Inverted or normalizing</span>
                <span>HY Spread: 6.0-10.0%+</span>
                <span>Industrial Prod: Falling</span>
              </div>
            </div>
            <p className="text-xs text-black/50 mt-3 leading-relaxed">
              <strong>Favored assets:</strong> Gold, commodities, cash, TIPS, short-duration bonds.
              {' '}<strong>Example periods:</strong> 1973-1974 oil embargo, early 1980s.
            </p>
          </div>

          {/* Deflation / Contraction */}
          <div className="border border-accent-blue/20 rounded-xl p-5 bg-accent-blue/[0.03]">
            <div className="flex items-center gap-2 mb-3">
              <Badge variant="blue" size="md">Deflation / Contraction</Badge>
            </div>
            <p className="text-sm text-black/65 mb-3">
              Demand is collapsing, taking prices down with it. The Fed cuts rates aggressively and may resort to quantitative easing.
              Long-duration Treasuries rally as yields collapse. Equities fall, especially cyclicals.
            </p>
            <div className="bg-white/60 rounded-lg p-3">
              <p className="text-xs font-semibold text-black/50 uppercase mb-2">Typical Data Profile</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs text-black/65">
                <span>CPI: 0-2% (or negative)</span>
                <span>Unemployment: Rising sharply (6-10%+)</span>
                <span>Fed Funds: Near zero / cutting fast</span>
                <span>10Y-2Y Spread: Steepening rapidly</span>
                <span>HY Spread: 8.0-20.0%+</span>
                <span>Industrial Prod: Crashing</span>
              </div>
            </div>
            <p className="text-xs text-black/50 mt-3 leading-relaxed">
              <strong>Favored assets:</strong> Long-duration Treasuries, cash, defensive equities (utilities, healthcare, staples).
              {' '}<strong>Example periods:</strong> 2008-2009 GFC, March 2020 COVID crash.
            </p>
          </div>

          {/* Depression */}
          <div className="border border-black/10 rounded-xl p-5 bg-black/[0.02]">
            <div className="flex items-center gap-2 mb-3">
              <Badge variant="neutral" size="md">Depression</Badge>
            </div>
            <p className="text-sm text-black/65 mb-3">
              A prolonged, severe contraction lasting years rather than quarters. GDP falls 10%+ from peak, unemployment exceeds 15%,
              and deflation persists. The financial system is impaired — bank failures, credit freeze, and debt defaults cascade.
              Requires massive fiscal intervention beyond what monetary policy alone can address.
            </p>
            <div className="bg-white/60 rounded-lg p-3">
              <p className="text-xs font-semibold text-black/50 uppercase mb-2">Typical Data Profile</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs text-black/65">
                <span>CPI: Negative (deflation)</span>
                <span>Unemployment: 15-25%+</span>
                <span>Fed Funds: 0% with QE exhausted</span>
                <span>10Y-2Y Spread: Steep (if functional)</span>
                <span>HY Spread: 15-30%+ (if markets open)</span>
                <span>Industrial Prod: Severe contraction</span>
              </div>
            </div>
            <p className="text-xs text-black/50 mt-3 leading-relaxed">
              <strong>Favored assets:</strong> Cash, gold, short-term Treasuries, farmland.
              {' '}<strong>Example periods:</strong> 1929-1933 Great Depression, arguably Japan 1990-2010.
              Modern central banks have tools to prevent a full repeat, but the 2008 crisis came close.
            </p>
          </div>
        </div>
      </Section>

      {/* Nuanced Scenarios */}
      <Section title="Nuanced Scenarios to Watch For">
        <div className="space-y-4">
          <div className="py-3 border-b border-black/[0.06]">
            <h4 className="text-sm font-semibold text-black/75 mb-1">Yield Curve Un-inversion After Prolonged Inversion</h4>
            <p className="text-xs text-black/55 leading-relaxed">
              Counterintuitively, the yield curve normalizing (going from inverted back to positive) is often when recession
              actually <em>begins</em>, not when the curve first inverts. The inversion is the warning; the un-inversion means
              the Fed is now cutting because the economy is deteriorating. If the 10Y-2Y spread was deeply inverted and is now
              normalizing while unemployment ticks up, this is a strong recession signal.
            </p>
          </div>

          <div className="py-3 border-b border-black/[0.06]">
            <h4 className="text-sm font-semibold text-black/75 mb-1">Disinflation Without Recession (Soft Landing)</h4>
            <p className="text-xs text-black/55 leading-relaxed">
              The Fed&apos;s holy grail: inflation falls back to 2% without triggering a recession. This requires CPI to decline
              from elevated levels while unemployment stays below 4.5%. If achieved, the Fed can cut rates preemptively,
              extending the expansion. This is extremely bullish for equities — the market prices in lower rates + continued
              earnings growth. Examples: 1995 soft landing under Greenspan; potentially 2023-2024.
            </p>
          </div>

          <div className="py-3 border-b border-black/[0.06]">
            <h4 className="text-sm font-semibold text-black/75 mb-1">Credit Spread Divergence from Equities</h4>
            <p className="text-xs text-black/55 leading-relaxed">
              When high-yield credit spreads widen significantly but equities haven&apos;t sold off yet, credit markets
              are often leading. Bond traders tend to be more risk-aware than equity investors. If HY spreads jump
              from 3% to 5%+ while the S&P is near highs, equities may be vulnerable to a catch-down move.
              Conversely, if spreads are tightening while equities are selling off, the correction may be overdone.
            </p>
          </div>

          <div className="py-3 border-b border-black/[0.06]">
            <h4 className="text-sm font-semibold text-black/75 mb-1">Rising Rates with Falling Inflation</h4>
            <p className="text-xs text-black/55 leading-relaxed">
              If the 10Y yield rises even as CPI falls, this signals the &quot;term premium&quot; is expanding —
              investors want more compensation for holding long-duration bonds, possibly due to fiscal deficit concerns
              or foreign selling of Treasuries. This can compress equity multiples even without inflation risk, as the
              discount rate rises for reasons unrelated to growth.
            </p>
          </div>

          <div className="py-3">
            <h4 className="text-sm font-semibold text-black/75 mb-1">Unemployment Inflection (Sahm Rule)</h4>
            <p className="text-xs text-black/55 leading-relaxed">
              The Sahm Rule triggers when the 3-month average unemployment rate rises 0.50 percentage points above
              its 12-month low. It has a perfect track record since 1970 in identifying recession onset in real time.
              Even small moves in unemployment from a very low base (e.g., 3.4% to 4.0%) can trigger this. Because
              unemployment is a lagging indicator, by the time Sahm triggers, the recession may already be 1-2 months old.
            </p>
          </div>
        </div>
      </Section>

      {/* How to Use This Dashboard */}
      <Section title="How to Use This Dashboard for Investment Decisions">
        <div className="text-sm text-black/65 leading-relaxed space-y-3">
          <p>
            <strong>1. Identify the regime first.</strong> Check the regime banner on the Macro page. The four-quadrant
            framework (Goldilocks, Reflation, Stagflation, Deflation) tells you which asset classes historically outperform.
            Don&apos;t fight the regime.
          </p>
          <p>
            <strong>2. Watch the leading indicators.</strong> The yield curve spread, HY credit spreads, and initial jobless
            claims are forward-looking. By the time GDP or unemployment confirms a recession, markets have already priced
            in much of the damage. Act on the leading signals, not the lagging confirmations.
          </p>
          <p>
            <strong>3. Monitor the speed of change.</strong> The <em>rate of change</em> matters more than the absolute level.
            CPI falling from 6% to 4% is bullish even though 4% is above target. Unemployment rising from 3.5% to 4.0% is
            bearish even though 4.0% is historically low. Trends and momentum matter most.
          </p>
          <p>
            <strong>4. Don&apos;t time — tilt.</strong> Rather than making all-or-nothing bets, tilt your portfolio allocation
            based on the regime. In Goldilocks, overweight equities and growth. In reflation, add commodities and value.
            In stagflation, increase gold and reduce duration. In deflation, extend duration and add defensive positions.
          </p>
          <p>
            <strong>5. Respect the Fed.</strong> &quot;Don&apos;t fight the Fed&quot; remains the single most important investing
            maxim. When the Fed is cutting rates, liquidity flows into risk assets. When tightening, it drains. The Fed Funds
            rate direction is the most important signal for medium-term asset allocation.
          </p>
        </div>
      </Section>
    </div>
  );
}
