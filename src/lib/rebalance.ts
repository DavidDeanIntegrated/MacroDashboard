// Rebalance recommendation engine — turns today's live weights into specific,
// dollar-level trade suggestions by mechanically applying the portfolio's own
// documented rules (target bands, sell/buy priority orders, the BTC no-forced-
// rebalance rule, and the SGOV emergency floor). No prediction, no discretion:
// every suggestion is traceable to a rule plus a live number.

import type { HoldingPosition } from './holdings';
import {
  computeSleeveData,
  computeSubSleeveData,
  getSleeveStatus,
  SUB_SLEEVE_TARGETS,
  REAL_ASSET_SUB_SLEEVE_TARGETS,
} from './sleeves';

// Rules encoded here (kept in one place so tuning is a one-line change):
const HC_TRIM_TO = 3;        // trim High Conviction (VST) to ~3% when it breaches its 4% cap
const QC_CAP = 17;           // trim Quality Compounders when the group exceeds 17%
const QC_TRIM_TO = 15.5;     // ...back to mid-band
const BTC_FORCED_DRIFT = 5;  // BTC is only force-rebalanced when >5pp beyond its band
export const SGOV_FLOOR = 150; // never let SGOV fall below this (emergency cash), in dollars
const URGENT_DRIFT = 5;      // >5pp outside a band = act now, else quarterly window

// Conviction Core (SPCX) — sized from the loss side: a total loss at the 8–10%
// target costs ~10% of the portfolio (recoverable), while a 5x adds ~+40pp.
// Managed by its own asymmetric rules, NOT the standard band logic:
// build with new money only (never forced buys, never funded by selling core),
// let it run between target and ceiling, trim only above the hard ceiling.
const CC_CEILING = 15;       // hard ceiling — above this, a single-name drawdown threatens the portfolio
const CC_TRIM_TO = 12;       // ...trim back to here, proceeds to SGOV
const CC_DIP_PCT = -20;      // accelerate planned adds when price is ≥20% below cost
const CC_HOUSE_MONEY_X = 2;  // at 2× cost, flag selling cost-basis-worth to play with house money

export interface RebalanceRec {
  kind: 'sell' | 'buy' | 'note';
  symbol?: string;
  amount?: number;          // dollars
  shares?: number;          // approximate shares at the current price
  price?: number;
  action: string;           // short instruction, e.g. "Sell $84 RKLB"
  reason: string;           // plain-English why, with live numbers
  urgency: 'now' | 'quarterly' | 'info';
}

export interface RebalancePlan {
  sells: RebalanceRec[];
  buys: RebalanceRec[];
  notes: RebalanceRec[];
  totalSell: number;
  totalBuy: number;
  /** buys minus sells: positive = plan needs this much new cash; negative = surplus parks in SGOV */
  fundingGap: number;
  allInRange: boolean;
  urgent: boolean;
  blockedReason?: string;
}

const usd = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

function sharesFor(amount: number, price?: number): number | undefined {
  if (!price || price <= 0) return undefined;
  return amount / price;
}

