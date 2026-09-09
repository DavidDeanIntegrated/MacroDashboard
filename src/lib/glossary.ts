// Plain-English glossary — one source of truth for every finance/macro term the
// dashboard uses. Rendered inline via <Term k="..."> (dotted underline + tooltip)
// so definitions appear exactly where the jargon does.
//
// Style rules for entries:
//  - First sentence: what it IS, in words a smart non-finance reader gets instantly.
//  - Second sentence (optional): why it matters / how to read it here.
//  - Keep numbers concrete ("above 30 = fear") instead of vague ("high = bad").

export interface GlossaryEntry {
  term: string;
  def: string;
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  // ─── Regime & framework ───
  regime: {
    term: 'Macro regime',
    def: 'The current "economic season," read from three questions answered by separate groups of official data: is the economy growing or shrinking, are prices rising faster than the Fed wants, and is money easy or hard to borrow? Growth and inflation pick the season; each one historically favors different assets, and that mapping is what drives this dashboard\'s sleeve guidance.',
  },
  goldilocks: {
    term: 'Growing, inflation contained ("Goldilocks")',
    def: 'Steady growth with inflation near the Fed\'s 2% target — "not too hot, not too cold." Historically the friendliest season for stocks, because profits grow while the Fed has no reason to raise rates.',
  },
  reflation: {
    term: 'Growing, inflation running warm ("Reflation")',
    def: 'Inflation running above roughly 2.5% while the economy is still growing. Prices of real things (commodities, gold) tend to do well; bonds and expensive growth stocks tend to struggle as rates rise.',
  },
  stagflation: {
    term: 'Weak growth, inflation running warm ("Stagflation")',
    def: 'The worst combination: inflation stays warm while growth turns down. The Fed can\'t cut rates to help growth without feeding inflation, so both stocks AND bonds can fall together. Gold and cash historically hold up best.',
  },
  deflation: {
    term: 'Weak growth, inflation contained (slowdown)',
    def: 'Growth turning down while inflation stays contained — the economy is decelerating. Cash and high-quality bonds usually do well because the Fed responds by cutting rates.',
  },
  sleeve: {
    term: 'Sleeve',
    def: 'A bucket of holdings that plays one specific role in the portfolio (e.g., Equities for growth, Real Assets for inflation protection, Dry Powder as ready cash). Each sleeve has a target percentage range; rebalancing means moving money between sleeves to get back inside those ranges.',
  },
  'dry-powder': {
    term: 'Dry powder',
    def: 'Cash held on purpose so you can buy when prices fall. Here it\'s parked in SGOV, a fund of ultra-short-term U.S. government bonds (T-bills) that pays interest while it waits — cash that earns ~4-5% instead of sitting idle.',
  },
  'all-weather': {
    term: 'All-Weather',
    def: 'Ray Dalio\'s idea that instead of betting on one economic outcome, you hold assets that each thrive in a different "season" (growth, inflation, deflation, contraction) so the whole portfolio can survive any of them.',
  },
  rebalancing: {
    term: 'Rebalancing',
    def: 'Selling a little of what has grown past its target and adding to what has shrunk below it. Mechanically forces "sell high, buy low" and keeps risk from concentrating in whatever ran up most.',
  },
  'drawdown-ladder': {
    term: 'Drawdown ladder',
    def: 'A pre-committed buying plan: deploy specific chunks of cash at specific decline levels (-10%, -15%, -25% from recent highs). Deciding the levels in advance removes the hardest part — buying when headlines are scariest.',
  },

