import { NextResponse } from 'next/server';
import { getHoldingsPortfolio } from '@/lib/holdings';
import { getMultiAggregates, type OHLCV } from '@/lib/market-data';
import { getFredSeries } from '@/lib/fred';
import { portfolioRisk, factorSensitivity } from '@/lib/portfolio-risk';
import type { Observation } from '@/lib/time-series';
import { failedRequest, invalidRequest, logUpstreamError } from '@/lib/api-errors';
import { boundedTickers } from '@/lib/polygon-bounds';

// Two years of daily history for every holding plus three FRED factor series.
export const maxDuration = 60;

export async function GET() {
  try {
    const portfolio = await getHoldingsPortfolio();
    const from = new Date(); from.setUTCFullYear(from.getUTCFullYear() - 2);
    const start = from.toISOString().slice(0, 10);
    const histories: Record<string, OHLCV[]> = {};
    const errors: string[] = [];
    const symbols = boundedTickers(Array.from(new Set([...portfolio.positions.filter(p => p.symbol !== 'CASH').map(p => p.symbol), 'SPY'])));
    if (!symbols) return invalidRequest();
    // One paginated request for every holding; a failure here is a data outage, not a per-symbol gap.
    for (const { symbol, data } of await getMultiAggregates(symbols, '1day', start, undefined, 5000)) {
      histories[symbol] = data;
      if (data.length === 0) errors.push(`${symbol}: historical prices unavailable`);
    }
    const factorDefinitions = [{ key: 'market', id: null, name: 'SPY return', mode: 'return' as const },
      { key: 'realYield', id: 'DFII10', name: '10Y real yield change', mode: 'difference' as const },
      { key: 'dollar', id: 'DTWEXBGS', name: 'Broad USD return', mode: 'return' as const },
      { key: 'credit', id: 'BAMLH0A0HYM2', name: 'HY spread change', mode: 'difference' as const }];
    const factors: Record<string, Observation[]> = { market: histories.SPY.map(p => ({ date: p.date, value: p.close })) };
    await Promise.all(factorDefinitions.filter(f => f.id).map(async f => {
      try { factors[f.key] = await getFredSeries(f.id!, start); }
      catch { factors[f.key] = []; errors.push(`${f.name}: unavailable`); }
    }));
    const stale = symbols.filter(s => { const date = histories[s]?.at(-1)?.date; return !date || Date.now() - Date.parse(date) > 7 * 86400000; });
    for (const symbol of stale) { histories[symbol] = []; errors.push(`${symbol}: missing or stale history excluded`); }
    if (portfolio.positions.some(p => p.symbol === 'CASH')) histories.CASH = (histories.SPY ?? []).map(p => ({ ...p, close: 1 }));
    const risk = portfolioRisk(portfolio.positions, histories);
    const sensitivities = portfolio.positions.map(p => ({ symbol: p.symbol, weight: p.weight,
      factors: factorDefinitions.map(f => ({ ...f, ...factorSensitivity(histories[p.symbol] ?? [], factors[f.key] ?? [], f.mode) })) }));
    return NextResponse.json({ portfolio, risk, sensitivities, errors, fetchedAt: new Date().toISOString(),
      methodology: 'Two-year lookback; at least 60 shared intervals. Current constant weights applied to historical split-adjusted price returns. Distributions are excluded, including SGOV payouts; this is price risk, not total-return performance. Factor fits are separate univariate associations, not causal or additive. Standard errors assume independent residuals and may understate uncertainty.' });
  } catch (error) {
    logUpstreamError('Risk API error', error);
    return failedRequest(503);
  }
}
