# Bi-weekly Week-Aware Validation — Plan Brief

> Full plan: `context/changes/bi-weekly-week-aware-validation/plan.md`
> Research: `context/changes/bi-weekly-week-aware-validation/research.md`

## What & Why

Most courses meet every week, but a few run **fortnightly** — only week A or only week B of a two-week
cycle. This change makes "week" a first-class dimension so two opposite-week courses can share a
`(day, period)` slot without colliding, and so the grouping palette actively suggests those A/B shares.
Implements PRD FR-002 (mark a course bi-weekly; choose the week at placement) and FR-003 (week-aware
validator).

## Starting Point

There is no week concept today (the only "week" token is `hours_per_week`). The constraint core was
built for additive extension: `BoardContext` already absorbs board-only fields, and the conflict
primitive `violatesAny` is reused across the board and the enumerator. The board path discards the
placement in `bucketByCell`, so placement week isn't visible yet.

## Desired End State

An author marks a course bi-weekly in the catalog form, places it, and assigns it to week A or B from a
per-chip control. A slot holding one week-A and one week-B placement shows them in stacked vertical
lanes with **no** collision ring; same-week overlaps still flag. The palette suggests opposite-week
(A/B) groupings — e.g. EE + CAS in the seed — draggable in one motion. All CI gates stay green.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Where week lives | Hybrid: course `weekMode {agnostic,biweekly}` + placement `week {both,a,b}` | Course flag drives what the palette offers; placement week drives what the board validates | Research |
| What week does | Relax conflicts on two surfaces (board + enumeration) | Reuse the conflict primitive, classify its result instead of rewriting | Research |
| Enumeration scope | v1 = opposite-week **pairs** only | O(edges), no cap risk; the board still validates any larger week-disjoint set built by hand | Plan |
| Grouping persistence | `opposite_week` boolean on `course_groupings`; A/B split at drop | One-column migration is enough to badge + sort; per-member coloring deferred to v2 | Plan |
| Slot unique key | Unchanged — a course occupies a slot once | Keeps idempotent insert + `updatePlacementWeek`; no requirement to split one course across A/B | Plan |
| Hours math + naming | Out of scope; keep `hours_per_week` name | Counting (rows-vs-required) is name-independent; a placement is one weekly-grid cell that recurs every other week. Fortnight-explicit rename deferred to a separate refactor | Plan |
| Ranking | Reuse `score.ts` formula + A/B badge | No scoring fork; the badge disambiguates fortnight shares | Plan |
| Drag hints | Soft-aware "opposite-week" hint (week chosen after drop) | Avoid a misleading "blocked" on a legal opposite-week cell | Plan |
| Testing | Unit-heavy + targeted integration; no new e2e | Risk is semantic (constraint logic); existing e2e guards UI | Plan |
| Cross-cohort (FR-006) | Out of scope — next change (S-04) | This change is a clean enabler; add zero cross-cohort scaffolding | Research |

## Scope

**In scope:** course `week_mode` + placement `week` columns; reusable `Week`/`weeksDisjoint` primitive;
board relaxation (`teacher-conflict` + `student-conflict`); catalog projection + hash; enumeration v1
opposite-week pairs + `opposite_week` persistence; course-form toggle + table badge; in-cell A/B lanes,
per-chip A/B control, soft-aware drag hint; CSV-driven seed (EE/CAS bi-weekly in DP1+DP2 via a
`week_mode` fixture column read by the shared transcode); clone + RPC threading.

**Out of scope:** cross-cohort occupancy (S-04); enumeration v2 mixed-set 2-coloring; placements
unique-key change; week-aware hours/completeness; changes to `duplicate-course` / `teacher-availability`;
new e2e tests.

## Architecture / Approach

Bottom-up in five layers, each independently testable: **data foundation → board validator → catalog +
enumeration → course-authoring UI → board week UI.** Week is plumbed end-to-end first (no behavior
change), then the validator relaxes via `BoardContext.weekByCourseId` + `weeksDisjoint`, then
enumeration emits soft pairs, then the two UI surfaces (input form + board lanes) light it up. The
conflict primitive, the scoring formula, and the `BoardContext` additive pattern are all reused.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Data foundation | Enums + 3 columns + clone, types, `weeksDisjoint`, placement/course week threading, seed | `clone_plan` / type-regen churn; getting defaults right |
| 2. Board validator | Opposite-week placements stop colliding; same-week still flags | `teacher-conflict` multi-course week semantics |
| 3. Catalog + enumeration v1 | Palette suggests opposite-week pairs; `opposite_week` persisted | Catalog-hash inclusion; RPC payload change |
| 4. Course authoring UI | `weekMode` toggle in form + table badge | Minimal — small RHF + badge wiring |
| 5. Board week UI | A/B lanes, per-chip control, soft-aware drag hint | Lane rendering for mixed/multi-occupant cells; new `DropHint` kind |

**Prerequisites:** local Supabase running (Docker) for `db reset` + integration tests; the research
doc's locked hybrid model.
**Estimated effort:** ~4–6 implementation sessions across 5 phases (Phase 1 and Phase 5 are the heaviest).

## Open Risks & Assumptions

- `teacher-conflict` becomes multi-course week-aware (a `both` course overlaps both single weeks) — the
  trickiest logic; covered by explicit unit cases.
- Soft-aware drag hint adds a new `DropHint` kind and precedence rule — modest extension beyond what the
  research deferred (chosen deliberately for discoverability).
- Enumeration result-space growth is bounded for v1 pairs; v2 mixed sets (deferred) are where the caps
  would matter.
- Assumes EE/CAS are the right demo courses to seed bi-weekly (confirmed with the user).

## Success Criteria (Summary)

- Two opposite-week courses share a slot with no collision ring; same-week overlap still flags.
- The palette suggests the EE+CAS opposite-week grouping and it drops onto a slot with weeks
  auto-assigned.
- A course can be marked bi-weekly in the form and a placement assigned A/B from the board; all CI gates
  (`/verify`, integration, e2e) stay green.
