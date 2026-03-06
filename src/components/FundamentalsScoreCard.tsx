'use client';

import { useState } from 'react';
import { Card, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';

interface ScoreData {
  symbol: string;
  total: number;
  grade: 'Strong Buy' | 'Buy' | 'Hold' | 'Weak' | 'Poor';
  gradeColor: string;
  breakdown: {
    profitabilityPts: number;
    profitabilityMax: number;
    profitabilityDetail: {
      netMarginPts: number; grossMarginPts: number; roePts: number;
      netMargin: number | null; grossMargin: number | null; roe: number | null;
    };
    growthPts: number;
    growthMax: number;
    growthDetail: {
      revenueGrowthPts: number; epsGrowthPts: number;
      revenueGrowth: number | null; epsGrowth: number | null;
    };
    valuationPts: number;
    valuationMax: number;
    valuationDetail: {
      pePts: number; pbPts: number; psPts: number;
      pe: number | null; pb: number | null; ps: number | null;
    };
    healthPts: number;
    healthMax: number;
    healthDetail: {
      debtEquityPts: number; currentRatioPts: number; cashDebtPts: number;
      debtToEquity: number | null; currentRatio: number | null; cashToDebt: number | null;
    };
    earningsQualityPts: number;
    earningsQualityMax: number;
    earningsQualityDetail: {
      beatRatePts: number; surprisePts: number;
      beatRate: number | null; avgSurprise: number | null; quartersAnalyzed: number;
    };
  };
  rationale: string;
  unavailable?: boolean;
  unavailableReason?: string;
}

function pillarBar(label: string, pts: number, max: number) {
  const pct = max > 0 ? (pts / max) * 100 : 0;
  const color = pct >= 75 ? 'bg-accent-green' : pct >= 50 ? 'bg-accent-blue' : pct >= 25 ? 'bg-accent-orange' : 'bg-accent-red';
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-black/50 w-24 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-black/[0.06] rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold text-black/65 w-12 text-right tabular-nums">{pts}/{max}</span>
    </div>
  );
}

function metricRow(label: string, value: number | null, suffix: string, pts: number, maxPts: number) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-black/45">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-black/65 tabular-nums">
          {value !== null ? `${value.toFixed(1)}${suffix}` : 'N/A'}
        </span>
        <span className="font-semibold text-black/75 tabular-nums w-8 text-right">{pts}/{maxPts}</span>
      </div>
    </div>
  );
}

