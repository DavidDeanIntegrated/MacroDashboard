import { NextResponse } from 'next/server';
import { getHoldingsPortfolio } from '@/lib/holdings';
import { getAggregates } from '@/lib/polygon';
import { getFredSeries } from '@/lib/fred';
import { portfolioRisk, factorSensitivity } from '@/lib/portfolio-risk';
import type { Observation } from '@/lib/time-series';
import { config } from '@/lib/config';

// Two years of daily history for every holding plus three FRED factor series.
export const maxDuration = 60;

export async function GET() {
  try {
    const portfolio = await getHoldingsPortfolio();
    if (!config.polygon.apiKey) throw new Error('POLYGON_API_KEY is required for historical risk estimates.');
    const from = new Date(); from.setUTCFullYear(from.getUTCFullYear() - 2);
    const start = from.toISOString().slice(0, 10);
    const histories: Record<string, Awaited<ReturnType<typeof getAggregates>>> = {};
    const errors: string[] = [];
    const symbols = Array.from(new Set([...portfolio.positions.filter(p => p.symbol !== 'CASH').map(p => p.symbol), 'SPY']));
    for (let i = 0; i < symbols.length; i += 4) await Promise.all(symbols.slice(i, i + 4).map(async symbol => {
      try { histories[symbol] = await getAggregates(symbol, '1day', start, undefined, 5000); }
      catch { histories[symbol] = []; errors.push(`${symbol}: historical prices unavailable`); }
    }));
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
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Risk data unavailable' }, { status: 503 });
  }
}
