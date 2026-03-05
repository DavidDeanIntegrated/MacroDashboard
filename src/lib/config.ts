// Centralized configuration — all API keys from environment variables
// NEVER hard-code keys here. Use .env.local for local dev, Vercel env vars for production.

export const config = {
  fred: {
    apiKey: process.env.FRED_API_KEY || '',
    baseUrl: 'https://api.stlouisfed.org/fred',
  },
  alpaca: {
    apiKey: process.env.ALPACA_API_KEY || '',
    apiSecret: process.env.ALPACA_API_SECRET || '',
    paper: process.env.ALPACA_PAPER === 'true',
    get baseUrl() {
      return this.paper
        ? 'https://paper-api.alpaca.markets'
        : 'https://api.alpaca.markets';
    },
    get dataUrl() {
      return 'https://data.alpaca.markets';
    },
  },
  finnhub: {
    apiKey: process.env.FINNHUB_API_KEY || '',
    baseUrl: 'https://finnhub.io/api/v1',
  },
  edgar: {
    baseUrl: 'https://data.sec.gov',
    userAgent: process.env.EDGAR_USER_AGENT || 'MacroDashboard macro-dashboard contact@example.com',
  },
  polygon: {
    apiKey: process.env.POLYGON_API_KEY || '',
    baseUrl: 'https://api.polygon.io',
  },
} as const;
