'use client';

// The evidence behind the regime verdict. Rendered INSIDE the regime card's
// explainer on the Briefing and Macro pages — never as a second verdict card.
// Words first, numbers second: a reader with no economics background should be
// able to read the three tiles without decoding a −1…+1 scale.

import type { EconomicAssessment as Assessment, CoreAxis, Outlook } from '@/lib/economy';
import { describeLevel, describeMomentum, describeOutlook, describeOutlookMomentum, isLeading } from '@/lib/economy';
import { Explainer, Term } from './ui/Term';

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
        The label above is a reading of where the economy <em>is</em> (the &quot;Where it&apos;s heading&quot; line below it is the forecast), built from three separate questions.
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
              Rows marked &quot;+ outlook&quot; or &quot;Outlook only&quot; are the leading indicators behind the forecast line.
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
                  <td className="p-1.5 capitalize">{e.axis === 'context' ? 'Context only' : e.axis === 'outlook' ? 'Outlook only' : e.axis === 'financial' ? 'Borrowing' : e.axis}{e.axis !== 'outlook' && isLeading(e) ? ' + outlook' : ''}</td>
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

// ─── Where it's heading ───
// The forward-looking half of the card: a one-line verdict, then the evidence
// behind it inside an explainer (leading-indicator tile, recession checklist,
// yield-curve model). Same words-first rule as the regime evidence above.

const HEADING_TONE: Record<Outlook['heading'], string> = {
  continuing: 'text-accent-green', recovering: 'text-accent-green', slowing: 'text-accent-orange', deepening: 'text-accent-red', unclear: 'text-black/60',
};
const WARNING_TONE: Record<Outlook['warningLevel'], string> = { low: 'text-accent-green', elevated: 'text-accent-orange', high: 'text-accent-red', unknown: 'text-black/45' };

