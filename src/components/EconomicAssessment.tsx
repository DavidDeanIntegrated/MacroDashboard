'use client';

import type { EconomicAssessment as Assessment } from '@/lib/economy';
import { Card, CardTitle } from './ui/Card';

const fmt = (v: number | null) => v === null ? '—' : v.toFixed(2);
export function EconomicAssessment({ assessment }: { assessment?: Assessment }) {
  if (!assessment) return <Card><CardTitle>Economic evidence unavailable</CardTitle><p>Waiting for the economic data service.</p></Card>;
  return <Card>
    <CardTitle>Economic direction and evidence</CardTitle>
    <p className="text-sm text-black/60 mt-2">{assessment.description}</p>
    <p className="text-xs text-black/45 mt-1">As of {assessment.asOf}. Rule-based scores, not forecast probabilities. Growth is assessed independently of inflation and financial conditions.</p>
    <div className="grid sm:grid-cols-3 gap-4 my-4">
      {(['growth', 'inflation', 'financial'] as const).map(key => {
        const axis = assessment.axes[key];
        return <div key={key} className="rounded-xl bg-black/[.03] p-4">
          <h4 className="capitalize font-medium">{key === 'financial' ? 'Financial conditions' : key}</h4>
          <p className="text-lg tabular-nums">Level {fmt(axis.score)} · Momentum {fmt(axis.momentum)}</p>
          <p className="text-xs text-black/55">{key === 'growth' ? 'Positive = expansion / acceleration' : key === 'inflation' ? 'Positive = inflation pressure / increasing pressure' : 'Positive = restrictive / tightening'}</p>
          <p className="text-xs mt-2">{Math.round(axis.coverage * 100)}% input coverage · {axis.families}/{axis.totalFamilies} families{axis.disagreement ? ' · Conflicting evidence' : ''}</p>
        </div>;
      })}
    </div>
    <details>
      <summary className="cursor-pointer text-sm font-medium text-accent-blue">Inspect inputs, dates, and three-month changes</summary>
      <div className="overflow-x-auto mt-3">
        <table className="w-full text-xs text-left">
          <caption className="text-left text-black/50 mb-2">Growth-rate inputs use 3-month annualized growth or YoY as specified. Level inputs use monthly averages. Change compares the transformed reading with three months earlier; it is not a release surprise.</caption>
          <thead><tr>{['Indicator / role', 'Axis', 'Observation', 'Reading', '3M change', 'Status'].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead>
          <tbody>{assessment.evidence.map(e => <tr key={e.key} className="border-t border-black/5">
            <td className="p-2"><a href={e.source} target="_blank" rel="noreferrer" className="text-accent-blue">{e.name}</a><p className="text-black/45">{e.role} · {e.transform === 'annualized' ? '3M annualized %' : e.transform === 'yoy' ? 'YoY %' : e.units}</p></td>
            <td className="p-2">{e.axis === 'context' ? 'Context only' : e.axis}</td><td className="p-2 whitespace-nowrap">{e.date ?? '—'}</td>
            <td className="p-2 tabular-nums">{fmt(e.value)}</td><td className="p-2 tabular-nums">{fmt(e.change)}</td><td className="p-2">{e.status}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>
    <details className="mt-3 text-xs text-black/55"><summary className="cursor-pointer">Methodology and limits</summary>
      <p className="mt-2">Inputs are centered on explicit reference levels and scaled to −1…+1. Each family is averaged, then families receive equal weight. Growth requires 60% input coverage and three families; inflation requires 60% and two families. Growth within ±0.10 produces a mixed call. Inflation pressure above 0.25 distinguishes elevated-inflation regimes. Momentum compares with three months earlier. These thresholds are heuristic.</p>
      <ul className="list-disc pl-5 mt-2 space-y-1">{assessment.caveats.map(c => <li key={c}>{c}</li>)}</ul>
      <p className="mt-2">Context series broaden household, business, fiscal, and global coverage but do not vote in the headline US regime. Nominal services spending is not real services output; government spending growth is not a fiscal-impulse estimate.</p>
    </details>
  </Card>;
}
