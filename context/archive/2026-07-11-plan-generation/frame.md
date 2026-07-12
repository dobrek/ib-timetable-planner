# Frame Brief: Automatic plan generation

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.
> Companion research: `context/changes/plan-generation/research.md` (2026-07-11).

## Reported Observation

Assembling the final timetable is fully manual. The app automates grouping
recommendations and live validation, but every one of ~254 course-hour
placements (116 dp1 + 138 dp2) is dragged by hand, and plan quality depends on
tacit rules that exist only in the plan author's head (course spread across
days; early-finishing DP2 courses at the edges of students' days). The best
manual result occupies 48 of 50 grid slots, with the free slots at the edges of
days.

## Initial Framing (preserved)

- **User's stated cause or approach**: The current implementation (domain
  model, grouping algorithm, automated validations) is a sufficient base for an
  automated process — treat it as reference, not blocker; external solver
  techniques/technology are in scope.
- **User's proposed direction**: Introduce automatic plan generation — the app
  produces a (near-)optimal plan, the author only reviews and makes minor
  changes.
- **Pre-dispatch narrowing** (author's answers, 2026-07-11): the leading pain
  is **time and tedium**; the 48-slot result "was achieved by manual plan
  creation — we don't want an automated process that is worse" (floor, while
  earlier: "any plan that could reduce this number will be better" — soft
  target); free slots land at **day edges** in manual plans; the two captured
  rules (2/day spread cap, early-finishing courses at day edges) are **the full
  tacit rule set**.

## Dimension Map

The framing could break at any of these dimensions:

1. **Value framing — what "success" means** — the research follow-up elevated
   slot-count minimization to "the prize"; if the real prize is *time*, a plan
   optimized for solver optimality over shippable speed solves the wrong
   problem. ← reframe candidate
2. **Response shape — assist vs full generation** — if manual time went to
   mechanical dragging of obvious placements, an incremental assistant
   (auto-place-next) could deliver most value at a fraction of the risk. ← was
   open; resolved by narrowing
3. **Domain-model completeness** — if more tacit rules existed beyond the two
   captured, generated plans would disappoint regardless of engine.
4. **Scope boundary — one problem or two** — rule capture (schema + core) vs
   the generator that consumes it; treating them as one blob may fight repo
   convention.
5. **PRD boundary — is reversing the auto-placement non-goal warranted** — the
   non-goal has been carried forward in every PRD/roadmap revision.

## Hypothesis Investigation

Evidence base: today's five-agent research pass (investigation tasks #1–#5,
file-anchored in `research.md`) plus three structured Q&A rounds with the
author. No fresh agents were spawned for this frame — re-investigating
already-anchored dimensions would be padding.

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| 1. Success = time-to-parity, not optimality | Q1: pain = "time and tedium" (not quality ceiling, not bus factor); Q2: "we don't want an automated process that is worse" (48 = floor); earlier answer keeps reduction as *soft* value | STRONG |
| 2. Assist would suffice (full generation unnecessary) | Refuted: time sink = "search and backtracking" (decisive Q); undo/redo exists precisely because backtracking is the observed workflow (`prd.md:349-354`); assist primitives (`findDuplicateTarget`) speed moves but don't remove backtracking | NONE |
| 3. Hidden rules remain unmodeled | Refuted: author confirms the two captured rules are the full set; the only rules ever mentioned-but-excluded (teacher soft preferences, hours-per-week caps) are deliberate PRD non-goals (`prd.md:474`) | NONE |
| 4. Two-part problem boundary (rule capture ≠ generator) | Repo convention: domain-rule changes ship schema + constraint core as their own vertical changes (`2026-06-20-co-teaching-teacher-sets`, `2026-06-21-bi-weekly-week-aware-validation`), consumed later by features; the two new rules (course flag + spread cap) have standalone value (any author/tool can honor them once modeled) | STRONG |
| 5. PRD non-goal reversal unwarranted | Refuted: the non-goal's stated premise was NP-hardness (`context/foundation/archive/2026-06-18-shape-notes.md:213`); research falsified it at this instance scale (full-board validation ~0.3 ms; CP-SAT seconds at ~40 courses/50 slots); pain is real and reversal is the product owner's explicit request | NONE |

## Narrowing Signals

- Leading pain: **time and tedium** — not the quality ceiling, not bus factor.
- **48 slots is a guardrail, not the goal**: "don't want worse" (hard floor);
  "any reduction is better" (soft objective). Parity is measured against the
  actual manual plan on the same catalog.
- Free slots sit at **day edges** in manual plans — the compactness style is
  "students' days are contiguous blocks that start late or end early", the same
  theme as the early-finishing rule.
- The tacit rule set is **complete** (author-confirmed).
- Manual time goes to **search and backtracking** — the one activity full
  generation eliminates and assist-mode does not.

## Cross-System Convention

Industry: interactive planning tools ship **generate-then-review with
pinning**, warm-started from the current board (Timefold continuous planning,
CP-SAT solution hinting, UniTime's feasible-partial-solution search) — matching
the proposed direction. In-repo: expensive compute lives off the hot path as a
cached, explicitly-triggered action (grouping compute precedent); domain rules
enter as vertical schema+core changes before features consume them. The leading
hypothesis matches both conventions.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: hours of human combinatorial
> search-and-backtracking to assemble a two-cohort plan — to be eliminated by a
> generator that produces a complete, all-rules-respecting plan at
> **manual-parity quality or better** (≤ 48 occupied slots, free slots at day
> edges, both captured tacit rules honored) in **minutes instead of hours**.

The author's direction (full generation, review-and-tweak) is **confirmed** —
the time sink is search, which only generation removes. One material
correction to the research follow-up's emphasis: **time-to-parity is the
success bar; slot-count improvement beyond 48 is a welcome soft objective, not
the definition of success.** A plan that over-invests in solver optimality at
the cost of shipping a fast, parity-quality generator would solve the wrong
problem. Secondarily, the problem has a two-part boundary: (a) capture the two
tacit rules in the domain model (standalone value, convention-backed), (b) the
generator that consumes them.

## Confidence

**HIGH** — strong evidence on every dimension (five file-anchored research
agents + three decisive Q&A rounds), matches industry and repo convention, and
the reframe survived the inverse check (floor-language, not target-language,
around 48).

## What Changes for /10x-plan

The plan should be built around **time-to-parity**: success criteria are a
complete plan honoring all hard rules at ≤ 48 occupied slots with edge-
positioned free slots, generated within the agreed 10–30 s budget — with
optimality/slot-improvement as a bounded, secondary objective. Rule capture
(`finishes_early` flag + 2/day spread cap) should be treated as the separable
foundation the generator consumes, per repo convention. The PRD amendment is in
scope of this change: reverse the auto-placement non-goal (`prd.md:463`,
`roadmap.md:212`) and register the two rules as PRD-level business rules.

## References

- Research (all decisions + evidence): `context/changes/plan-generation/research.md`
- PRD non-goal + undo rationale + excluded prefs: `context/foundation/prd.md:463,349-354,474`
- Roadmap parked item: `context/foundation/roadmap.md:212`
- NP-hard premise (archived): `context/foundation/archive/2026-06-18-shape-notes.md:213`
- Convention precedents: `context/archive/2026-06-20-co-teaching-teacher-sets/`,
  `context/archive/2026-06-21-bi-weekly-week-aware-validation/`,
  `context/archive/2026-06-04-port-grouping-algorithm/` (off-hot-path compute)
- Investigation tasks: #1–#5 (research phase, 2026-07-11)
