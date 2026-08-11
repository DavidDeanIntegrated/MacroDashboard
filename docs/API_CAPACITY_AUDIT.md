# API Capacity Audit — 2026-08-11

An inventory of every external API the dashboard connects to, what it currently uses,
and what each connection could additionally provide at no (or negligible) extra cost.

## Summary table

| Provider | Auth | Used today | Utilization |
|---|---|---|---|
| FRED (St. Louis Fed) | API key | 17 series + release calendar + series info | **Moderate** — 10 pre-wired series defined but never fetched |
| Polygon.io | API key | Aggregates, snapshot, SMA/RSI/MACD/EMA, dividends, ticker details, financials | **High** — near-full use of the paid surface |
| Alpaca | key + secret | Snapshot + historical bars only (price feed) | **Low** — brokerage surface (account/positions/orders) wired but unused by any UI |
| Finnhub | API key | Quote, profiles, company + market news, earnings, basic financials | **Moderate** — insider transactions & candles endpoints exist but no UI consumes them |
| SEC EDGAR | User-Agent only (free) | Company facts (fundamentals) + filings feed | **High** |
| Yahoo Finance (unofficial) | none | ^MOVE only | **Low** — single ticker |
| Coinbase (public) | none | BTC spot + candles | **High** for its purpose |

## FRED — the biggest untapped surface

Defined in `src/lib/fred.ts` but previously never fetched anywhere:

- **`CORE_PCE` (PCEPILFE)** — the Fed's actual target gauge. ✅ **Now wired in** (dashboard + Macro page chart + Key Indicators, 2026-08-11).
- **`BREAKEVEN_10Y` (T10YIE)** — market-implied inflation expectations. The Alerts page
  literally said "monitor TIPS breakevens" while the app never fetched them. ✅ **Now wired in.**
- `T10Y3M` — the NY Fed's preferred recession-probability spread (they publish a monthly
  recession-probability model on exactly this series). Candidate: show next to T10Y2Y.
- `SAHMREALTIME` — FRED publishes the official Sahm Rule value; the app hand-computes it.
  The hand computation was corrected to the official formula (3-mo avg vs min of prior
  twelve 3-mo avgs); fetching the official series would let the app display source-of-truth
  values and validate the local math.
- `NFCI` (Chicago Fed Financial Conditions), `IG_SPREAD`, `NONFARM_PAYROLLS`,
  `RETAIL_SALES`, `GDP`/`GDPC1`, `CASE_SHILLER`, `T5YIE`, `CORE_CPI`, `PCE`, `DFF` —
  all pre-wired IDs, one `getFredSeries()` call away. Best candidates for the dashboard:
  **NFCI** (one number summarizing whether financial conditions are tight or loose) and
  **payrolls MoM** (the market-moving jobs number; currently only unemployment is shown).

## Alpaca — decide: price feed or brokerage?

`src/lib/alpaca.ts` implements the full brokerage surface — `getAccount`, `getPositions`,
`getOrders`, `submitOrder`, `cancelOrder` — and `/api/alpaca` exposes all of it, but no
page calls any of it; holdings are hand-maintained in `src/lib/holdings.ts`.

Options:
1. **Lean in**: if the real account is at Alpaca, replace the static `HOLDINGS` list with
   `getPositions()` and quantities/cost basis stop going stale (the last three commits were
   manual holdings-quantity bumps — this would eliminate that chore entirely).
2. **Lean out**: delete the unused order endpoints, since exposing live trading through a
   public API route is unused risk surface.

✅ **Resolved 2026-08-11 (lean out, per David):** `submitOrder`, `cancelOrder`, `getOrders`,
the `/api/alpaca` POST handler, the `orders` GET action, and the `useOrders` hook were all
removed. Alpaca is now a read-only price feed (snapshot + bars) plus dormant read-only
account/positions endpoints kept for a possible future "lean in."

Also unused: **Alpaca's news API** (`getNews`) — redundant with Finnhub news; pick one.

## Finnhub — two wired-but-orphaned endpoints

- **Insider transactions** (`/api/finnhub?action=insider`): implemented end-to-end but no
  UI consumes it. Insider *cluster buying* is one of the few well-evidenced single-stock
  signals — a natural add to the ticker page or as an Alerts section for watchlist names.
- **Candles** (`action=candles`): fully redundant with Polygon aggregates — candidate for deletion.
- Free-tier endpoints not implemented that would fit the app: **earnings calendar**
  (next report date per holding — pairs perfectly with the Alerts page),
  **recommendation trends** (analyst buy/hold/sell counts), **price targets**.

## Polygon — well used

Aggregates, snapshots, indicators, dividends, details, and vX financials (feeding the
fundamentals score) are all in use. Remaining headroom: market status/holidays endpoint
(cheap way to label "market closed" states), splits (would silently fix historical charts
if a holding ever splits), and related-companies.

## Yahoo (unofficial) — quiet single-point-of-failure

Only fetches `^MOVE`. Note: this is an unofficial endpoint that Yahoo throttles or breaks
periodically; the MOVE card silently shows an empty chart if it fails (the `.catch(() => [])`
in `/api/fred` route hides errors). Consider a stale-cache fallback or an explicit
"source unavailable" state. Could also supply `DX-Y.NYB` (dollar index) — a natural macro
column the dashboard currently lacks and FRED only has as a broad monthly index.

## EDGAR — good

Fundamentals via company-facts and the filings feed both consumed. The free full-text
search API (`efts.sec.gov`) is the only notable unused capability (e.g., watchlist-wide
8-K keyword alerts).