  // ─── Rates & bonds ───
  'fed-funds': {
    term: 'Fed funds rate',
    def: 'The interest rate the Federal Reserve controls — the base cost of borrowing money overnight, which every other rate (mortgages, car loans, corporate debt) builds on. Raising it slows the economy and fights inflation; cutting it stimulates.',
  },
  treasury: {
    term: 'Treasury yield',
    def: 'The annual return you\'d earn lending money to the U.S. government for a set period (2 years, 10 years, etc.). Considered the "risk-free" baseline that all other investments are measured against.',
  },
  'yield-curve': {
    term: 'Yield curve',
    def: 'A line plotting Treasury yields from short loans (3 months) to long ones (30 years). Normally it slopes up — you earn more for locking money up longer. When short rates exceed long rates, the curve is "inverted."',
  },
  inversion: {
    term: 'Inverted yield curve',
    def: 'When short-term Treasuries pay MORE than long-term ones — the market betting that the Fed will have to cut rates because a slowdown is coming. An inversion of the 10-year minus 2-year spread has preceded every U.S. recession since 1955, usually by 6-24 months.',
  },
  duration: {
    term: 'Duration',
    def: 'How sensitive a bond (or bond fund) is to interest-rate changes. "Long duration" = big price swings when rates move (a 30-year bond); "short duration" = barely moves (a 3-month T-bill). When people say "favor duration," they mean own longer-term bonds because rates are expected to fall.',
  },
  'real-rates': {
    term: 'Real rates',
    def: 'Interest rates minus inflation — what a saver actually earns in purchasing power. When real rates fall (or go negative), holding cash loses value, which is when gold historically shines.',
  },
  'hy-spread': {
    term: 'High-yield spread',
    def: 'The extra interest that risky ("junk-rated") companies must pay to borrow versus the U.S. government. It\'s a real-time fear gauge for the credit market: under ~3.5% = relaxed, above ~5% = stress, above ~8% = crisis. Credit markets often smell trouble before the stock market does.',
  },
  tips: {
    term: 'TIPS',
    def: 'Treasury Inflation-Protected Securities — government bonds whose principal automatically adjusts upward with inflation (CPI), protecting the real value of your money.',
  },
  breakeven: {
    term: 'Breakeven inflation rate',
    def: 'The market\'s own forecast of future inflation, derived from the price gap between regular Treasuries and inflation-protected ones (TIPS). A rising 10-year breakeven means investors are betting inflation will run hotter for the next decade.',
  },
  'front-end': {
    term: 'Front-end rates',
    def: 'Yields on the shortest-term government debt (weeks to ~2 years). They track what the Fed is expected to do next, and they\'re what a T-bill fund like SGOV earns.',
  },

  // ─── Inflation & economy ───
  cpi: {
    term: 'CPI (Consumer Price Index)',
    def: 'The most-quoted inflation measure: the price change of a fixed basket of everyday goods and services versus a year ago. The Fed aims for about 2%.',
  },
  'core-pce': {
    term: 'Core PCE',
    def: 'The Fed\'s actual preferred inflation gauge — like CPI but excluding volatile food and energy prices and better at capturing what people really buy. When the Fed says "2% target," this is the number it means.',
  },
  m2: {
    term: 'M2 money supply',
    def: 'Roughly all the readily spendable money in the economy: cash, checking, savings, and money-market funds. When M2 grows much faster than the economy, inflation tends to follow 12-18 months later; when it shrinks, disinflation follows.',
  },
  'sahm-rule': {
    term: 'Sahm Rule',
    def: 'A recession detector with a perfect historical record: when the 3-month average unemployment rate rises 0.50 points above its low from the past year, a recession has already begun. It confirms recessions early rather than predicting them.',
  },
  lei: {
    term: 'Leading indicator',
    def: 'An economic statistic that tends to turn BEFORE the overall economy does (building permits, factory orders, the yield curve). The OECD combines several into one index where 100 = long-term trend growth.',
  },
  'lagging-indicator': {
    term: 'Lagging indicator',
    def: 'A statistic that only moves after the economy has already turned — unemployment is the classic example. By the time it rises clearly, the slowdown usually started months earlier.',
  },
  gdp: {
    term: 'GDP',
    def: 'Gross Domestic Product — the total value of everything the economy produces. Consumer spending makes up roughly 70% of it, which is why consumer confidence matters so much.',
  },

