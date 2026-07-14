# Generation Quality Tuning — Plan Brief

> Full plan: `context/changes/generation-quality-tuning/plan.md`
> Research: `context/changes/generation-quality-tuning/research.md`

## What & Why

The generator's boards pass every rule it knows yet trail the expert's board on every quality
dimension she actually cares about — because "good" lives in her head, not in the objective. The
elicitation is now complete (research.md R1–R21 + G1–G4): every missing rule has an
expert-sourced value. This change encodes them: three hard rules, five new objective tiers in a
confirmed order, Golden Slot detection and placement, and the projection fix behind 4 of the 5
"unplaced" hours.

## Starting Point

The engine is GRASP+LNS over a 4-tier lexicographic objective
(`[unplacedTotal, holes, totalSlots, studentHoles]`). It cannot see soft teacher availability at
all, has no teacher/adjacency/day-shape/coverage terms, and its catalog under-demands Chemistry by
4 h (a projection gap, not a search failure). Measured against the gold board on identical
inputs: 67 vs 0 same-day splits, 345 vs 74 teacher gap-slots, 16 teacher day-lanes over the 8-period
span the expert never exceeds, golden slots parked at the day tail instead of mid-day.

## Desired End State

Generate on a catalog clone with fixtures pre-pinned and get a board with zero splits, legal
teacher days (span ≤ 8, no 7-in-a-row), zero soft-availability hits, teacher gaps within ~2× the
expert's, days starting at P1, Friday ending earliest, golden slots centred in P4–P7 — and at
most a small hand-finishable unplaced residue. The gold board itself still verifies clean
(regression guard). Anything cheaper than her ~40 h of manual work wins.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Scope | Full rule set minus R15 (teacher-preference data model) | Every parameter is expert-sourced now; R15 needs schema work | Plan |
| Chemistry fix | Projection keeps overlap bases with enrolled dependents | Generalizes to any combined-teaching year; zero data edits | Plan |
| Teacher-day cap | Span ≤ 8 **and** max 6 consecutive | Gold-verified: spans max at exactly 8, longest run 6; engine violates both | User + SQL check |
| Same-day split | Hard, lunch counts as any break, per week-lane | 0 in 248 expert placements; "never" ×3 in elicitation | Research |
| Hard-rule UI surface | Warn in UI, generator-hard (stacking precedent) | Manual editing keeps transient freedom; generator can never emit violations | Plan |
| Tier order 4–6 | teacherHoles > softHits > studentHoles, all below totalSlots | Forced choices 5.2/5.3/5.4 + G4 | Research |
| Bottom tiers 7–9 | doublesDeficit > lateStarts > fridayTail | Ordered by measured gap size; conflicts among them are rare | Plan |
| Golden Slots | Construction anchor + last-place tier (free bonus) | G2: "actively find", price unanswered — must cost nothing above it | Research |
| Fixtures | Pre-pin workflow documented, no engine reorder | Pins already work; expert accepted the workflow (4.5/10.2) | Research |
| Verification | Phase-wise local analyzer A/B vs run-1 | Per-term attribution; golden data is local-only PII, so no CI gate | Plan |
| CP-SAT readiness | Preserve the engine port; quality/rules stay engine-agnostic | Tiers in `objective.ts`, rules single-sourced in the verify oracle, golden detection outside `engines/greedy/` | User |
| Measurement automation | One-command harness: clone + skeleton-pin + generate + persist + analyze | Removes clicking and pinning errors; skeleton copied from the golden board by course identity, never hardcoded | User |
| Snapshot assembly | Relocate `assemble-snapshot` from `_pages/plan-detail` to `entities/timetable` (Phase 1) | Harness runs the app's exact assembly by construction, not a copy; fits the portability invariant | Plan review (F3/Fix B) |

## Scope

**In scope:** one-command experiment harness (clone + skeleton-pin + generate + analyze) ·
Chemistry projection fix · no-split + teacher span/streak hard rules (registry + verify +
fitsAt) · objective tiers 4–10 · golden-slot census, detection, band anchor · pre-pin runbook ·
acceptance run vs run-1 baselines.

**Out of scope:** R15 teacher-preference data model · flagged-first construction reorder (R12) ·
golden-slot count maximization · blocking-severity UI enforcement · building the CP-SAT engine
(its port is actively preserved — see Architecture) · multi-year gold import · refuted/emergent
hypothesis families (heaviness, weave, anti-batching, spread).

## Architecture / Approach

All rules land in the existing three-layer encoding surface: hard rules as warn-level collision
constraints escalated delta-aware in `verifyGeneration` and guarded in `board.fitsAt` (the
`course-day-stacking` template); preferences as new tiers in the engine-agnostic lexicographic
tuple in `objective.ts` (comparator already length-generic); golden slots as an engine-agnostic
cover-set derivation (`golden-sets.ts`) + a pre-backbone construction stage + a bottom tier. One
projection fix in `loadCohortCourses` feeds app, engine, and analyzer alike. Everything stays
CP-SAT-ready: quality is defined only in engine-agnostic modules, the verify oracle is the single
rule definition (`fitsAt` merely mirrors it), and the `GeneratePlan` port is untouched — a second
engine inherits every rule and tier for free.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Experiment harness | One command: clone + pin skeleton + generate + analyze | Skeleton identity-mapping edge cases |
| 2. Chemistry fix | Catalog demands the 6 taught hours; unplaced 5 → ≤ 1 | Projection regressions (merge/overlap topologies) |
| 3. Hard rules | 0 splits, legal teacher days, gold still verifies | Feasibility shrinks → unplaced residue grows |
| 4. People tiers | Teacher gaps → ≤ 2× expert, soft hits → 0 | scoreCandidate hot-loop slowdown |
| 5. Shape tiers | Doubles, P1 starts, short Friday | Tier interactions starving lower tiers |
| 6. Golden slots | Full-coverage cells centred P4–P7 | Detection precision (disjoint + distinct teachers) |
| 7. Acceptance | Runbook + R18 verdict in analysis-run-2.md | Expert availability for the eyeball check |

**Prerequisites:** local Supabase with the imported golden plan (local-only PII); run-1 baselines.
**Estimated effort:** ~6 sessions; phases 2–6 gate on a one-command harness run, no manual
clicking or hand-pinning anywhere in the loop.

## Open Risks & Assumptions

- n=1: every rule is one board, one expert, one year — hard rules were chosen only where the
  expert said "never" *and* the gold board complies; everything else is a reversible tier.
- New hard rules may leave more hours unplaced on hard instances; the expert explicitly prefers
  an unplaced hour over any violation (R17), and the dp1=48 search wall may persist.
- The `softHits`-vs-`studentHoles` order is inferred from revealed practice, not a forced choice —
  revisit only if measurement shows student gaps ballooning.
- Gold completeness reporting shifts attribution after Phase 2 (Chemistry base −4 / HL +4) —
  expected artifact, documented in the plan.

## Success Criteria (Summary)

- Generated boards carry zero hard-rule violations while the gold board still verifies clean.
- The analyzer's R18 checklist is green: fixtures respected, Friday shortest, blocks unsplit,
  teacher gaps ≤ 2× expert, golden slots mid-day, residue hand-finishable.
- The expert would rather hand-repair the generated board than spend ~40 h building one.