export function buildRebalancePlan(positions: HoldingPosition[], portfolioValue: number): RebalancePlan {
  const V = portfolioValue;
  const sells: RebalanceRec[] = [];
  const buys: RebalanceRec[] = [];
  const notes: RebalanceRec[] = [];

  const empty: RebalancePlan = {
    sells, buys, notes, totalSell: 0, totalBuy: 0, fundingGap: 0, allInRange: true, urgent: false,
  };
  if (!positions.length || V <= 0) return { ...empty, allInRange: false, blockedReason: 'No complete portfolio valuation.' };
  const supported = new Set(['VTI','VTV','VXUS','NVDA','TSM','MSFT','PLTR','VST','SPCX','GLD','BCI','BTC','SGOV','CASH']);
  if (positions.some(p => !Number.isFinite(p.marketValue) || p.marketValue < 0 || !Number.isFinite(p.currentPrice) || p.currentPrice <= 0 || !Number.isFinite(p.weight)) || Math.abs(positions.reduce((sum,p)=>sum+p.weight,0)-100) > .1 || Math.abs(positions.reduce((sum,p)=>sum+p.marketValue,0)-V) > Math.max(1,V*.001)) return { ...empty, allInRange: false, blockedReason: 'Incomplete or inconsistent valuation; suggestions withheld.' };
  if (positions.some(p => !supported.has(p.symbol) || p.category === 'Unclassified')) return { ...empty, allInRange: false, blockedReason: 'This account contains holdings outside the configured strategy. Define their categories and target rules before generating trades.' };
  const sold = new Map<string, number>();

  const sleeves = computeSleeveData(positions);
  const eqSubs = computeSubSleeveData(positions, SUB_SLEEVE_TARGETS);
  const raSubs = computeSubSleeveData(positions, REAL_ASSET_SUB_SLEEVE_TARGETS);
  const sleeve = (name: string) => sleeves.find((s) => s.name === name);
  const eqSub = (label: string) => eqSubs.find((s) => s.label === label);
  const pos = (symbol: string) => positions.find((p) => p.symbol === symbol);

  const pctToUsd = (pp: number) => (pp / 100) * V;
  const urgencyFor = (driftPp: number): 'now' | 'quarterly' => (driftPp > URGENT_DRIFT ? 'now' : 'quarterly');

  // Sell a dollar total across a set of positions proportionally to their sizes.
  // Returns the amount actually placed (capped by what the positions hold).
  function sellAcross(members: HoldingPosition[], total: number, reason: string, urgency: 'now' | 'quarterly'): number {
    const remaining = (m: HoldingPosition) => Math.max(0, m.marketValue - (sold.get(m.symbol) ?? 0));
    const sum = members.reduce((s, m) => s + remaining(m), 0);
    if (sum <= 0 || total < 1) return 0;
    const usable = Math.min(total, sum);
    for (const m of members) {
      const amount = (usable * remaining(m)) / sum;
      if (amount < 1) continue;
      sold.set(m.symbol, (sold.get(m.symbol) ?? 0) + amount);
      sells.push({
        kind: 'sell', symbol: m.symbol, amount, price: m.currentPrice,
        shares: sharesFor(amount, m.currentPrice),
        action: `Sell ${usd(amount)} of ${m.symbol}`,
        reason, urgency,
      });
    }
    return usable;
  }

  function buyOne(symbol: string, amount: number, reason: string, urgency: 'now' | 'quarterly') {
    if (amount < 1) return;
    const p = pos(symbol);
    buys.push({
      kind: 'buy', symbol, amount, price: p?.currentPrice,
      shares: sharesFor(amount, p?.currentPrice),
      action: `Buy ${usd(amount)} of ${symbol}`,
      reason, urgency,
    });
  }

  // How much SGOV can be spent without breaching the emergency floor.
  const sgovValue = pos('SGOV')?.marketValue ?? 0;
  const sgovSpendable = Math.max(0, sgovValue - SGOV_FLOOR);

  // ─── 1. Sleeve-level drift ───

  const eq = sleeve('Equities');
  const ra = sleeve('Real Assets');
  const dp = sleeve('Dry Powder');
  const crypto = sleeve('Crypto');

  // Dry-powder excess acts as a cash source; deficit becomes an SGOV buy.
  let dpExcessCash = 0;

  if (dp) {
    const status = getSleeveStatus(dp.weight, dp.targetMin, dp.targetMax);
    if (status === 'over') {
      dpExcessCash = Math.min(pctToUsd(dp.weight - dp.targetMax), sgovSpendable + (pos('CASH')?.marketValue ?? 0));
    } else if (status === 'under') {
      const deficit = pctToUsd(dp.targetMin - dp.weight);
      buyOne(
        'SGOV', deficit,
        `Dry Powder is ${dp.weight.toFixed(1)}% vs its ${dp.targetMin}–${dp.targetMax}% target. Per the contribution rules, replenishing SGOV comes first — the drawdown ladder only works if the cash reserve is stocked.`,
        urgencyFor(dp.targetMin - dp.weight)
      );
    }
  }

  // Equities over → sell per priority (High Conviction → Compounders → VTI/VTV)
  if (eq && getSleeveStatus(eq.weight, eq.targetMin, eq.targetMax) === 'over') {
    const driftPp = eq.weight - eq.targetMax;
    const urg = urgencyFor(driftPp);
    let need = pctToUsd(driftPp);
    const hc = eqSub('High Conviction');
    const qc = eqSub('Quality Compounders');
    const baseReason = `Equities are ${eq.weight.toFixed(1)}% vs the ${eq.targetMin}–${eq.targetMax}% band (${usd(need)} over).`;
    need -= sellAcross(hc?.members ?? [], need, `${baseReason} High-conviction names are sold first — most volatile, highest valuation risk.`, urg);
    if (need >= 1 && qc) {
      need -= sellAcross(qc.members, need, `${baseReason} High conviction couldn't cover the full trim, so quality compounders are trimmed proportionally next.`, urg);
    }
    if (need >= 1) {
      sellAcross(positions.filter((p) => ['VTI', 'VTV'].includes(p.symbol)), need, `${baseReason} Core index funds are trimmed only as a last resort — they're the most diversified holdings.`, urg);
    }
  }

  // Equities under → buy per priority (VTI first, then VXUS/VTV to their sub-bands)
  if (eq && getSleeveStatus(eq.weight, eq.targetMin, eq.targetMax) === 'under') {
    const driftPp = eq.targetMin - eq.weight;
    const urg = urgencyFor(driftPp);
    const need = pctToUsd(driftPp);
    const baseReason = `Equities are ${eq.weight.toFixed(1)}% vs the ${eq.targetMin}–${eq.targetMax}% band (${usd(need)} short).`;
    const vxus = eqSubs.find((s) => s.symbols.includes('VXUS'));
    const vtv = eqSubs.find((s) => s.symbols.includes('VTV'));
    const vxusDeficit = vxus && vxus.weight < vxus.targetMin ? Math.min(need, pctToUsd(vxus.targetMin - vxus.weight)) : 0;
    const vtvDeficit = vtv && vtv.weight < vtv.targetMin ? Math.min(Math.max(need - vxusDeficit, 0), pctToUsd(vtv.targetMin - vtv.weight)) : 0;
    const vtiAmount = Math.max(need - vxusDeficit - vtvDeficit, 0);
    buyOne('VTI', vtiAmount, `${baseReason} VTI is always the first equity buy — the broad, low-cost anchor.`, urg);
    if (vxusDeficit >= 1) buyOne('VXUS', vxusDeficit, `${baseReason} VXUS is also below its own ${vxus!.targetMin}–${vxus!.targetMax}% sub-band, so part of the add goes to international.`, urg);
    if (vtvDeficit >= 1) buyOne('VTV', vtvDeficit, `${baseReason} VTV is also below its own ${vtv!.targetMin}–${vtv!.targetMax}% sub-band, so part of the add goes to the value tilt.`, urg);
  }

  // Real Assets over/under → route via the GLD/BCI sub-bands
  if (ra) {
    const status = getSleeveStatus(ra.weight, ra.targetMin, ra.targetMax);
    if (status === 'over') {
      const driftPp = ra.weight - ra.targetMax;
      const urg = urgencyFor(driftPp);
      let need = pctToUsd(driftPp);
      // Trim whichever sub-sleeve is above its own band first
      for (const sub of raSubs) {
        if (need < 1) break;
        if (sub.weight > sub.targetMax) {
          need -= sellAcross(sub.members, Math.min(need, pctToUsd(sub.weight - sub.targetMax)),
            `Real Assets are ${ra.weight.toFixed(1)}% vs ${ra.targetMin}–${ra.targetMax}%, and ${sub.label} is above its own ${sub.targetMin}–${sub.targetMax}% sub-band.`, urg);
        }
      }
      if (need >= 1) {
        sellAcross(raSubs.flatMap((s) => s.members), need,
          `Real Assets are ${ra.weight.toFixed(1)}% vs ${ra.targetMin}–${ra.targetMax}% — remaining trim split proportionally across GLD/BCI.`, urg);
      }
    } else if (status === 'under') {
      const driftPp = ra.targetMin - ra.weight;
      const urg = urgencyFor(driftPp);
      let need = pctToUsd(driftPp);
      // Fill sub-sleeve deficits in order (GLD is the core hedge, BCI the top-up)
      for (const sub of raSubs) {
        if (need < 1) break;
        if (sub.weight < sub.targetMin) {
          const amt = Math.min(need, pctToUsd(sub.targetMin - sub.weight));
          buyOne(sub.symbols[0], amt,
            `Real Assets are ${ra.weight.toFixed(1)}% vs ${ra.targetMin}–${ra.targetMax}%, and ${sub.label} is below its own ${sub.targetMin}–${sub.targetMax}% sub-band — this is the sleeve that protects purchasing power when inflation runs.`, urg);
          need -= amt;
        }
      }
      if (need >= 1) buyOne('GLD', need, `Real Assets are ${ra.weight.toFixed(1)}% vs ${ra.targetMin}–${ra.targetMax}% — remainder goes to GLD, the core hedge.`, urg);
    }
  }

  // Conviction Core (SPCX) — asymmetric rules: ceiling-only trims, new-money-only builds
  const cc = sleeve('Conviction Core');
  if (cc && cc.positions.length > 0) {
    if (cc.weight > CC_CEILING) {
      sellAcross(cc.positions, pctToUsd(cc.weight - CC_TRIM_TO),
        `Conviction Core is ${cc.weight.toFixed(1)}% — above the ${CC_CEILING}% hard ceiling. This is the one line the thesis doesn't override: beyond ${CC_CEILING}%, a routine 50% drawdown in one name takes ~7%+ off the whole portfolio. Trim back to ~${CC_TRIM_TO}%; proceeds to SGOV.`,
        'now');
    } else if (cc.weight > cc.targetMax) {
      notes.push({
        kind: 'note', symbol: 'SPCX',
        action: `SPCX at ${cc.weight.toFixed(1)}% — above target, under the ${CC_CEILING}% ceiling: let it run`,
        reason: `The band is asymmetric by design: winners are allowed to outgrow the ${cc.targetMin}–${cc.targetMax}% target and are only trimmed at the ${CC_CEILING}% hard ceiling. No action — and no new adds while above target.`,
        urgency: 'info',
      });
    } else if (cc.weight < cc.targetMin) {
      notes.push({
        kind: 'note', symbol: 'SPCX',
        action: `SPCX at ${cc.weight.toFixed(1)}% vs its ${cc.targetMin}–${cc.targetMax}% build target — fund with new money only (${usd(pctToUsd(cc.targetMin - cc.weight))} to reach ${cc.targetMin}%)`,
        reason: `The build is deliberately funded by contributions, never by selling core holdings — the boring sleeves (VTI/GLD/SGOV) are what make a position this aggressive survivable. If the price is falling, do NOT accelerate beyond the planned schedule; forced averaging-down is how conviction positions become portfolio-killers.`,
        urgency: 'info',
      });
    }

    // Dip-accelerated add + house-money flags, driven by cost basis
    const spcx = cc.positions.find((p) => p.symbol === 'SPCX');
    if (spcx?.costBasis && spcx.costBasis > 0 && spcx.currentPrice > 0) {
      const dist = ((spcx.currentPrice - spcx.costBasis) / spcx.costBasis) * 100;
      if (dist <= CC_DIP_PCT && cc.weight < cc.targetMax) {
        notes.push({
          kind: 'note', symbol: 'SPCX',
          action: `SPCX is ${dist.toFixed(0)}% below cost — dip-accelerated add window open`,
          reason: `Planned contributions to the build can be accelerated while price is ≥20% below your ${usd(spcx.costBasis)} average cost — but only with new money, only while the 5-year thesis is intact, and never past the ${cc.targetMax}% target.`,
          urgency: 'info',
        });
      }
      if (spcx.currentPrice >= CC_HOUSE_MONEY_X * spcx.costBasis) {
        const principal = spcx.qty * spcx.costBasis;
        notes.push({
          kind: 'note', symbol: 'SPCX',
          action: `SPCX has ${(spcx.currentPrice / spcx.costBasis).toFixed(1)}×'d from cost — house-money rule available: sell ~${usd(principal)} to recover principal`,
          reason: `Recovering the original principal changes your cumulative cash flows, not the economic risk of the remaining shares — the remaining position still has market value at risk and can lose its entire value. Optional, but it's the cleanest way to hold an aggressive position with a calm stomach.`,
          urgency: 'info',
        });
      }
    }
  }

  // Crypto — no forced rebalance unless drift exceeds the 5pp trigger
  if (crypto) {
    const status = getSleeveStatus(crypto.weight, crypto.targetMin, crypto.targetMax);
    if (status === 'over') {
      const driftPp = crypto.weight - crypto.targetMax;
      if (driftPp > BTC_FORCED_DRIFT) {
        sellAcross(crypto.positions, pctToUsd(driftPp - BTC_FORCED_DRIFT + (BTC_FORCED_DRIFT / 2)),
          `BTC is ${crypto.weight.toFixed(1)}% vs its ${crypto.targetMin}–${crypto.targetMax}% band — beyond the ${BTC_FORCED_DRIFT}pp no-touch buffer, so the drift trigger fires and a partial trim applies.`, 'now');
      } else {
        notes.push({
          kind: 'note', symbol: 'BTC',
          action: 'Hold BTC — no forced trim',
          reason: `BTC is ${crypto.weight.toFixed(1)}%, above its ${crypto.targetMin}–${crypto.targetMax}% band but within the ${BTC_FORCED_DRIFT}pp no-touch buffer. The plan's rule: let new contributions dilute it back toward target naturally rather than selling.`,
          urgency: 'info',
        });
      }
    } else if (status === 'under') {
      notes.push({
        kind: 'note', symbol: 'BTC',
        action: 'BTC under target — no action required',
        reason: `BTC is ${crypto.weight.toFixed(1)}% vs its ${crypto.targetMin}–${crypto.targetMax}% band. The plan doesn't force crypto buys; the band is a ceiling on risk, not a floor to chase.`,
        urgency: 'info',
      });
    }
  }

  // ─── 2. Internal sub-sleeve checks (only when the parent sleeve is in range) ───

  if (eq && getSleeveStatus(eq.weight, eq.targetMin, eq.targetMax) === 'in-range') {
    const hc = eqSub('High Conviction');
    const qc = eqSub('Quality Compounders');

    if (hc && hc.weight > hc.targetMax + 0.5) {
      const amt = pctToUsd(hc.weight - HC_TRIM_TO);
      const placed = sellAcross(hc.members, amt,
        `High Conviction is ${hc.weight.toFixed(1)}% vs its ${hc.targetMax}% cap while total equities are fine — an internal rebalance: trim the volatile names, recycle into VTI so overall equity exposure is unchanged.`,
        urgencyFor(hc.weight - hc.targetMax));
      buyOne('VTI', placed, 'Recycle the high-conviction trim into VTI — total equities stay the same; only the internal risk mix changes.', urgencyFor(hc.weight - hc.targetMax));
    }

    if (qc && qc.weight > QC_CAP) {
      const amt = pctToUsd(qc.weight - QC_TRIM_TO);
      const placed = sellAcross(qc.members, amt,
        `Quality Compounders are ${qc.weight.toFixed(1)}% vs their ${QC_CAP}% ceiling — trim the group back toward ${QC_TRIM_TO}% and recycle into VTI.`,
        urgencyFor(qc.weight - QC_CAP));
      buyOne('VTI', placed, 'Recycle the compounder trim into VTI to keep total equity exposure unchanged.', urgencyFor(qc.weight - QC_CAP));
    }

    if (qc && qc.weight < 13) {
      notes.push({
        kind: 'note',
        action: 'Compounders below 13% — add on dips with new money',
        reason: `Quality Compounders are ${qc.weight.toFixed(1)}%, under the 13% add-threshold. The rule is to add with new contributions (equal split NVDA/TSM/MSFT/PLTR), preferably on down days — not to sell other holdings to fund it.`,
        urgency: 'info',
      });
    }

    for (const sub of eqSubs.filter((s) => ['VTI (Broad US Core)', 'VTV (Value)', 'VXUS (International)'].includes(s.label))) {
      if (sub.weight < sub.targetMin - 0.5) {
        notes.push({
          kind: 'note', symbol: sub.symbols[0],
          action: `${sub.symbols[0]} light within equities — direct next contribution there`,
          reason: `${sub.label} is ${sub.weight.toFixed(1)}% vs its ${sub.targetMin}–${sub.targetMax}% sub-band, but total equities are in range — so fund it with new money per the buy-priority order rather than selling anything.`,
          urgency: 'info',
        });
      }
    }
  }

  // High-conviction 20%-dip rule — flag names eligible for a new-money add
  const hcAll = eqSub('High Conviction');
  for (const m of hcAll?.members ?? []) {
    if (m.costBasis && m.costBasis > 0) {
      const dist = ((m.currentPrice - m.costBasis) / m.costBasis) * 100;
      if (dist <= -20) {
        notes.push({
          kind: 'note', symbol: m.symbol,
          action: `${m.symbol} is ${dist.toFixed(0)}% below cost — 20%-dip rule active`,
          reason: `Eligible for a small high-conviction add (new money only, 0.5–1% of portfolio max, thesis intact, combined sleeve under 6.5%). Never funded by selling other holdings.`,
          urgency: 'info',
        });
      }
    }
  }

  // ─── 3. Funding + netting ───

  const totalSell = sells.reduce((s, r) => s + (r.amount ?? 0), 0);
  const totalBuy = buys.reduce((s, r) => s + (r.amount ?? 0), 0);
  const available = totalSell + dpExcessCash;
  const fundingGap = totalBuy - available;

  if (dpExcessCash >= 1 && totalBuy >= 1) {
    notes.push({
      kind: 'note', symbol: 'SGOV',
      action: `Fund up to ${usd(Math.min(dpExcessCash, totalBuy))} of the buys from SGOV`,
      reason: `Dry Powder is above its target band, so its excess is the first funding source for the buys — while always keeping at least ${usd(SGOV_FLOOR)} in SGOV as the emergency floor.`,
      urgency: 'info',
    });
  }
  if (fundingGap > 1) {
    notes.push({
      kind: 'note',
      action: `Fund the remaining ${usd(fundingGap)} with new contributions`,
      reason: `Sells${dpExcessCash >= 1 ? ' plus deployable SGOV' : ''} cover ${usd(available)} of the ${usd(totalBuy)} in suggested buys. The cleanest, most tax-efficient way to close the rest is new money, per the contribution priority — not deeper selling.`,
      urgency: 'info',
    });
  } else if (fundingGap < -1) {
    buyOne('SGOV', -fundingGap,
      'Sell proceeds exceed the suggested buys — park the surplus in SGOV, where it earns T-bill yield until the next deployment or rebalance.',
      'quarterly');
  }

  const actionable = sells.length + buys.length;
  return {
    sells, buys, notes,
    totalSell,
    totalBuy: buys.reduce((s, r) => s + (r.amount ?? 0), 0),
    fundingGap,
    allInRange: actionable === 0,
    urgent: [...sells, ...buys].some((r) => r.urgency === 'now'),
  };
}

// Next quarterly rebalance checkpoint (last day of Mar/Jun/Sep/Dec).
export function nextQuarterEnd(from = new Date()): string {
  const y = from.getFullYear();
  const qEndMonth = [2, 5, 8, 11].find((m) => {
    const end = new Date(y, m + 1, 0);
    return end >= from;
  });
  const d = qEndMonth != null ? new Date(y, qEndMonth + 1, 0) : new Date(y + 1, 2, 31);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