  // ─── Volatility & sentiment ───
  vix: {
    term: 'VIX',
    def: 'The "fear index" — how much movement (up or down) option traders expect from the S&P 500 over the next 30 days. Under 15 = calm, 20-30 = nervous, above 30 = fear, above 40 = panic (which, counterintuitively, has usually marked good long-term buying moments).',
  },
  move: {
    term: 'MOVE index',
    def: 'The bond market\'s version of the VIX — expected volatility in U.S. Treasury prices. Under 80 = calm, above 120 = stress, above 150 = crisis-level (2008, the 2023 bank failures). Bond-market panic often shows up before stock-market panic.',
  },
  volatility: {
    term: 'Volatility',
    def: 'How widely a price swings day to day, expressed as an annualized percentage. A stock with 40% volatility routinely moves twice as violently as one at 20%. Higher volatility = more risk AND more opportunity, so position sizes should shrink as volatility grows.',
  },
  'annualized-vol': {
    term: 'Annualized volatility',
    def: 'Daily price swings scaled up to a yearly figure (daily standard deviation × √252 trading days) so different assets can be compared on one scale. SPY typically runs ~15-20%; a volatile small-cap can exceed 60%.',
  },
  'vol-percentile': {
    term: 'Volatility percentile',
    def: 'Where today\'s volatility ranks against the same stock\'s own recent history. 90th percentile = more turbulent than 90% of the period — unusually stormy for THIS stock, regardless of how volatile it normally is.',
  },
  capitulation: {
    term: 'Capitulation',
    def: 'The point in a sell-off where discouraged holders finally give up and dump shares at any price — visible as a volume spike plus a volatility spike near the lows. Painful, but it often marks the moment selling exhausts itself.',
  },
  distribution: {
    term: 'Distribution',
    def: 'Large investors quietly selling into strength while the price still looks fine — often visible as rising volatility while a stock sits near its highs. The opposite of accumulation.',
  },
  'risk-on': {
    term: 'Risk-on / risk-off',
    def: 'Shorthand for the market\'s mood. Risk-on: investors reach for aggressive assets (tech, small caps, crypto). Risk-off: they retreat to safety (Treasuries, gold, cash). Liquidity-sensitive assets like crypto swing hardest in both directions.',
  },
  liquidity: {
    term: 'Liquidity',
    def: 'How much money is sloshing around the financial system looking for assets to buy. Plentiful liquidity (low rates, growing money supply) lifts speculative assets first; shrinking liquidity drains them first.',
  },

  // ─── Stocks & valuation ───
  multiple: {
    term: 'Valuation multiple',
    def: 'What investors pay per dollar of a company\'s earnings — the P/E ratio is the classic one. "Multiples compress" when rates rise because future profits are worth less today; that\'s why expensive growth stocks are hurt most by rate hikes.',
  },
  beta: {
    term: 'Beta / high-beta',
    def: 'How strongly a stock amplifies market moves. Beta of 1 = moves with the market; beta of 2 ("high-beta") = swings twice as hard in both directions. Trimming high-beta = reducing the positions that would fall most in a sell-off.',
  },
  'value-stocks': {
    term: 'Value stocks',
    def: 'Established companies trading cheaply relative to their current profits and assets (banks, energy, industrials). They tend to hold up better when rates rise, because their earnings are here-and-now rather than promised years away.',
  },
  'growth-stocks': {
    term: 'Growth stocks',
    def: 'Companies valued mostly for profits expected years in the future (much of tech). Low rates make those future profits worth more today, so growth leads when rates fall — and drops hardest when rates climb.',
  },
  cyclicals: {
    term: 'Cyclicals',
    def: 'Businesses whose profits ride the economic cycle — industrials, materials, banks, travel. They lead early recoveries and lag going into slowdowns.',
  },
  defensives: {
    term: 'Defensive stocks',
    def: 'Companies people pay no matter what — utilities, groceries, healthcare. Their steady demand cushions them in downturns, at the cost of less upside in booms.',
  },
  'quality-compounder': {
    term: 'Quality compounder',
    def: 'A dominant business with a durable moat, fat profit margins, and a long runway to reinvest — the kind you hold for years and let compounding do the work (e.g., MSFT, NVDA, TSM in this portfolio).',
  },
  'cost-basis': {
    term: 'Cost basis',
    def: 'Your average purchase price for a position. "vs Cost" shows how far the current price sits above (+) or below (−) what you paid.',
  },
  '60-40': {
    term: '60/40 portfolio',
    def: 'The classic default portfolio: 60% stocks, 40% bonds, on the assumption that bonds cushion stock crashes. It works — except in stagflation, when inflation sinks both at once (as in 2022).',
  },
  'relative-strength': {
    term: 'Relative strength',
    def: 'A holding\'s return minus the S&P 500\'s return over the same window. Positive = it beat the market; negative = the market beat it. Tells you whether a gain was skill/story or just the tide lifting all boats.',
  },
  correlation: {
    term: 'Correlation',
    def: 'How much two assets move together, from +1 (in lockstep) to 0 (unrelated) to −1 (mirror opposites). Diversification only works when correlations are low — ten holdings that all move together behave like one big position.',
  },
  diversification: {
    term: 'Diversification',
    def: 'Spreading money across assets that don\'t all fall at the same time. Measured here by average correlation between holdings — lower is better protection.',
  },
  rsi: {
    term: 'RSI (Relative Strength Index)',
    def: 'A 0-100 momentum gauge for a single stock. Above 70 = "overbought" (rally may be stretched); below 30 = "oversold" (sell-off may be stretched). A timing hint, not a verdict.',
  },
  sma: {
    term: 'Moving average (SMA)',
    def: 'The average closing price over the last N days, drawn as a smooth trend line. Price above its 200-day average = long-term uptrend intact; the 50-day crossing the 200-day marks widely-watched trend changes ("golden/death cross").',
  },
  '200-wma': {
    term: '200-week moving average',
    def: 'The average closing price over the last 200 weeks (~4 years) — a slow anchor for what an asset has "normally" cost across a full market cycle. Major bear-market bottoms in quality assets (SPY, BTC) have historically landed near it, so price near or below it flags a rare accumulation zone, while price far above it (say, +80%+) signals a stretched run. Caveats for single stocks: trading below it can also mean genuine business decline; recent IPOs don\'t have enough history; and for smaller names, a reused ticker symbol can splice a prior company\'s price history into the average — sanity-check any surprising reading before acting on it.',
  },
  'indexed-100': {
    term: 'Indexed to 100',
    def: 'Every line on the chart is rescaled to start at 100, so you compare percentage growth, not dollar prices. A line at 115 = up 15% since the start of the window.',
  },

