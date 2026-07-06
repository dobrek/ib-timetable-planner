# Teacher Plan View — Plan Brief

> Full plan: `context/changes/teacher-plan-view/plan.md`
> Research: `context/changes/teacher-plan-view/research.md`

## What & Why

A read-only page showing the plan from one teacher's perspective: a static timetable grid with only that teacher's courses, plus a course list with occurrence times, student rosters, hours, and co-teachers. It replaces "squint at the full board with the highlight lens" with a dedicated, shareable, print-viable page — and doubles as per-teacher QA by surfacing availability conflicts and collisions. It is the first of a planned family of perspective views (student view next), which drives the architecture.

## Starting Point

Everything needed exists: the data chain (`course_teachers` → `placements` → `student_choices` with merge/overlap unions), a fully pure collision core, availability data already in the board's SSR load, and the board's teacher lens proving the filter predicate. What's missing: any read-only board rendering (cells are hard-wired to dnd-kit), empty-slot availability shading, display times for periods, and a legal FSD home for domain logic shared by two page slices.

## Desired End State

An author opens `/plans/<id>/teachers/<teacherId>` (from the teachers table) and sees the teacher's week — merged sessions as one block, blocked slots shaded, conflicts badged and inspectable via the existing details dialog — with a dense course list below (times like "Mon P3 · 09:55–10:40 · Week A", hours placed/required, co-teachers, badges, always-visible rosters) and a switcher to jump between teachers.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Architecture | New `entities/timetable` FSD slice for the pure read-side domain | First of a family of views; extending plan-detail per persona is a god-slice trajectory | Research |
| Entity scope | **Full pure core moves, including the collision registry** | Type entanglement (`cell-occupants` ↔ `CellCollisions`) makes a partial move a forbidden `entities → _pages` import; the teacher view is a genuine second consumer | Plan |
| Route | `/plans/[id]/teachers/[teacherId]` (plural — amends research's singular) | Sidebar highlights nav by path prefix, so nesting under `/teachers/` highlights the Teachers item for free | Plan |
| Occurrence times | Hardcoded placeholder bell schedule behind a `periodTimeRange()` seam | Single-school product; one-const edit when the real schedule arrives; seam keeps a future per-plan timetable from touching consumers | Research + Plan |
| Print/PDF | Deferred; print-*viability* rules binding now (static grid, all content in DOM, tokens, SSR at stable URL) | Ships value sooner; PRD Non-Goal amendment belongs to the follow-up change | Research |
| Conflict display | Availability shading + collision badges, badge opens the existing `CollisionDetailsDialog` (moved to the entity) | The page doubles as per-teacher QA; the dialog is already pure, zero new UI | Research + Plan |
| Merged composites | One block on the grid; real child courses (own rosters) in the list | Grid mirrors scheduling reality; composites are scheduling artifacts | Research |
| Chips | Simpler presentational chips on shared subject tokens — no `PlacedChip` surgery | Same design language without touching the editing hot path | Research |
| Entry points | Teacher name/code cell link + "View plan" row action | Master→detail discoverability plus the established row-action idiom | Plan |
| Test depth | Unit + loader integration test + one e2e spec | Matches the lessons rule (listed integration tests must exist) and locks the role-based grid contract | Plan |

## Scope

**In scope:** `entities/timetable` extraction (+ doc updates per the doc-coupling rule), period-time seam, teacher-perspective derivations (incl. new empty-slot availability shading), promoted read fetchers in `shared/api`, the page slice + route + switcher, teachers-table links, unit/integration/e2e coverage.

**Out of scope:** print CSS / PDF export (follow-up owns the PRD amendment), per-plan editable period times, the student view itself, `widgets/` extraction, any change to editing machinery or middleware, wall-clock times in the schema.

## Architecture / Approach

`_pages/teacher-plan-view` (route loader + read-only UI) and `_pages/plan-detail` (editing, untouched behavior) both import `entities/timetable` — the pure scheduling domain: placement/week types, collision core + constraint registry, availability indexes, hours, course display, lens matching, period breaks/times, teacher-perspective filters, and the pure `CollisionDetailsDialog`. Plain read fetchers live in `shared/api`. The route file SSRs one serializable dataset; the island derives everything at render via pure entity calls. Collision narrowing runs on **full** cohort placements, then filters to the teacher — never the reverse.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Extract `entities/timetable` | Mechanical move of the pure core + import retargets + doc updates, zero behavior change | Blast radius (~68 import sites incl. tests); mitigated by full green gate + board smoke test |
| 2. Perspective model + period times | `periodTimeRange()` seam + teacher filtering/narrowing/shading, unit-tested | Violation-narrowing semantics (keep student conflicts touching the teacher's course) |
| 3. Loader, route, page UI | The working page: static ARIA grid, course list, switcher, integration test | Merge-children resolution in the loader; island prop serialization |
| 4. Entry points + e2e | Teachers-table links + one Playwright spec | E2E flakiness placing a course via UI helpers |

**Prerequisites:** local Supabase stack for integration/e2e; nothing else — no schema, no middleware, no new deps.
**Estimated effort:** ~3–4 sessions across 4 phases; Phase 1 is the largest diff but the least thought.

## Open Risks & Assumptions

- Placeholder bell schedule is knowingly wrong until the real times are supplied (one-const fix).
- Assumes merge parent→children relations are readable via the same query path `load-cohort-courses.ts:60-84` uses — verified pattern, but the loader shape firms up in Phase 3.
- Moving the documented constraint core rewrites a CLAUDE.md hard-rule line; the <200ms budget statement is preserved and no code path changes.

## Success Criteria (Summary)

- An author reaches any teacher's view in one click from the teachers table and can answer "what does this teacher's week look like, and is anything wrong with it?" without touching the board
- Merged/co-taught/biweekly courses render truthfully (one block, real rosters, week labels, correct times)
- Full gate green: `pnpm check && pnpm lint && pnpm steiger && pnpm test && pnpm test:integration && pnpm test:e2e && pnpm build`