export function EconomicOutlook({ assessment, compact = false }: { assessment?: Assessment; compact?: boolean }) {
  const outlook = assessment?.outlook;
  if (!outlook) return <p className="text-sm text-black/45 mt-3">Where it&apos;s heading: waiting for the leading-indicator data…</p>;
  const leading = assessment!.evidence.filter(isLeading);
  const pct = outlook.curveModel.probability === null ? '—' : `${Math.round(outlook.curveModel.probability * 100)}%`;
  return (
    <div className="mt-3 pt-3 border-t border-black/[0.06]">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-[10px] uppercase tracking-wider text-black/40">Where it&apos;s heading</p>
        <p className={`text-sm font-semibold ${HEADING_TONE[outlook.heading]}`}>{outlook.label}</p>
      </div>
      <p className="text-sm text-black/55 leading-relaxed mt-1">{outlook.description}</p>
      {!compact && (
        <Explainer title="How is the outlook determined — and what's the evidence?">
          <p>
            Where the regime label reads today&apos;s data, the outlook reads only the <Term k="lei">leading indicators</Term> — the handful of
            series that have historically turned <em>before</em> the economy did. Three things are combined, and each is shown separately so you can see which one is talking:
            a leading-indicator score, a count of classic recession warning signs, and a published yield-curve model.
          </p>

          <div className="grid sm:grid-cols-3 gap-3">
            <div className="rounded-xl bg-white/70 border border-black/[0.05] p-3">
              <p className="text-[10px] uppercase tracking-wider text-black/40">Leading indicators</p>
              <p className="text-sm font-semibold text-black/80 capitalize mt-0.5">{describeOutlook(outlook.axis.score)}</p>
              <p className="text-xs text-black/55">Trend: {describeOutlookMomentum(outlook.axis.momentum)}</p>
              <p className="text-[11px] text-black/40 mt-2 tabular-nums">
                score {num(outlook.axis.score)} · trend {num(outlook.axis.momentum)} · {outlook.axis.families} of {outlook.axis.totalFamilies} groups reporting
                {outlook.axis.disagreement ? ' · inputs disagree' : ''}
              </p>
              <p className="text-[11px] text-black/45 mt-1 leading-snug">Are the early-warning series improving or deteriorating?</p>
            </div>
            <div className="rounded-xl bg-white/70 border border-black/[0.05] p-3">
              <p className="text-[10px] uppercase tracking-wider text-black/40">Recession checklist</p>
              <p className={`text-sm font-semibold capitalize mt-0.5 ${WARNING_TONE[outlook.warningLevel]}`}>{outlook.warningLevel === 'unknown' ? 'Not readable' : `${outlook.warningLevel} risk`}</p>
              <p className="text-xs text-black/55">{outlook.triggered} of {outlook.evaluable} warning signs on</p>
              <p className="text-[11px] text-black/45 mt-2 leading-snug">0–1 = low, 2–3 = elevated, 4+ = high. A count, not a probability — each row is a well-known rule of thumb.</p>
            </div>
            <div className="rounded-xl bg-white/70 border border-black/[0.05] p-3">
              <p className="text-[10px] uppercase tracking-wider text-black/40">Yield-curve model</p>
              <p className="text-sm font-semibold text-black/80 mt-0.5 tabular-nums">{pct} chance of recession</p>
              <p className="text-xs text-black/55">starting within the next 12 months</p>
              <p className="text-[11px] text-black/40 mt-2 tabular-nums">
                10Y–3M spread {outlook.curveModel.spread === null ? '—' : `${outlook.curveModel.spread > 0 ? '+' : ''}${outlook.curveModel.spread.toFixed(2)} pp`}{outlook.curveModel.date ? ` · month of ${outlook.curveModel.date.slice(0, 7)}` : ''}
              </p>
              <p className="text-[11px] text-black/45 mt-1 leading-snug">The <Term k="curve-model">NY Fed&apos;s published formula</Term>, not fitted here.</p>
            </div>
          </div>

          <p>
            <strong>How the verdict is decided.</strong> Leading indicators clearly positive → <em>Expansion likely to continue</em> (or <em>Recovery likely</em> if growth is
            currently negative). Leading indicators clearly negative → <em>Growth likely to slow</em> (or <em>Weakness likely to persist</em> if growth is already
            negative). Close to flat, or fewer than three groups reporting → <em>Direction unclear</em>. The checklist and the curve model are shown alongside
            so a benign score can&apos;t hide an inverted curve, and vice versa.
          </p>

          <details>
            <summary className="cursor-pointer font-medium text-accent-blue">See the recession checklist row by row</summary>
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-left">
                <thead>
                  <tr>{['Warning sign', 'Rule', 'Latest reading', 'As of', 'Status'].map((h) => <th key={h} className="p-1.5 font-medium text-black/50">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {outlook.warnings.map((w) => (
                    <tr key={w.key} className="border-t border-black/5">
                      <td className="p-1.5">{w.source ? <a href={w.source} target="_blank" rel="noreferrer" className="text-accent-blue">{w.name}</a> : w.name}</td>
                      <td className="p-1.5">{w.rule}</td>
                      <td className="p-1.5 tabular-nums">{w.reading}</td>
                      <td className="p-1.5 whitespace-nowrap">{w.date ?? '—'}</td>
                      <td className={`p-1.5 font-medium ${w.triggered === null ? 'text-black/40' : w.triggered ? 'text-accent-red' : 'text-accent-green'}`}>{w.triggered === null ? 'no data' : w.triggered ? 'ON' : 'off'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          <details>
            <summary className="cursor-pointer font-medium text-accent-blue">See the leading inputs behind the score</summary>
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-left">
                <caption className="text-left text-black/45 mb-2">Each group (labor, housing, banks, curve, composite index, orders, sentiment) is averaged first, so one noisy series can&apos;t swing the score.</caption>
                <thead>
                  <tr>{['Indicator', 'Group', 'Latest obs.', 'Reading', '3M change', 'Status'].map((h) => <th key={h} className="p-1.5 font-medium text-black/50">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {leading.map((e) => (
                    <tr key={e.key} className="border-t border-black/5">
                      <td className="p-1.5">
                        <a href={e.source} target="_blank" rel="noreferrer" className="text-accent-blue">{e.name}</a>
                        <p className="text-black/40">{e.transform === 'annualized' ? '3M annualized %' : e.transform === 'yoy' ? 'YoY %' : e.units}</p>
                      </td>
                      <td className="p-1.5 capitalize">{e.family}</td>
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
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Leading indicators give <em>direction</em>, not timing. Historically they turn 6–18 months ahead, with a wide spread and occasional false alarms (2022–23 is the recent example).</li>
              <li>The checklist is a count of rules of thumb. Four signs on is a serious warning; it is not a 4-in-8 probability.</li>
              <li>The curve model is a single-variable probit published by the New York Fed (Estrella &amp; Trubin, 2006). Its record is good for recessions since 1968 but it has nothing to say about how deep or how long.</li>
              <li>None of these thresholds have been checked against history on this dashboard yet — <code>npm run validate:regimes</code> exists for exactly that and has not been run.</li>
              <li>Markets usually move before the leading data do; this is a read on the economy, not a return forecast.</li>
            </ul>
          </details>
        </Explainer>
      )}
    </div>
  );
}