  // ─── Filings & events ───
  '10-K': {
    term: '10-K',
    def: 'A company\'s audited annual report to the SEC — the deepest single document on its business, risks, and full-year financials.',
  },
  '10-Q': {
    term: '10-Q',
    def: 'The quarterly progress report to the SEC — unaudited financials and updates, filed three times a year between annual 10-Ks.',
  },
  '8-K': {
    term: '8-K',
    def: 'A "material event" alert companies must file within days of big news — CEO departures, acquisitions, earnings releases, major contracts. The filing to watch for surprises.',
  },
  'ex-date': {
    term: 'Ex-dividend date',
    def: 'The cutoff for a dividend: you must own the stock BEFORE this date to receive the payment. Buy on or after it and the dividend goes to the previous owner.',
  },

  // ─── Portfolio risk & the economic evidence block ───
  'variance-share': {
    term: 'Share of variance',
    def: 'How much of your portfolio\'s day-to-day swings one holding is responsible for, as a percentage that sums to 100 across all holdings. Compare it to the holding\'s share of your money: a position that is 10% of the portfolio but 30% of the variance is contributing three times its weight to the bumps.',
  },
  'factor-beta': {
    term: 'Factor beta',
    def: 'How much a holding has historically moved when one outside force moved. A SPY beta of 1.2 means that on days the market rose 1%, this holding rose about 1.2% on average. For yields and credit spreads the unit is percentage points instead of percent.',
  },
  'standard-error': {
    term: '± range (standard error)',
    def: 'How sure the estimate is. The number after ± is roughly the range the true value could sit in; a ± bigger than the estimate itself means the relationship is too noisy to trust.',
  },
  'r-squared': {
    term: 'R²',
    def: 'The fraction of a holding\'s moves that one factor explains, from 0 (none) to 1 (all). Below about 0.2 the factor is a minor influence even if the beta looks large.',
  },
  'stress-test': {
    term: 'Stress test',
    def: 'A what-if: apply an assumed price drop (or rise) to every holding at once and add up the damage in dollars. The shocks are assumptions you can edit, not predictions.',
  },
  'look-through': {
    term: 'Look-through',
    def: 'Counting what your funds hold as if you owned it directly. If VTI is 30% of your money and Microsoft is 6% of VTI, you own another 1.8% Microsoft through VTI on top of any shares you hold outright.',
  },
  'financial-conditions': {
    term: 'Financial conditions',
    def: 'How easy or hard it is to borrow money right now, read from credit spreads, bank lending standards, real interest rates, and the dollar. "Tight" conditions slow the economy with a lag even before growth data show it.',
  },
  momentum: {
    term: 'Momentum (3-month change)',
    def: 'Whether a reading is getting better or worse compared with three months ago. Level tells you where the economy is; momentum tells you which way it is heading.',
  },
};

export function glossaryDef(key: string): GlossaryEntry | undefined {
  return GLOSSARY[key];
}
