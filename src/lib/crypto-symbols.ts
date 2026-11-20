// Crypto assets tracked by the dashboard; keep them out of equity requests.
export const CRYPTO_SYMBOLS = ['BTC', 'SOL', 'ZEC', 'USDC'] as const;
export const isCrypto = (symbol: string): boolean =>
  CRYPTO_SYMBOLS.some((asset) => symbol === asset || symbol === `X:${asset}USD`);
export const cryptoPair = (symbol: string): string =>
  `${symbol.startsWith('X:') ? symbol.slice(2, -3) : symbol}/USD`;
