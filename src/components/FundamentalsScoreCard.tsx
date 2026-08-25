'use client';

import { useState } from 'react';
import { Card, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import type { FundamentalsScore } from '@/lib/fundamentals-score';

type ScoreData = FundamentalsScore;

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

function metricRow(label: string, value: number | null, suffix: string, pts: number, maxPts: number, naLabel = 'N/A') {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-black/45">{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-black/65 tabular-nums">
          {value !== null ? `${value.toFixed(1)}${suffix}` : naLabel}
        </span>
        <span className="font-semibold text-black/75 tabular-nums w-8 text-right">{pts}/{maxPts}</span>
      </div>
    </div>
  );
}

function ScoreDetail({ score }: { score: ScoreData }) {
  const b = score.breakdown;
  const pr = score.preRevenue ? 'Pre-revenue' : 'N/A';
  const ed = b.earningsQualityDetail;
  const trendBasis = ed.basis === 'filings-trend';
  const sources = Array.from(new Set(Object.values(b.meta.sources).filter((s): s is NonNullable<typeof s> => s !== undefined)));
  const sourceLabel: Record<string, string> = { polygon: 'Polygon filings', finnhub: 'Finnhub', edgar: 'SEC EDGAR' };
  return (
    <div className="space-y-4 mt-4 pt-4 border-t border-black/[0.06]">
      {score.preRevenue && (
        <div className="px-3 py-2 bg-amber-50 border border-amber-200/60 rounded-lg">
          <p className="text-xs text-amber-700">Pre-revenue company — profitability, growth, and earnings metrics are not yet applicable. Score reflects available balance sheet and valuation data only.</p>
        </div>
      )}
      {/* Profitability */}
      <div>
        <p className="text-xs font-semibold text-black/60 uppercase tracking-wider mb-1.5">Profitability ({b.profitabilityPts}/{b.profitabilityMax})</p>
        <div className="space-y-1">
          {metricRow('Net Margin', b.profitabilityDetail.netMargin, '%', b.profitabilityDetail.netMarginPts, 10, pr)}
          {metricRow('Gross Margin', b.profitabilityDetail.grossMargin, '%', b.profitabilityDetail.grossMarginPts, 8, b.meta.sectorProfile === 'financial' ? 'N/A (sector)' : pr)}
          {metricRow(b.profitabilityDetail.roeBasis === 'roa' ? 'ROA (neg. equity)' : 'ROE', b.profitabilityDetail.roe, '%', b.profitabilityDetail.roePts, 7)}
        </div>
      </div>
      {/* Growth */}
      <div>
        <p className="text-xs font-semibold text-black/60 uppercase tracking-wider mb-1.5">Growth ({b.growthPts}/{b.growthMax})</p>
        <div className="space-y-1">
          {metricRow('Revenue Growth', b.growthDetail.revenueGrowth, '%', b.growthDetail.revenueGrowthPts, 10, pr)}
          {metricRow(b.growthDetail.lossNarrowing ? 'EPS Growth (loss narrowing)' : 'EPS Growth', b.growthDetail.epsGrowth, '%', b.growthDetail.epsGrowthPts, 10, pr)}
        </div>
      </div>
      {/* Valuation */}
      <div>
        <p className="text-xs font-semibold text-black/60 uppercase tracking-wider mb-1.5">Valuation ({b.valuationPts}/{b.valuationMax})</p>
        <div className="space-y-1">
          {b.valuationDetail.peBasis === 'peg'
            ? metricRow(`PEG (${b.valuationDetail.pe?.toFixed(1)}x P/E ÷ growth)`, b.valuationDetail.peg, '', b.valuationDetail.pePts, 10)
            : metricRow('P/E', b.valuationDetail.pe, 'x', b.valuationDetail.pePts, 10, pr)}
          {metricRow('P/B', b.valuationDetail.pb, 'x', b.valuationDetail.pbPts, 5)}
          {metricRow('P/S', b.valuationDetail.ps, 'x', b.valuationDetail.psPts, 5, b.meta.sectorProfile === 'financial' ? 'N/A (sector)' : pr)}
        </div>
      </div>
      {/* Financial Health */}
      <div>
        <p className="text-xs font-semibold text-black/60 uppercase tracking-wider mb-1.5">Financial Health ({b.healthPts}/{b.healthMax})</p>
        <div className="space-y-1">
          {metricRow('Debt/Equity', b.healthDetail.debtToEquity, 'x', b.healthDetail.debtEquityPts, 8)}
          {metricRow('Current Ratio', b.healthDetail.currentRatio, 'x', b.healthDetail.currentRatioPts, 6, b.meta.sectorProfile === 'financial' ? 'N/A (sector)' : 'N/A')}
          {metricRow('Cash/Debt', b.healthDetail.cashToDebt, 'x', b.healthDetail.cashDebtPts, 6, b.meta.sectorProfile === 'financial' ? 'N/A (sector)' : 'N/A')}
        </div>
      </div>
      {/* Earnings & Cash Quality */}
      <div>
        <p className="text-xs font-semibold text-black/60 uppercase tracking-wider mb-1.5">Earnings &amp; Cash Quality ({b.earningsQualityPts}/{b.earningsQualityMax})</p>
        <div className="space-y-1">
          {metricRow(trendBasis ? 'EPS Trend (YoY, SEC filings)' : 'Beat Rate', ed.beatRate, '%', ed.beatRatePts, 5)}
          {metricRow(trendBasis ? 'Latest EPS Positive' : 'Avg Surprise', trendBasis ? null : ed.avgSurprise, '%', ed.surprisePts, 3, trendBasis ? (ed.surprisePts > 0 ? 'Yes' : 'No') : 'N/A')}
          {metricRow('FCF Conversion', ed.fcfConversion !== null ? ed.fcfConversion * 100 : null, '%', ed.fcfConversionPts, 4, b.meta.sectorProfile === 'financial' ? 'N/A (sector)' : 'N/A')}
          {metricRow('FCF Margin', ed.fcfMargin, '%', ed.fcfMarginPts, 3, b.meta.sectorProfile === 'financial' ? 'N/A (sector)' : 'N/A')}
          <div className="flex items-center justify-between text-xs">
            <span className="text-black/45">Quarters Analyzed</span>
            <span className="text-black/65">{ed.quartersAnalyzed}</span>
          </div>
        </div>
      </div>
      {/* Provenance footer */}
      <div className="pt-2 border-t border-black/[0.04] flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-black/40">
        <span>
          Profile: <span className="font-medium text-black/55">{b.meta.sectorProfile === 'default' ? 'General' : b.meta.sectorProfile === 'financial' ? 'Financial' : 'Utility / Power'}</span>
        </span>
        <span>
          Data coverage: <span className={`font-medium ${b.meta.coveragePct >= 60 ? 'text-black/55' : 'text-orange-600'}`}>{b.meta.coveragePct.toFixed(0)}%</span>
        </span>
        {sources.length > 0 && (
          <span>Sources: {sources.map((s) => sourceLabel[s] ?? s).join(' · ')}</span>
        )}
        {b.meta.dataAsOf && <span>Filings through {b.meta.dataAsOf}</span>}
      </div>
    </div>
  );
}