function ScoreDetail({ score }: { score: ScoreData }) {
  const b = score.breakdown;
  return (
    <div className="space-y-4 mt-4 pt-4 border-t border-black/[0.06]">
      {/* Profitability */}
      <div>
        <p className="text-xs font-semibold text-black/60 uppercase tracking-wider mb-1.5">Profitability ({b.profitabilityPts}/{b.profitabilityMax})</p>
        <div className="space-y-1">
          {metricRow('Net Margin', b.profitabilityDetail.netMargin, '%', b.profitabilityDetail.netMarginPts, 10)}
          {metricRow('Gross Margin', b.profitabilityDetail.grossMargin, '%', b.profitabilityDetail.grossMarginPts, 8)}
          {metricRow('ROE', b.profitabilityDetail.roe, '%', b.profitabilityDetail.roePts, 7)}
        </div>
      </div>
      {/* Growth */}
      <div>
        <p className="text-xs font-semibold text-black/60 uppercase tracking-wider mb-1.5">Growth ({b.growthPts}/{b.growthMax})</p>
        <div className="space-y-1">
          {metricRow('Revenue Growth', b.growthDetail.revenueGrowth, '%', b.growthDetail.revenueGrowthPts, 10)}
          {metricRow('EPS Growth', b.growthDetail.epsGrowth, '%', b.growthDetail.epsGrowthPts, 10)}
        </div>
      </div>
      {/* Valuation */}
      <div>
        <p className="text-xs font-semibold text-black/60 uppercase tracking-wider mb-1.5">Valuation ({b.valuationPts}/{b.valuationMax})</p>
        <div className="space-y-1">
          {metricRow('P/E', b.valuationDetail.pe, 'x', b.valuationDetail.pePts, 10)}
          {metricRow('P/B', b.valuationDetail.pb, 'x', b.valuationDetail.pbPts, 5)}
          {metricRow('P/S', b.valuationDetail.ps, 'x', b.valuationDetail.psPts, 5)}
        </div>
      </div>
      {/* Financial Health */}
      <div>
        <p className="text-xs font-semibold text-black/60 uppercase tracking-wider mb-1.5">Financial Health ({b.healthPts}/{b.healthMax})</p>
        <div className="space-y-1">
          {metricRow('Debt/Equity', b.healthDetail.debtToEquity, 'x', b.healthDetail.debtEquityPts, 8)}
          {metricRow('Current Ratio', b.healthDetail.currentRatio, 'x', b.healthDetail.currentRatioPts, 6)}
          {metricRow('Cash/Debt', b.healthDetail.cashToDebt, 'x', b.healthDetail.cashDebtPts, 6)}
        </div>
      </div>
      {/* Earnings Quality */}
      <div>
        <p className="text-xs font-semibold text-black/60 uppercase tracking-wider mb-1.5">Earnings Quality ({b.earningsQualityPts}/{b.earningsQualityMax})</p>
        <div className="space-y-1">
          {metricRow('Beat Rate', b.earningsQualityDetail.beatRate, '%', b.earningsQualityDetail.beatRatePts, 10)}
          {metricRow('Avg Surprise', b.earningsQualityDetail.avgSurprise, '%', b.earningsQualityDetail.surprisePts, 5)}
          <div className="flex items-center justify-between text-xs">
            <span className="text-black/45">Quarters Analyzed</span>
            <span className="text-black/65">{b.earningsQualityDetail.quartersAnalyzed}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FundamentalsScoreSection({
  scores,
  loading,
  title = 'Fundamental Analysis Scores',
  subtitle = 'Composite score (0–100) based on profitability, growth, valuation, financial health, and earnings quality',
}: {
  scores: ScoreData[] | null;
  loading: boolean;
  title?: string;
  subtitle?: string;
}) {
  const [expandedSymbol, setExpandedSymbol] = useState<string | null>(null);

  if (loading) {
    return (
      <Card>
        <CardTitle>{title}</CardTitle>
        <p className="text-xs text-black/40 mt-1">{subtitle}</p>
        <div className="flex items-center justify-center h-32 text-black/25 text-sm mt-4">
          Loading fundamental scores...
        </div>
      </Card>
    );
  }

  if (!scores || scores.length === 0) return null;

  const scoreable = scores.filter((s) => !s.unavailable).sort((a, b) => b.total - a.total);
  const nonScoreable = scores.filter((s) => s.unavailable);

  return (
    <>
      <div>
        <h3 className="text-lg font-semibold text-black/75 tracking-tight mb-1">{title}</h3>
        <p className="text-xs text-black/40 mb-4">{subtitle}</p>
      </div>

      <Card padding="none">
        <div className="px-6 pt-6 pb-3">
          <CardTitle>Scores by Stock</CardTitle>
          <p className="text-xs text-black/40 mt-1">Click a stock to see the full breakdown</p>
        </div>
        <div className="divide-y divide-black/[0.04]">
          {scoreable.map((score) => (
            <div key={score.symbol}>
              <div
                className="px-6 py-4 cursor-pointer hover:bg-black/[0.02] transition-colors"
                onClick={() => setExpandedSymbol(expandedSymbol === score.symbol ? null : score.symbol)}
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-sm font-semibold text-black/85 w-12 shrink-0">{score.symbol}</span>
                    <span className={`inline-block px-2 py-0.5 rounded-md text-xs font-semibold border ${score.gradeColor}`}>
                      {score.grade}
                    </span>
                    <span className="text-2xl font-black text-black/80 tabular-nums">{score.total}</span>
                    <span className="text-xs text-black/35">/100</span>
                  </div>
                  <div className="hidden md:flex items-center gap-1.5 shrink-0">
                    {/* Mini pillar bars */}
                    {[
                      { l: 'P', pts: score.breakdown.profitabilityPts, max: score.breakdown.profitabilityMax },
                      { l: 'G', pts: score.breakdown.growthPts, max: score.breakdown.growthMax },
                      { l: 'V', pts: score.breakdown.valuationPts, max: score.breakdown.valuationMax },
                      { l: 'H', pts: score.breakdown.healthPts, max: score.breakdown.healthMax },
                      { l: 'E', pts: score.breakdown.earningsQualityPts, max: score.breakdown.earningsQualityMax },
                    ].map((p) => {
                      const pct = p.max > 0 ? (p.pts / p.max) * 100 : 0;
                      const c = pct >= 75 ? 'bg-accent-green' : pct >= 50 ? 'bg-accent-blue' : pct >= 25 ? 'bg-accent-orange' : 'bg-accent-red';
                      return (
                        <div key={p.l} className="flex flex-col items-center gap-0.5" title={`${p.l}: ${p.pts}/${p.max}`}>
                          <div className="w-5 h-1.5 bg-black/[0.06] rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${c}`} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[9px] text-black/30">{p.l}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <p className="text-xs text-black/50 mt-2 leading-relaxed">{score.rationale}</p>
              </div>
              {expandedSymbol === score.symbol && (
                <div className="px-6 pb-5">
                  <div className="space-y-2 mb-3">
                    {pillarBar('Profitability', score.breakdown.profitabilityPts, score.breakdown.profitabilityMax)}
                    {pillarBar('Growth', score.breakdown.growthPts, score.breakdown.growthMax)}
                    {pillarBar('Valuation', score.breakdown.valuationPts, score.breakdown.valuationMax)}
                    {pillarBar('Health', score.breakdown.healthPts, score.breakdown.healthMax)}
                    {pillarBar('Earnings', score.breakdown.earningsQualityPts, score.breakdown.earningsQualityMax)}
                  </div>
                  <ScoreDetail score={score} />
                </div>
              )}
            </div>
          ))}
          {nonScoreable.length > 0 && (
            <div className="px-6 py-3">
              <p className="text-xs text-black/35 mb-2">Not scored (ETFs/Crypto):</p>
              <div className="flex flex-wrap gap-2">
                {nonScoreable.map((s) => (
                  <span key={s.symbol} className="inline-flex items-center gap-1.5 text-xs text-black/45">
                    <span className="font-semibold">{s.symbol}</span>
                    <Badge variant="neutral">{s.unavailableReason === 'Crypto asset — no traditional financial statements' ? 'Crypto' : 'ETF'}</Badge>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Methodology */}
      <Card>
        <CardTitle>Fundamental Score — Methodology</CardTitle>
        <div className="mt-3 space-y-3 text-xs text-black/55 leading-relaxed">
          <p>
            Each stock receives a composite score from 0–100, computed across five pillars using data from SEC EDGAR filings, Finnhub valuation metrics, and earnings history. Scores update automatically as new filings and earnings reports become available.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 bg-black/[0.02] rounded-lg">
              <p className="font-semibold text-black/65 mb-1">Profitability (25 pts)</p>
              <p>Net margin, gross margin, and return on equity. Measures how efficiently the company converts revenue into profit and returns value to shareholders.</p>
            </div>
            <div className="p-3 bg-black/[0.02] rounded-lg">
              <p className="font-semibold text-black/65 mb-1">Growth (20 pts)</p>
              <p>Year-over-year revenue and EPS growth (TTM). Higher growth earns more points, with declining metrics scoring zero.</p>
            </div>
            <div className="p-3 bg-black/[0.02] rounded-lg">
              <p className="font-semibold text-black/65 mb-1">Valuation (20 pts)</p>
              <p>P/E, P/B, and P/S ratios. Lower multiples score higher, reflecting cheaper entry points. Negative PE (unprofitable) scores zero.</p>
            </div>
            <div className="p-3 bg-black/[0.02] rounded-lg">
              <p className="font-semibold text-black/65 mb-1">Financial Health (20 pts)</p>
              <p>Debt-to-equity, current ratio, and cash-to-debt. Rewards strong balance sheets with low leverage and ample liquidity.</p>
            </div>
            <div className="p-3 bg-black/[0.02] rounded-lg md:col-span-2">
              <p className="font-semibold text-black/65 mb-1">Earnings Quality (15 pts)</p>
              <p>Beat rate (% of quarters exceeding estimates) and average surprise magnitude. Consistent beats signal strong execution and conservative guidance.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-accent-green/20 text-green-800">80+ Strong Buy</span>
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-accent-green/10 text-green-700">65-79 Buy</span>
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-accent-blue/10 text-blue-700">50-64 Hold</span>
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-accent-orange/10 text-orange-700">35-49 Weak</span>
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-accent-red/10 text-red-700">0-34 Poor</span>
          </div>
        </div>
      </Card>
    </>
  );
}
