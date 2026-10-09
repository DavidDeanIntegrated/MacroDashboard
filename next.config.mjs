/** @type {import('next').NextConfig} */
const nextConfig = {
  // The app does not use next/image. Disable the image optimizer so its endpoint
  // (subject of Next.js 14.x advisories, e.g. GHSA-2xp9-vwfh-vxw4) is not served.
  images: {
    unoptimized: true,
  },

  // Security headers
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: https://static.finnhub.io https://static2.finnhub.io https://*.finnhub.io blob:",
              "font-src 'self'",
              "connect-src 'self' https://api.coinbase.com https://data.alpaca.markets https://paper-api.alpaca.markets https://api.alpaca.markets https://finnhub.io https://api.stlouisfed.org https://data.sec.gov https://api.polygon.io",
              "frame-src 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
