'use client';

// The evidence behind the regime verdict. Rendered INSIDE the regime card's
// explainer on the Briefing and Macro pages — never as a second verdict card.
// Words first, numbers second: a reader with no economics background should be
// able to read the three tiles without decoding a −1…+1 scale.

import type { EconomicAssessment as Assessment, CoreAxis } from '@/lib/economy';
import { describeLevel, describeMomentum } from '@/lib/economy';
import { Term } from './ui/Term';

const num = (v: number | null) => (v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`);

const AXIS_META: Record<CoreAxis, { title: string; question: string; inputs: string }> = {
  growth: {
    title: 'Growth',
    question: 'Is the economy expanding or shrinking?',
    inputs: 'consumer spending, real income, payrolls, jobless claims, hours worked, factory output, building permits, GDP',
  },
  inflation: {
    title: 'Inflation',
    question: "Are prices rising faster than the Fed's ~2% goal?",
    inputs: 'CPI, core CPI, PCE, core PCE, and the inflation rate bond markets are pricing in',
  },
  financial: {
    title: 'Borrowing conditions',
    question: 'Is money easy or hard to borrow right now?',
    inputs: 'high-yield and investment-grade credit spreads, bank lending standards, the 10-year real yield, the dollar',
  },
};

export function EconomicEvidence({ assessment }: { assessment?: Assessment }) {
  if (!assessment) return <p>Waiting for the economic data to load…</p>;
  const stale = assessment.evidence.filter((e) => e.status !== 'available');

  return (
    <div className="space-y-3">
      <p>
        The label above is not a forecast — it is a reading of where the economy <em>is</em>, built from three separate questions.
        Each question is answered from its own group of official series (so one noisy number can&apos;t swing the call), and each
        gets both a <strong>level</strong> (where we are) and a <Term k="momentum">3-month trend</Term> (which way it&apos;s heading).
      </p>

      <div className="grid sm:grid-cols-3 gap-3">
        {(['growth', 'inflation', 'financial'] as const).map((key) => {
          const axis = assessment.axes[key];
          const meta = AXIS_META[key];
          return (
            <div key={key} className="rounded-xl bg-white/70 border border-black/[0.05] p-3">
              <p className="text-[10px] uppercase tracking-wider text-black/40">{meta.title}</p>
              <p className="text-sm font-semibold text-black/80 capitalize mt-0.5">{describeLevel(key, axis.score)}</p>
              <p className="text-xs text-black/55">Trend: {describeMomentum(key, axis.momentum)}</p>
              <p className="text-[11px] text-black/40 mt-2 tabular-nums">
                score {num(axis.score)} · trend {num(axis.momentum)} · {Math.round(axis.coverage * 100)}% of inputs available
                {axis.disagreement ? ' · inputs disagree' : ''}
              </p>
              <p className="text-[11px] text-black/45 mt-1 leading-snug">{meta.question}</p>
            </div>
          );
        })}
      </div>

      <p>
        <strong>How the label is decided.</strong> Growth clearly positive with inflation contained → <em>Growing, inflation contained</em>.
        Growth positive with inflation running warm → <em>Growing, inflation running warm</em>. Growth clearly negative → one of the two
        <em> weak growth</em> seasons, split the same way by inflation. If growth is close to flat, or fewer than 60% of the inputs are
        available, it says <em>Mixed</em> instead of guessing. <Term k="financial-conditions">Borrowing conditions</Term> don&apos;t
        pick the label; they are the &quot;how much cushion is there&quot; overlay.
      </p>

      <details>
        <summary className="cursor-pointer font-medium text-accent-blue">See every input, its date, and its 3-month change</summary>
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-left">
            <caption className="text-left text-black/45 mb-2">
              &quot;Reading&quot; is the transformed value (3-month annualized growth, year-over-year change, or the level, as noted). &quot;3M change&quot;
              compares today&apos;s reading with three months ago. Context-only rows broaden the picture but don&apos;t vote in the label.
            </caption>
            <thead>
              <tr>{['Indicator', 'Answers', 'Latest obs.', 'Reading', '3M change', 'Status'].map((h) => <th key={h} className="p-1.5 font-medium text-black/50">{h}</th>)}</tr>
            </thead>
            <tbody>
              {assessment.evidence.map((e) => (
                <tr key={e.key} className="border-t border-black/5">
                  <td className="p-1.5">
                    <a href={e.source} target="_blank" rel="noreferrer" className="text-accent-blue">{e.name}</a>
                    <p className="text-black/40">{e.role} · {e.transform === 'annualized' ? '3M annualized %' : e.transform === 'yoy' ? 'YoY %' : e.units}</p>
                  </td>
                  <td className="p-1.5 capitalize">{e.axis === 'context' ? 'Context only' : e.axis === 'financial' ? 'Borrowing' : e.axis}</td>
                  <td className="p-1.5 whitespace-nowrap">{e.date ?? '—'}</td>
                  <td className="p-1.5 tabular-nums">{e.value === null ? '—' : e.value.toFixed(2)}</td>
                  <td className="p-1.5 tabular-nums">{num(e.change)}</td>
                  <td className="p-1.5">{e.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <details>
        <summary className="cursor-pointer font-medium text-accent-blue">What this can and can&apos;t tell you</summary>
        <p className="mt-2">
          It describes the present, not the future, and its thresholds are sensible rules of thumb rather than a model that has been
          tested against history. Markets often move before the data do. Where each group reads, in detail:
        </p>
        <ul className="list-disc pl-5 mt-1 space-y-1">
          {(['growth', 'inflation', 'financial'] as const).map((k) => <li key={k}><strong>{AXIS_META[k].title}:</strong> {AXIS_META[k].inputs}.</li>)}
        </ul>
        <ul className="list-disc pl-5 mt-2 space-y-1">
          {assessment.caveats.map((c) => <li key={c}>{c}</li>)}
        </ul>
        {stale.length > 0 && (
          <p className="mt-2">Currently excluded (stale, missing, or too short to compute): {stale.map((e) => e.name).join(', ')}.</p>
        )}
      </details>
    </div>
  );
}
