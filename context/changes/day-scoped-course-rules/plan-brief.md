# Day-Scoped Course Rules — Plan Brief

> Full plan: `context/changes/day-scoped-course-rules/plan.md`
> Frame brief: `context/changes/plan-generation/frame.md` (shared upstream artifact)
> Research: `context/changes/plan-generation/research.md` (shared upstream artifact)

## What & Why

Two rules that make a timetable *usable* exist today only in the plan author's head:
early-finishing courses must sit at the edges of students' days (so a course ending
mid-year leaves no mid-day hole), and no course should occupy more than 2 periods on
one day. This change captures both as first-class domain rules in the interactive
validator — the separable foundation the upcoming plan generator
(`plan-generation`) will consume, extracted per the repo convention that domain rules
ship as their own vertical changes (co-teaching, bi-weekly precedents).

## Starting Point

The constraint core has five cell-scoped rules behind an additive registry; nothing is
day-scoped, the early-finish attribute has no representation anywhere, and severity/
prose each have a single home. The `week_mode` field provides a complete CRUD-chain
precedent for the new course flag.

## Desired End State

An author flags a course "finishes early" in the catalog. The board then shows a
blocking (red) violation on any flagged placement not at the edge of an enrolled
student's day, and a warn (amber) on a third same-day period of any course — in the
editing board, drag previews, auto-duplicate targeting, and the read-only teacher
perspective. The PRD registers both rules as FR-014/FR-015.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Change boundary | Rules extracted from `plan-generation` into this standalone change | Repo convention: domain rules ship as vertical schema+core changes consumed later by features | Frame + Plan |
| Edge-rule severity | **Hard/blocking, validated like a collision** | Author decision (2026-07-11) — supersedes the research's soft-objective formalization | Plan |
| Spread cap severity | Warn at ≥3 same-day periods; doubles stay legal | Author decision: flat hard cap of 2/day for the generator, warn-level in manual editing | Research + Plan |
| Edge-rule semantics | Per placement vs. *other* courses' periods, week-aware, edge of the student's day | Handles legal edge doubles without self-violation; matches the research's CP-SAT encoding | Research |
| Flag delivery | Side-set in `BoardContext` (`finishesEarlyByCourseId`), **not** a `GroupingCourse` field | Keeps the catalog hash stable — no spurious grouping staleness, no recompute on toggle | Research |
| Mechanism | Two new per-cell constraints over a day-occupancy index built inside `deriveCellViolations` | Preserves the one-file-per-rule registry; both call sites inherit for free | Plan |
| Drag hints | Explicit `classifyCell` wiring (the `crossCohortFit` pattern) | Constraints without `test` are invisible to the hint fast path — and must stay out of grouping enumeration | Plan |
| Board-chip badge | Not in this change | Author assigned the badge to the generator's review UX; the dialog carries the explanation here | Plan |

## Scope

**In scope:** `courses.finishes_early` migration + full CRUD chain + table badge; the
two day-scoped constraints with severities, dialog prose, fixtures, and unit tests;
delivery to both `deriveCellViolations` call sites; drag-hint classification; perf/
parity coverage; PRD FR-014/FR-015 registration; CRUD integration tests.

**Out of scope:** everything generator-related (port, engines, Web Worker, bulk RPC,
review UX); PRD auto-placement non-goal reversal; board-chip badge; `GroupingCourse`/
catalog-hash changes; e2e additions; seed changes.

## Architecture / Approach

Additive registry extension: a new pure day-occupancy index (per-student-per-day and
per-course-per-day views, week-carrying) is built once per derivation; two board-only
`CellConstraint` files evaluate the current cell against it; the flag set flows from
the shared course loader through board state into the collision and drag-hint memos —
the same seams `availability` and `crossCohortOccupancy` already use.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Flag capture — schema + CRUD | Flag exists, settable, visible in catalog | Low — pure `week_mode` precedent |
| 2. Day-scoped rules in the core | Both rules registered, tested, correct severities | Semantics edge cases (doubles, weeks) — covered by test matrix |
| 3. Board delivery + hints + PRD | Rules visible everywhere; FR-014/FR-015 registered | Drag-hint origin-exclusion on move; perf inside the 200 ms budget |

**Prerequisites:** local Supabase stack running; none external.
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- Existing manual plans may light up red once the blocking rule lands — expected
  (advisory, accept-and-flag), but worth confirming flags are accurate on the real plan.
- Assumes the two captured rules are the complete tacit set (author-confirmed in frame,
  Hypothesis 3).

## Success Criteria (Summary)

- Author can capture the early-finish attribute per course and see it in the catalog
- Interior flagged placements block, 3-stacks warn — consistently across board, drag
  previews, and teacher perspective, with accurate flags on the real dp1/dp2 plan
- Full local CI gate green (`check`, `lint`, `steiger`, `test`, `test:integration`, `build`)
