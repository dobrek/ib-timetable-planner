# Generation Engine Hardening & Search Upgrades — Plan Brief

> Full plan: `context/changes/generation-engine-hardening/plan.md`

## What & Why

A critical review (2026-07-12) of the shipped plan-generation engine found a confirmed, reproduced correctness bug: placing ordinary courses can box in a `finishes_early` row (pins included), producing a board the trust-but-verify judge rejects wholesale — the user sees "generation failed" on a solvable input. Around it, the review found an objective whose priority tiers can invert, a search loop that can return a worse board than it built, and a cancel/progress blind spot covering the first ~40% of every solve. This change fixes all of it and upgrades the search so the 20 s budget buys real quality.

## Starting Point

`plan-generation` (implemented 2026-07-11) shipped a pure-TS GRASP engine in a Web Worker: clique-backbone construction, ejection-chain repair, slot-count descent, randomized restarts, with `verifyGeneration` re-judging every result before apply. It meets its benchmark bars (dp1 ≤ 50 / dp2 ≤ 48 slots, complete boards) — but only on empty-board inputs; the bug class lives on partially-pinned boards the benchmark never exercises.

## Desired End State

The engine never emits a board verify rejects — the flagged-edge invariant holds by construction and a seeded fuzz suite (verify as oracle) keeps it that way. Invalid input boards fail in milliseconds with an actionable message. Cancel and progress respond within ~100 ms at any point. After a few diversifying restarts, the budget runs LNS destroy-and-repair with exact lexicographic acceptance, stops early on stagnation, and reports a provable per-cohort lower bound in diagnostics.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Boxing-bug fix mechanism | Hard placement-time guard (all stages, pins included) | Invariant holds by construction; matches the prior decision that `finishes_early` is a HARD rule | Plan |
| Pre-invalid boards | Fail-fast precondition (`verifyGeneration(snapshot, [])` in the worker) | A guaranteed 20 s dead-end becomes an instant, actionable error over the existing protocol | Plan |
| Scoring | Lexicographic tuple + shared comparator | The weighted scalar demonstrably lets student compactness outvote a slot | Review |
| Scope & sequencing | One change, correctness-first phases, each shippable | Scoring feeds LNS feeds early-exit — one review context, safe stopping points | Plan |
| Post-solution budget | Hybrid: 2–3 seeded restarts, then LNS destroy-and-repair | Restarts escape bad backbones; LNS converts budget into monotone improvement and finally optimizes studentHoles | Plan |
| Early exit | Stagnation-based stop (complete + zero holes + no improvement window) | Fast on easy instances, keeps polishing when progress is real, works when the bound is unreachable | Plan |
| Testing depth | Property-based fuzz harness with verify as oracle | Catches the whole bug class (this bug would have been found instantly); benchmark bars stay as-is for now | Plan |

## Scope

**In scope:** placement-time flagged-edge guard; worker fail-fast precondition; tuple scoring; intra-attempt best tracking; time-sliced async yields (cancel/progress); hybrid restarts→LNS loop; stagnation stop; exact max-weight clique bound + optional diagnostics fields; search minors (cohort-order randomization, stage-6 filter, stage-7 all holes, splice guards, comment fixes); regression + fuzz tests.

**Out of scope:** UI rendering of new diagnostics; protocol message-kind changes; benchmark bar tightening or new bench scenarios; relaxing `verifyGeneration`; moving pins; CP-SAT revisit.

## Architecture / Approach

All work stays inside the pure engine module (`entities/timetable/model/generation/`) plus a 3-line worker precondition — the `GeneratePlan` port, apply path, and verify contract are untouched. Every placement site funnels through one feasibility predicate (now flagged-aware); the search loop becomes: deterministic attempt 1 → 2 noisy restarts → LNS rounds on the incumbent (copy placements, rebuild indexes, destroy ~15%/one day, re-pack with existing stages, accept on tuple improvement) until stagnation, budget, or cancel.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Flagged-edge guard + fail-fast | The user-visible bug fixed; instant error on invalid boards | Guard delta semantics (dirty boards must not livelock placement) |
| 2. Objective integrity | Exact tier ordering; attempts never regress vs construction | Behavioral shifts vs current benchmark envelope |
| 3. Cancel/progress responsiveness | ~100 ms cancel latency, live progress from second one | Yield overhead eating descent budget (time-sliced to bound it) |
| 4. Hybrid restarts → LNS + bound + early stop | Budget converts to quality; sub-20 s solves on stagnation | LNS repair reusing stage machinery cleanly; tuning stagnation window |
| 5. Property fuzz harness | Verify-as-oracle regression net for future engine work | Keeping the suite fast (~2 s) and deterministic |

**Prerequisites:** none — builds directly on the implemented `plan-generation` change; local Supabase only needed for the manual benchmark runs.
**Estimated effort:** ~3–5 sessions across 5 phases; Phase 1 alone is a meaningful, shippable fix.

## Open Risks & Assumptions

- Assumes the real catalog remains ~40 courses/cohort on a 5×10 grid; the exact-clique B&B is capped with a greedy fallback in case a future catalog blows it up.
- Phase 2's scoring change may shift which board wins on the real catalog; the benchmark bars (dp1 ≤ 50 / dp2 ≤ 48) are asserted manually after Phases 2 and 4 to catch regressions before merge.
- The stagnation window (~2.5 s) is a tunable default; if the benchmark shows premature stops, widening it is a one-constant change.

## Success Criteria (Summary)

- Generate succeeds on partially-pinned boards with mid-day flagged pins, and invalid boards fail instantly with a clear message — no more sporadic wholesale rejections.
- "Stop & keep" and the progress bar respond within ~100 ms throughout the solve.
- Benchmark bars hold with zero blocking violations; easy solves finish well under 20 s; the fuzz suite guards the verify invariant in every CI run.
