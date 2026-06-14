# Collision Info (Explainable Collision Feedback) — Plan Brief

> Full plan: `context/changes/collision-info/plan.md`
> Research: `context/changes/collision-info/research.md`

## What & Why

Collision feedback on the plan board is binary today: a badge and a generic tooltip ("shares a student or teacher"). The planner can't act efficiently without knowing *which* subject, teacher, or student causes the conflict — e.g. seeing the specific student lets them move that student to another group instead of shuffling courses. The PRD already promises this: invalid placements must be reported "with the specific class(es) of violation named" (prd.md:148).

## Starting Point

Detection is a single boolean predicate (`hasIntersection`) wrapped by `deriveCollisions`, which returns only *which* course ids collide per cell. All data needed to explain (teacher/student ids per course) is already in scope at the detection site; only display names are missing client-side. The badge is a static, non-clickable span. The same predicate is reused by the combinatorial grouping enumerator, which must stay fast.

## Desired End State

Clicking a collision badge opens a Dialog that lists **every** collision in that cell, grouped by cause — "Jane Smith teaches both Math HL and Physics SL", "Math HL ↔ Chemistry HL — 4 shared students: Anna Kowalska, …" — with the clicked course visually emphasized. The constraint system becomes a registry where adding a future constraint (availability, cross-cohort) is a new file + registry entry, never an edit to existing checks.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Architecture | Constraint registry; verdict + explanation derived from one rule set (Option C) | Detector and explainer can't drift; open-closed for new constraints | Research |
| Detail surface | Dialog on badge click (no Drawer, no descriptive tooltip) | Matches CourseOverlaps precedent; handles long student lists; single source of detail | Research + Plan |
| Dialog scope | Whole cell, clicked course emphasized | Resolution may move any participant (accept-and-flag rationale) | Plan |
| Dialog layout | Grouped by cause (Teacher / Students / Duplicate sections) | Mirrors the registry 1:1 — a new constraint kind adds a section | Plan |
| Student display | Full names | Names are actionable — planner may move that student to another group | Research (author) |
| Trigger | Badge only (focusable button) | Zero interference with chip drag; smallest a11y surface | Plan |
| `BoardContext` | Minimal now (`cell` + `catalogById`); future fields additive | Stable evaluator signature is the open-closed guarantee; no speculative plumbing | Research |
| `hasIntersection` | Kept, but derived from registry fast path; `enumerate.ts` untouched | One rule set, two consumption modes; ctx-needing constraints auto-excluded from enumeration | Plan |
| Testing | Unit + parity + integration (name loading) | Parity guards the refactor; integration locks the data contract | Plan (author) |
| Problems panel | Out of scope | Keeps the change shippable; registry output makes it nearly free later | Research + Plan |

## Scope

**In scope:** constraint registry (`model/constraints/`), verbose `deriveCellViolations`, `teacherNames`/`studentNames` via `loadPlannerData`, clickable badge, `CollisionDetailsDialog`, unit/parity/integration tests.

**Out of scope:** board-level problems panel, new constraint kinds (S-09 cross-cohort, availability), tooltip content, Drawer primitive, enumerator/drop-policy/schema changes, student-name links to the choices UI.

## Architecture / Approach

`CellConstraint = { id, explain(occupants, ctx), test?(course, others) }` — `explain` enumerates structured `CollisionViolation`s (ids only); optional ctx-free `test` short-circuits for the hot boolean path. `deriveCellViolations` returns `Map<cellKey, { conflictingIds, violations }>` in one pass; today's flag set is a projection of it. Names stay out of the model: `load.ts` ships id→name records, the Dialog resolves at the render edge (house pattern). UI follows the controlled-Dialog + `onClose` convention.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Registry + verbose derivation (model) | Same board behavior, structured violations underneath, parity-tested | Semantics drift in the refactor — mitigated by parity tests on existing fixtures |
| 2. Name records (api) | `teacherNames`/`studentNames` on island props, integration-tested | Trivial — two `.in("id", …)` selects |
| 3. Badge + Dialog (ui) | Clickable badge, grouped explanation Dialog with emphasis | Click-vs-drag interference inside the draggable chip (known pattern: stopPropagation on pointerdown) |

**Prerequisites:** local Supabase stack for Phase 2's integration test (`pnpm exec supabase start`).
**Estimated effort:** ~2–3 sessions across 3 phases.

## Open Risks & Assumptions

- Assumes per-cell occupant counts stay small (≈≤10) so eager violation enumeration is microseconds — true for the current domain; revisit only if cells grow unbounded.
- Dialog copy renders teacher fallback as `code` when `full_name` is null — acceptable for provisional catalog data.
- `PlannerGrid` header labels are reused for the Dialog title; assumes they exist in a reusable form (implementer verifies).

## Success Criteria (Summary)

- A planner clicking any collision badge can name the exact cause: which courses, which teacher, and/or which students (full names) — without leaving the board.
- Board behavior is otherwise byte-identical: same flags, same drag/drop, same accept-and-flag policy (parity tests + manual pass).
- Adding a hypothetical new constraint requires only a new evaluator file, a union member, and a registry entry — no edits to existing constraints, derivations, or the Dialog's existing sections.