export function FundamentalsScoreSection({
  scores,
  loading,
  error,
  title = 'Fundamental Analysis Scores',
  subtitle = 'Composite score (0–100) based on profitability, growth, valuation, financial health, and earnings & cash quality — sector-aware, growth-adjusted',
}: {
  scores: ScoreData[] | null;
  loading: boolean;
  error?: string | null;
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

  if (error) {
    return (
      <Card>
        <CardTitle>{title}</CardTitle>
        <p className="text-xs text-black/40 mt-1">{subtitle}</p>
        <div className="flex items-center justify-center h-32 text-red-400/60 text-sm mt-4">
          Failed to load scores: {error}
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
                    {score.preRevenue && (
                      <span className="inline-block px-2 py-0.5 rounded-md text-xs font-medium border border-amber-200 bg-amber-50 text-amber-700">
                        Pre-revenue
                      </span>
                    )}
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
            Each stock receives a composite score from 0–100, computed across five pillars using data from Polygon filings, SEC EDGAR, Finnhub valuation metrics, and earnings history. Metrics score on smooth piecewise-linear curves (no bucket cliffs), thresholds adapt to the company&apos;s sector (financials and utilities are judged against their own norms, not software norms), and each pillar renormalizes over the metrics that actually have data — with the coverage %% reported per stock. Grades describe fundamentals quality only; buy/sell decisions belong to the rebalance rules.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-3 bg-black/[0.02] rounded-lg">
              <p className="font-semibold text-black/65 mb-1">Profitability (25 pts)</p>
              <p>Net margin, gross margin, and return on equity (falling back to return on assets for buyback-heavy companies with negative book equity). Measures how efficiently the company converts revenue into profit.</p>
            </div>
            <div className="p-3 bg-black/[0.02] rounded-lg">
              <p className="font-semibold text-black/65 mb-1">Growth (20 pts)</p>
              <p>Year-over-year revenue and EPS growth. A shrinking loss is credited as improvement but capped well below profitable growth — it never scores like real earnings momentum.</p>
            </div>
            <div className="p-3 bg-black/[0.02] rounded-lg">
              <p className="font-semibold text-black/65 mb-1">Valuation (20 pts)</p>
              <p>Growth-adjusted P/E (scored as PEG when EPS growth is meaningful, so fast compounders aren&apos;t auto-penalized vs cheap decliners), plus P/B and P/S. Negative earnings score zero on P/E.</p>
            </div>
            <div className="p-3 bg-black/[0.02] rounded-lg">
              <p className="font-semibold text-black/65 mb-1">Financial Health (20 pts)</p>
              <p>Debt-to-equity, current ratio, and cash-to-debt — scored against sector norms, so a utility&apos;s structural leverage isn&apos;t judged like a software company&apos;s.</p>
            </div>
            <div className="p-3 bg-black/[0.02] rounded-lg md:col-span-2">
              <p className="font-semibold text-black/65 mb-1">Earnings &amp; Cash Quality (15 pts)</p>
              <p>Beat rate and surprise vs analyst estimates (or a year-over-year SEC-filings EPS trend when no estimates exist), plus free-cash-flow conversion and FCF margin — do reported earnings actually turn into cash?</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-accent-green/20 text-green-800">80+ Excellent</span>
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-accent-green/10 text-green-700">65-79 Good</span>
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-accent-blue/10 text-blue-700">50-64 Fair</span>
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-accent-orange/10 text-orange-700">35-49 Weak</span>
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-accent-red/10 text-red-700">0-34 Poor</span>
          </div>
        </div>
      </Card>
    </>
  );
}
