# Macro Dashboard

A professional macro investing & analytics dashboard built with Next.js, designed to Apple product standards. Integrates FRED, Alpaca, SEC EDGAR, and Finnhub APIs.

## Features

- **Macro Overview** — Yield curve, Fed Funds, CPI, unemployment, credit spreads, and macro regime classification (FRED)
- **Portfolio** — Live positions, P&L, orders, and a trade ticket (Alpaca)
- **Ticker Analysis** — Deep dive into any stock: price charts, SEC fundamentals, filings timeline, and news (EDGAR + Finnhub)
- **Signals & Alerts** — Macro regime signals, watchlist filing alerts, and market news

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure API keys

Copy the example env file and fill in your keys:

```bash
cp .env.example .env.local
```

Edit `.env.local` with your actual API keys:

```
FRED_API_KEY=your_fred_api_key
ALPACA_API_KEY=your_alpaca_key
ALPACA_API_SECRET=your_alpaca_secret
ALPACA_PAPER=true
FINNHUB_API_KEY=your_finnhub_key
EDGAR_USER_AGENT=YourName macro-dashboard your@email.com
```

**Where to get keys:**
- FRED: https://fred.stlouisfed.org/docs/api/api_key.html
- Alpaca: https://app.alpaca.markets (paper trading account)
- Finnhub: https://finnhub.io/register
- SEC EDGAR: No key needed, just a proper User-Agent string

### 3. Run locally

```bash
npm run dev
```

Open http://localhost:3000

## Deploy to Vercel

1. Push this repo to GitHub
2. Import into Vercel: https://vercel.com/new
3. Add your environment variables in Vercel's dashboard (Settings > Environment Variables)
4. Deploy

**Important:** Never commit `.env.local` — it's gitignored. Use Vercel's environment variable UI for production keys.

## Architecture

```
src/
├── app/
│   ├── api/          # Serverless API routes (FRED, Alpaca, EDGAR, Finnhub)
│   ├── macro/        # Macro Overview page
│   ├── portfolio/    # Portfolio & Trading page
│   ├── ticker/       # Single-name deep dive page
│   └── alerts/       # Signals & Alerts page
├── components/
│   ├── ui/           # Design system (Card, Badge, Loading states)
│   ├── charts/       # Recharts wrappers (TimeSeries, YieldCurve, Mini)
│   └── layout/       # Sidebar, mobile nav
└── lib/
    ├── config.ts     # Centralized env config
    ├── fred.ts       # FRED API client
    ├── alpaca.ts     # Alpaca API client
    ├── edgar.ts      # SEC EDGAR API client
    ├── finnhub.ts    # Finnhub API client
    ├── cache.ts      # In-memory TTL cache
    ├── fetcher.ts    # Resilient fetch with retry/backoff
    ├── hooks.ts      # React data-fetching hooks
    └── format.ts     # Number/date formatting utilities
```

## Tech Stack

- **Next.js 14** (App Router) — Full-stack React framework
- **TypeScript** — Type safety throughout
- **Tailwind CSS** — Apple-inspired design system
- **Recharts** — Responsive data visualization
- **Vercel** — Serverless deployment
