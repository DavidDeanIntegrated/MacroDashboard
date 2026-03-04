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
};

export default nextConfig;
