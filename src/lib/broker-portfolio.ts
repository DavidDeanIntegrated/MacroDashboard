import { getAccount, getPositions, type AlpacaAccount, type AlpacaPosition } from './alpaca';
import type { Holding, HoldingPosition, HoldingsPortfolio } from './holdings';

// Read-only sync of ONE Alpaca account. Never merge it with the manual book:
// that could double count positions or silently omit off-broker holdings.
export function normalizeBrokerPortfolio(account: AlpacaAccount, rows: AlpacaPosition[], classifications: Holding[], asOf = new Date().toISOString()): HoldingsPortfolio {
  const cash = Number(account.cash);
  if (!Number.isFinite(cash) || cash < 0 || rows.some(p => p.side !== 'long' || !Number.isFinite(Number(p.qty)) || Number(p.qty) <= 0 || !Number.isFinite(Number(p.current_price)) || Number(p.current_price) <= 0 || !Number.isFinite(Number(p.market_value)) || Number(p.market_value) < 0 || !Number.isFinite(Number(p.unrealized_intraday_pl)))) throw new Error('Broker account contains unsupported short/margin positions or invalid valuation data. Risk and trade suggestions are withheld.');
  const positions: HoldingPosition[] = rows.map(p => {
    const symbol = p.symbol === 'BTCUSD' || p.symbol === 'BTC/USD' ? 'BTC' : p.symbol;
    return { symbol, qty: Number(p.qty), currentPrice: Number(p.current_price), marketValue: Number(p.market_value), weight: 0,
      dayChange: Number(p.unrealized_intraday_pl), dayChangePercent: Number(p.unrealized_intraday_plpc) * 100,
      category: classifications.find(h => h.symbol === symbol)?.category ?? 'Unclassified', costBasis: Number(p.avg_entry_price),
      open: 0, high: 0, low: 0, volume: 0, priceAsOf: asOf, priceSource: 'Alpaca position mark (retrieval timestamp)' };
  });
  if (cash > 0) positions.push({ symbol: 'CASH', qty: cash, currentPrice: 1, marketValue: cash, weight: 0, dayChange: 0, dayChangePercent: 0, category: 'Dry Powder', open: 1, high: 1, low: 1, volume: 0, priceAsOf: asOf, priceSource: 'Alpaca account cash' });
  const portfolioValue = positions.reduce((s, p) => s + p.marketValue, 0);
  const reported = Number(account.portfolio_value);
  if (!Number.isFinite(reported) || Math.abs(portfolioValue - reported) > Math.max(1, reported * .005)) throw new Error('Broker cash plus positions do not reconcile to account value within 0.5%. Refresh before using allocation guidance.');
  for (const p of positions) p.weight = portfolioValue > 0 ? p.marketValue / portfolioValue * 100 : 0;
  const dayChange = positions.reduce((s, p) => s + p.dayChange, 0);
  return { portfolioValue, dayChange, dayChangePercent: portfolioValue - dayChange > 0 ? dayChange / (portfolioValue - dayChange) * 100 : 0,
    positions: positions.sort((a, b) => b.marketValue - a.marketValue), holdingsAsOf: asOf, valuationAsOf: asOf,
    source: 'Read-only Alpaca account sync; excludes assets held elsewhere. Daily change is position P&L, not cash-flow-adjusted account performance.' };
}

export async function getBrokerPortfolio(classifications: Holding[]) {
  const [account, positions] = await Promise.all([getAccount(), getPositions()]);
  return normalizeBrokerPortfolio(account, positions, classifications);
}
