/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow external images from Finnhub company logos
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'static.finnhub.io',
      },
      {
        protocol: 'https',
        hostname: 'static2.finnhub.io',
      },
    ],
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
              "connect-src 'self' https://api.coinbase.com https://data.alpaca.markets https://paper-api.alpaca.markets https://api.alpaca.markets https://finnhub.io https://api.stlouisfed.org https://data.sec.gov",
              "frame-src 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
