# Regime & outlook validation, 2005–2024

First historical check of the dashboard's economic calls, run 2026-09-09/10 with
`npm run validate:regimes -- --start=2005-01 --end=2024-12`, then rescored with the
current code via `scripts/rescore-validation.cjs --refetch-unavailable`. Summary
printed by `scripts/summarize-validation.cjs`. Slim report (every monthly call, no
raw series): `docs/regime-validation-2005-2024.json`.

**Method.** 240 month-end snapshots. For every input the validator asks FRED for the
data *as it was published on that date* (ALFRED vintages), so revisions made later
can't leak in. Where FRED has no archive that early (yields, spreads, NFCI, OECD CLI
before 2011–2023), the latest vintage truncated to the decision date is used and
flagged per snapshot (`fallbackVintage`). Yields, spreads and surveys are never
revised, so that is exact; claims, hours, NFCI and the OECD CLI are revised, so their
fallback carries some look-ahead in the early years. Outcome label: NBER recession
months (USREC), which is never an input.

## Headline numbers

Warning = the signal says "trouble". Outcome = a recession month occurs within the
horizon. Scored over the 223–240 months where both were defined.

| Signal | Rule | Horizon | Precision | Recall | False-alarm rate | Lead before 2008-01 | Lead before 2020-03 |
|---|---|---|---|---|---|---|---|
| Regime label | weak-growth season | 6 mo | 61% | 56% | 5% | 6 mo (flickered) | missed |
| Outlook heading | slowing / deepening | 6 mo | 33% | 88% | 24% | 3 mo | 6 mo (one month) |
| Recession checklist | ≥ 2 signs on | 6 mo | 33% | 93% | 27% | 11 mo | 9 mo |
| Recession checklist | ≥ 2 signs on | 12 mo | 45% | 90% | 24% | 11 mo | 9 mo |
| Yield-curve model | probit ≥ 30% | 12 mo | 25% | 24% | 15% | 11 mo | 8 mo |

## What it means

- **The regime label is a nowcast and behaves like one.** It called a weak-growth
  season in 15 of the 18 months of the 2008–09 recession and was never fooled in
  2022–23 (false-alarm rate 5%). Its "lead" of six months in 2007 was a single
  stagflation month that flipped back; it did not stay on until January 2008, and it
  read "Mixed" in Nov–Dec 2007 while the outlook already said "deepening". It missed
  March 2020 entirely, as any monthly nowcast would. It changed 52 times in 240
  months, so it flickers around the ±0.1 neutral zone.
- **The outlook layer buys lead time and pays for it in false alarms.** The
  checklist caught both recessions 9–11 months early and the heading 3–6 months
  early, with recall around 90%. The cost is 2022–24: from Sept 2022 to Oct 2024 the
  heading read slowing/deepening in 20 of 26 months, the checklist was elevated or
  high in 21, and the curve model sat above 30% in 24. No recession came. That is the
  same false alarm every curve- and LEI-based forecaster made in real time, and this
  report reproduces it rather than hiding it.
- **The yield-curve probit tracks the published model** (peak ≈ 42% in early 2007,
  ≈ 38% in Aug 2019, 71% in May 2023). As a yes/no signal at 30% it is weak on its
  own; its value is as the slow-moving background number, not a trigger.
- **The three outlook pieces disagree usefully.** Late 2007: regime "Mixed", heading
  "deepening", curve probability already falling. 2019: checklist elevated, heading
  flickering, curve ~35%. Showing them side by side is the right design; collapsing
  them into one number would have hidden that.

## What was NOT done

- No thresholds were tuned to these results. Tuning on the same 20 years would be
  fitting to two recessions and one false alarm.
- No return or portfolio backtest. This scores economic calls against NBER dates only.
- Six-month windows overlap, so the counts are not independent observations.

## Candidate follow-ups (David's call)

1. Hysteresis on the regime label (e.g. require two consecutive months to change
   season) to cut the 52 flips; would have held "stagflation" through late 2007.
2. Show the checklist's *trend* (signs turning on this quarter) rather than only the
   count; 2006–07 went 0 → elevated 17 months out and stayed there.
3. Re-run yearly with `--start=2005-01` and a fresh output path to keep the audit
   trail; each run is ~6,300 FRED requests, about 100 minutes, free.
