---
date: 2026-07-05T20:35:21+0200
researcher: Dobromir Kropielnicki
git_commit: 5eef068841d61fdc9f89fe925ec5680e48b3a127
branch: feat/planner-board-search-discovery
repository: 10xdev3 (ib-timetable-planner)
topic: "Feasibility of a read-only Teacher plan view page (board filtered to one teacher + course list with student assignments and occurrence times, printable)"
tags: [research, codebase, teacher-plan-view, plan-detail, printing, fsd]
status: complete
last_updated: 2026-07-05
last_updated_by: Dobromir Kropielnicki
last_updated_note: "Open questions resolved with the author — all scope decisions recorded; ready for /10x-plan"
---

# Research: Feasibility of the Teacher Plan View page

**Date**: 2026-07-05T20:35:21+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: `5eef068841d61fdc9f89fe925ec5680e48b3a127`
**Branch**: `feat/planner-board-search-discovery`
**Repository**: 10xdev3 (ib-timetable-planner)

## Research Question

Is it feasible to build a new read-only page showing the plan from a specific teacher's perspective — exclusively the courses conducted by that teacher on the timetable board, plus a list of those courses below with student assignments and occurrence times? Audience: **signed-in plan authors only** (confirmed during scoping). The page will most likely need **print / PDF export** (added during scoping).

## Summary

**Feasible, and cheaper than it looks — no schema work, no auth work, no new Astro Actions.** The entire data chain (teacher → courses → placements → students) exists today, and `loadCombinedPlannerData` already returns every piece the page needs in one SSR load. Four findings shape the design:

1. **Data is fully available.** `course_teachers` (co-teaching sets), `student_choices` (with overlap/merge unions already computed in `loadCohortCourses`), and `placements` (`day`, `period`, `week a/b/both`) answer everything. **There are no wall-clock times anywhere in the system** — "occurrence time" can only mean `(day, period, week A/B)` rendered via `dayLabel`/`periodLabel`. Real clock times would be genuinely new schema/config.
2. **A teacher-perspective mechanism half-exists.** The board lens (`planner-board-search-discovery`) already matches placements by teacher and was motivated by exactly "what does teacher KK's week look like" — but it's highlight-only (dims, doesn't filter), board-only (no course list), and has no print story. It proves the filtering predicate and confirms all data is client-side; it is not the page itself.
3. **No read-only board rendering mode exists.** `SlotCell`/`PlacedChip` call dnd-kit hooks unconditionally and render edit affordances whenever occupants exist. Reuse means either ~2 presentational extractions from the existing grid, or (recommended, see below) a small dedicated static grid — which the print requirement independently favors, because `PlannerGrid`'s zoom / sticky headers / `overflow-auto` shell are print-hostile.
4. **Print/PDF collides with a stated Non-Goal.** `prd.md` §Non-Goals and `roadmap.md` §Parked explicitly park "Printable / PDF export". Building it is technically easy (print CSS + `window.print()`, effort S) but requires a conscious scope decision to override the PRD.

Recommended shape: a new route `src/pages/plans/[id]/teacher/[teacherId].astro` (auto-protected by deny-by-default middleware), with the island living **inside the existing `plan-detail` slice** (route files may import any slice, so nothing needs promoting to `shared/`), rendering a dedicated static, print-friendly grid + course list from the existing loader's data.

## Detailed Findings

### 1. Data availability — everything exists, nothing missing at DB or query level

**Schema** (all tables plan-owned since the re-baseline `supabase/migrations/20260611180006_plans_as_domain_root.sql`):

| Table | Key columns | Migration |
|---|---|---|
| `plans` | `id, name, slot_grid_preset` (`"5x10"` = days×periods) | `20260602185012_minimal_domain_schema.sql:91-97` |
| `teachers` | `id, plan_id, code, full_name` | base `:17-23`; plan-owned `20260611180006:31-34` |
| `courses` | `id, plan_id, cohort, name, level, group_index, hours_per_week, week_mode, color` | base `:29-43`; week_mode `20260621130000:18-19`; color `20260630162148` |
| `course_teachers` | `plan_id, course_id, teacher_id` — **the** teacher↔course junction (co-teaching) | `20260620120000_course_teachers.sql:16-27` |
| `students` | `id, plan_id, cohort, full_name` | base `:69-75` |
| `student_choices` | `plan_id, student_id, course_id` | base `:81-88` |
| `placements` | `plan_id, cohort, day, period, course_id, week ('both'\|'a'\|'b'), bundle_id` | base `:116-127`; week `20260621130000:21-22` |
| `teacher_availability` | `plan_id, teacher_id, day, period, severity` | `20260613130000:14-27` |

**No clock times.** `day`/`period` are 1-based integers; labels are generated in code (`src/shared/lib/slot-labels/day-label.ts:1-8` → "Mon".."Sun", `period-label.ts` → "P{n}"). Breaks after periods 2 and 5 are a cosmetic in-code const (`src/_pages/plan-detail/lib/period-breaks.ts:10`), not data. The `sticky-days-periods-names` change was UI-only. "When each course occurs" therefore = `(day label, period label, week A/B)` — anything more (e.g. "09:45–10:30") is new schema.

**Existing queries already cover the chain:**
- `loadCombinedPlannerData` (`src/_pages/plan-detail/api/load.ts:39-137`) — the plan board's single SSR load — returns both cohorts' placements, the catalog with `teacherKeys[]` and `studentKeys[]` per course, `courseDisplay`, `studentNames`, `teacherNames`, and the grid preset. **This is already the full teacher-view dataset**; filtering to one teacher is `catalog.filter(c => c.teacherKeys.includes(teacherId))`.
- `loadCohortCourses` (`src/shared/api/load-cohort-courses.ts:20-99`) computes `studentKeys` as `student_choices` **unioned with overlap-dependents' and merge-children's choices** (`:60-84`) — this IS "students assigned to a course". A naive re-query of `student_choices` would get overlap/merge courses wrong; reuse this.
- The reverse lookup "courses taught by teacher X" already exists in `loadTeacherCatalog` (`src/_pages/teachers/api/loader.ts:16-59`).
- Per-course hours: `deriveHours(placements, catalog)` → `Map<courseId, {placed, required}>` (`src/_pages/plan-detail/model/hours.ts:14-60`), with a rendered precedent in `CoursesLeftPopover` / `courses-left-summary.ts:38`.

**Gap:** only a composed presentation — no single `loadTeacherPlanView`. Either reuse `loadCombinedPlannerData` and filter client/SSR-side (simplest; the data volume is the same board data the author already loads), or compose a narrower loader from the same primitives.

### 2. Routing, auth, and data-loading pattern — zero friction

- **Middleware needs no change.** `src/middleware.ts` is deny-by-default: `PUBLIC_PATHS = ["/auth/signin"]` (`:8`), everything else redirects unauthenticated users (`:47-49`). Any new `/plans/:id/teacher/...` route is automatically gated. (Note: middleware enforces *authenticated*, not an "author" role — same as every existing page.)
- **Reads are SSR, not Actions.** The established pattern (`src/pages/plans/[id]/teachers.astro:9-23`): `createClient(Astro.request.headers, Astro.cookies)` → `isPlanId` param guard → `Promise.all([loadPlanSummary, load...])` → `Astro.response.status = 404/503` on failure → mount island with props + `client:load`. Loaders return `LoaderResult<T>` via `withSupabase` (`src/_pages/teachers/api/loader.ts:13`). A read-only page adds **nothing** to `src/actions/index.ts`.
- **Route shape:** the codebase mixes nested params (`plans/[id]/...`) and search params (`?focus=` parsed by a zod `.catch()` schema, `src/_pages/plan-detail/lib/board-surface.ts:9`). Either `plans/[id]/teacher/[teacherId].astro` or `plans/[id]/teacher-view.astro?teacherId=` fits convention; a path param is more shareable/printable-friendly.
- **Navigation insertion points:** plan sub-nav is `planNavItems(planId)` in `src/shared/config/nav.ts:20-25` (rendered by `SidebarLayout.astro:28`); per-teacher entry links fit naturally in the teachers table island (`src/_pages/teachers/ui/TeacherTable.tsx` — "view plan for this teacher" row link) and/or the board chrome next to `CohortSwitcher` (`src/_pages/plan-detail/ui/chrome/`).

### 3. UI reuse — the board frame is reusable with care; cells are not; a dedicated static grid is the cheap path

- **No read-only mode exists anywhere.** `SlotCell.tsx:61` registers `useDroppable` unconditionally via `useCellDnd` (`:172`) and renders the `SlotHeader` edit strip for every non-empty cell (`:135-147`); `PlacedChip.tsx:40` calls `useDraggable` (`:52`) and renders remove button + `WeekToggle`. dnd-kit hooks can't be flag-disabled (hook rules), so read-only reuse requires extracting presentational `CellLayout`/`ChipBody` components that the editable versions compose DnD onto (~2 extractions; the styling logic is already pure — `chipToneClass` at `PlacedChip.tsx:144-159`, `tone-class.ts`, `WeekLane.tsx`).
- **The grid frame is print-hostile as-is:** CSS `zoom` inline (`PlannerGrid.tsx:96`, localStorage-persisted), sticky day/period headers (`:113-160`), and the `h-screen` + `overflow-auto` shell (`SidebarLayout.astro:53`, `PlannerBoard.tsx:292`) would clip printing to one viewport. The print research independently concludes: **don't print `PlannerGrid`; render a dedicated static grid** for this page.
- **Pure model/lib reusable unchanged:** `groupCellOccupants` (`model/collision/cell-occupants.ts:31`), `model/week.ts` (`partitionByWeek`, `isBiweekly`), `model/course-display.ts:12`, `model/hours.ts`, `model/lens.ts` predicates (`deriveLensMatches`/`matchesCriterion` — exactly the teacher-filter predicate), `lib/period-breaks.ts`, plus `shared/`: `subjectChipClass` (`src/shared/config/subject-colors.ts:16-60`), `dayLabel`/`periodLabel`, `parseGridPreset` (`src/shared/lib/grid/grid.ts:27-39`), `GroupingCourse` types (`src/shared/lib/catalog-hash/types.ts:16-25`).
- **The existing teacher lens** (`model/lens.ts:12`, matching via `teacherKeys` at `:154-163`) dims non-matches to `opacity-40` (`PlacedChip.tsx:77`) — highlight, not filter; no course list; session-persisted per plan (`ui/lens/use-lens.ts:25-47`). It's the proof-of-concept, not the feature.
- **Skip entirely for this page:** `useCombinedBoardState`, `usePlacements`, undo/redo history, palette, shelf, drag overlay, drop hints, `DragDropProvider`, collision plumbing.

**New slice vs mode of plan-detail:** steiger (`fsd.configs.recommended`, `steiger.config.ts:5`) forbids `_pages/teacher-plan-view` importing `_pages/plan-detail` internals — but **route files under `src/pages/` may import any slice**. So the lowest-friction architecture is: new route file + a read-only island (`ui/teacher-view/…`) *inside* the `plan-detail` slice, reusing its loader and pure model directly, with nothing promoted to `shared/`. A separate `_pages/teacher-plan-view` slice is viable but forces promoting `loadCombinedPlannerData`-equivalents, `hours.ts`, `week.ts`, and `period-breaks.ts` to `shared/` (or duplicating them).

### 4. Print / PDF export — technically easy, but a PRD scope decision

- **Codebase is a clean slate:** zero `@media print` / `print:` / `window.print` hits; no PDF deps in `package.json`.
- **Recommended: print CSS + `window.print()` (effort S, high fidelity).** Tailwind v4 ships the `print:` variant and `break-inside-avoid` / `break-after-page` utilities. Chips are plain CSS backgrounds (no canvas/SVG) — print-friendly by construction *if* `print-color-adjust: exact` is set (missing today, backgrounds otherwise stripped). A single teacher's week fits landscape A4. "Save as PDF" in the browser dialog IS the PDF export — zero bundle, zero server work, workerd-trivial.
- **Design constraints to bake in from day one:** static grid (no zoom/sticky/overflow ancestor); escape or `print:`-override the `h-screen` shell; force **light tokens** under `@media print` (dark mode is class-based on `<html>` — `src/app/styles/global.css:5,67` — so `.dark` would otherwise leak into print); `@page { size: A4 landscape }`; `break-inside-avoid` on rows and course cards; teacher + plan name in a printing header; interactive chrome gets `print:hidden`.
- **Rejected/deferred alternatives:** `jsPDF + html2canvas` is near-certainly incompatible with the 100%-OKLCH + `color-mix` theme (`global.css:49-64,192-200`); `@react-pdf/renderer` duplicates the layout in a second layout system (~400–500 KB); **Cloudflare Browser Rendering** is GA and Workers-supported (`@cloudflare/puppeteer` binding; free tier 10 min/day, paid 10 h/mo then $0.09/h) but its headless browser must authenticate past the deny-by-default middleware (cookie forwarding or a signed-token render route that widens the allowlist — a CLAUDE.md hard-rule flag). Right tool later for *batch* exports ("all 40 teachers in one PDF"), overkill for MVP.
- **Scope conflict:** `context/foundation/prd.md:465` (§Non-Goals) and `roadmap.md:217` (§Parked) explicitly park "Printable / PDF export". Building print into this page contradicts that; per the "prefer fixing stated limitations" precedent this is likely fine to override, but it should be an explicit decision recorded in the plan (and ideally a PRD amendment).

### 5. Domain rules the page must respect (from prior changes)

- **Co-teaching:** a course carries a *set* of ≥1 equal teachers (`course_teachers`); "conducted by T" = membership in `teacherKeys`, and the same course legitimately appears on multiple teachers' pages (`2026-06-20-co-teaching-teacher-sets`).
- **Week-awareness:** occurrence = `(day, period, week)`; two opposite-week placements share a slot; bi-weekly courses recur fortnightly but count as one weekly grid cell for hours (`2026-06-21-bi-weekly-week-aware-validation`).
- **Merge composites:** merge-parent composites are scheduling artifacts; student rosters should resolve real courses, mirroring the choice picker's exclusion (`2026-06-11-students-and-choices-ui`); merged courses require identical teacher sets, so they appear coherently per teacher.
- **State conventions:** no store — derived values threaded through props per the `board-view-state-store` decision; view switching is render-time branching over one loader (`?focus=` precedent, `2026-06-28-plan-detail-unify-views`).
- **Hours info:** `deriveHours` gives `placed/required` per course for the course list, matching the `courses-left-info` presentation precedent.
- **Teacher availability** (`teacher_availability`, strong/soft) exists and could optionally shade blocked slots on the teacher's grid — cheap, but scope to decide.

## Code References

- `src/_pages/plan-detail/api/load.ts:39-137` — `loadCombinedPlannerData`: the one SSR load that already returns the full teacher-view dataset
- `src/shared/api/load-cohort-courses.ts:60-84` — student-set computation incl. overlap/merge unions (reuse; don't re-query naively)
- `src/_pages/teachers/api/loader.ts:16-59` — existing "courses by teacher" reverse lookup + loader pattern (`LoaderResult`, `withSupabase`)
- `src/middleware.ts:8-49` — deny-by-default; new route auto-protected
- `src/pages/plans/[id]/teachers.astro:9-23` — canonical SSR route template to copy
- `src/_pages/plan-detail/model/lens.ts:12,154-163` — existing teacher-match predicate (`teacherKeys` membership)
- `src/_pages/plan-detail/ui/grid/PlannerGrid.tsx:85-160` — grid frame: plain-data props but sticky/zoom (print-hostile)
- `src/_pages/plan-detail/ui/grid/slot-cell/SlotCell.tsx:61,135-147,172` — unconditional DnD + edit strip (why no read-only mode exists)
- `src/_pages/plan-detail/ui/grid/slot-cell/PlacedChip.tsx:40-159` — chip: `useDraggable`, but pure `chipToneClass`/`CHIP_LAYOUT` exported
- `src/_pages/plan-detail/model/hours.ts:14-60` — `deriveHours` for the course list's hours column
- `src/_pages/plan-detail/model/week.ts` / `lib/period-breaks.ts:10` — week partitioning; cosmetic breaks
- `src/shared/config/subject-colors.ts:16-60`, `src/shared/lib/slot-labels/`, `src/shared/lib/grid/grid.ts:27-39` — shared, reusable as-is
- `src/shared/config/nav.ts:20-25` — plan sub-nav insertion point
- `src/app/styles/global.css:5,49-67,124` — class-based dark mode + OKLCH tokens (print stylesheet must force light + `print-color-adjust: exact`)
- `supabase/migrations/20260620120000_course_teachers.sql:16-27`, `20260602185012_minimal_domain_schema.sql:81-127`, `20260621130000` — the data chain

## Architecture Insights

- **Reads are SSR loaders; Actions are mutations-only** — a read-only page touches neither `src/actions/` nor the middleware.
- **Route files are the FSD escape hatch:** `src/pages/*.astro` may import any `_pages` slice, so a new *route* can reuse `plan-detail` internals that a new *slice* could not. This makes "teacher view as a plan-detail sub-route" structurally cheaper than a new slice.
- **The board's editability is concentrated in cells, not the frame:** everything above `SlotCell` renders from plain data; everything from `SlotCell` down assumes DnD. A read-only page should therefore share *logic* (pure model/lib) and *tokens* (colors, labels), not cell components — unless pixel-identical rendering is a goal, in which case two small presentational extractions suffice.
- **Print requirements and read-only requirements point at the same design:** a static, fixed-width, non-sticky, non-zoomed grid. Building it once satisfies both.

## Historical Context (from prior changes)

- `context/archive/2026-07-03-planner-board-search-discovery/plan-brief.md` — teacher lens built for exactly this question ("what does teacher KK's week look like"); explicitly scoped out filtering, course lists, URL state, and print.
- `context/archive/2026-06-28-plan-detail-unify-views/plan-brief.md` — one board, one loader, render-time `focus` branching; the precedent for adding a view.
- `context/archive/2026-07-03-board-view-state-store/plan-brief.md` — store rejected; derived-Set-via-props is the sanctioned lane for new view flags.
- `context/archive/2026-06-20-co-teaching-teacher-sets/plan-brief.md` — teacher sets; `teacherKeys[]` aggregation; merge requires identical teacher sets.
- `context/archive/2026-06-10-teachers-catalog/plan-brief.md` — `/teachers` already renders read-only per-teacher workload (badge columns, per-cohort hours); nearest UI precedent for the course list.
- `context/archive/2026-07-01-courses-left-info/plan-brief.md` — `deriveHours` and the hours-summary presentation.
- `context/archive/2026-06-21-bi-weekly-week-aware-validation/plan-brief.md` — the week A/B model occurrence listings must respect.
- `context/archive/2026-06-29-breaks-between-periods/` + `2026-06-30-sticky-days-periods-names/` — periods have no clock times or custom names; breaks/sticky are cosmetic.
- `context/foundation/prd.md:462-465`, `roadmap.md:214-217` — Non-Goals: teacher/student self-entry flows (an author-facing view is different in kind) and **Printable/PDF export (the direct conflict to resolve)**.

## Related Research

- `context/archive/2026-07-03-planner-board-search-discovery/` (research + plan) — closest prior investigation of teacher-perspective needs.
- `context/archive/2026-06-30-sticky-days-periods-names/research.md` — grid header/label mechanics.

## Open Questions

1. **Occurrence times:** is `(Mon, P3, week A)` sufficient, or do printouts need wall-clock times ("09:45–10:30")? The latter is new schema/config (per-plan period time table) — the only genuinely new data work identified.
2. **Print scope decision:** override the PRD Non-Goal for printable export on this page? (Recommended: yes for print-CSS MVP; record as a PRD amendment. Server-side batch PDF stays parked.)
3. **Route shape:** `plans/[id]/teacher/[teacherId]` path param (shareable, printable URLs) vs `?teacherId=` search param (matches `?focus=` pattern)?
4. **Slice placement:** island inside `plan-detail` (recommended; zero shared/ promotions) vs new `_pages/teacher-plan-view` slice (cleaner isolation, but forces promoting loader/model pieces to `shared/`)?
5. **Presentation details:** show teacher-availability shading on the grid? show the author's collision state (probably not on a teacher-facing printout)? how to label merged composites and co-taught courses on the course list?
6. **Pixel parity:** should teacher-view chips render identically to the board (→ extract `ChipBody` from `PlacedChip`) or is a simpler print-oriented chip acceptable (→ reuse only `subjectChipClass`)?

## Follow-up Research 2026-07-05T21:05+0200 — architecture revisited under a multi-view working assumption

**Prompt:** The author challenged the "island inside plan-detail" recommendation: it makes plan-detail serve two purposes, and each future persona view (e.g. a student plan view) would extend plan-detail again. Working assumption adopted: **this page is the first of a family of read-only perspective views.** Should the FSD entities layer be (re)introduced?

**Verdict: the recommendation changes.** Grounded in the FSD v2.1 skill (core doc + `references/excessive-entities.md`):

- **"Island inside plan-detail" is withdrawn.** Under the family-of-views assumption it drifts toward the FSD "god slice" anti-pattern (one slice serving editing *and* every read-only persona view) and violates the repo's own repeated-touches-refactor cue.
- **An `entities` layer is justified — but by *confirmed* reuse, not the assumption.** FSD's bar for entities is "same domain logic currently used by 2+ consumers, not hypothetically." The pure read-side scheduling logic (`model/week.ts` partitioning, `cell-occupants.ts` grouping, `model/hours.ts`, the lens's `teacherKeys` match predicate, `course-display.ts`) meets that bar on day one: plan-detail already consumes it and teacher-plan-view must too, and it *cannot* go to `shared/` (FSD rule 4-5: no business logic in shared). Boundary: **one isolated entity slice — `entities/timetable`** — not per-noun entities (`course`/`teacher`/`placement`), which is the documented `@x`-chain anti-pattern.
- **Plain read fetchers go to `shared/api`, not entities.** FSD places CRUD-without-business-meaning in `shared/api` (`references/excessive-entities.md` §3); placements/name-map fetchers belong next to the existing `shared/api/load-cohort-courses.ts`.
- **The read-only board UI stays in the page slice for now; `widgets/` waits for the second consumer.** A widget consumed by one page is exactly what steiger's `insignificant-slice` flags; FSD v2.1 defers extraction until reuse is real. Build the board presentational (data-in, no store, print-friendly) inside `_pages/teacher-plan-view/ui`; when the student view lands, promotion to `widgets/timetable-board` is a mechanical move — and it is also *forced* at that moment, since two page slices cannot cross-import.
- **What must NOT move:** the constraint/validation core, drag state, undo/redo, drop dispatch — single-consumer (plan-detail), performance-budgeted (<200ms, CLAUDE.md hard rule), and cited by CLAUDE.md/README/ui-conventions as living in `src/_pages/plan-detail/model/`. Per the lessons.md convention-coupling rule, any file that does move out of a documented location requires updating those docs in the same change.

**Revised target architecture:**

| Layer | Contents |
|---|---|
| `_pages/teacher-plan-view` | route loader composition, read-only print-friendly board + course list UI |
| `entities/timetable` (new) | placement/week/occupancy/hours/perspective-match pure domain — imported by plan-detail *and* teacher-plan-view |
| `shared/api` | promoted read fetchers (placements, teacher/student name maps) beside `load-cohort-courses.ts` |
| `_pages/plan-detail` | keeps everything editing-related exclusively; re-imports the entity |
| `widgets/` | **deferred** until the student view exists → `widgets/timetable-board` |

**Feasibility impact:** adds a mechanical prep phase (pure-function moves + retargeting plan-detail import sites + doc updates; no behavior change, tests move alongside), simplifies the teacher view itself, and turns the future student view into "new page slice + reuse entity + extract widget" instead of a third extension of plan-detail. Steiger's `fsd.configs.recommended` recognizes the `entities` layer without config changes. Open question #4 above is resolved by this section; #1–#3 and #5–#6 stand.

## Scope Decisions 2026-07-05 (all open questions resolved with the author)

Recorded from an interactive Q&A; these supersede the Open Questions section and are the authoritative input to `/10x-plan`.

1. **Occurrence times → hardcoded in-code period→time map**, cosmetic, following the `BREAK_AFTER_PERIODS` precedent (`src/_pages/plan-detail/lib/period-breaks.ts:10`). Acceptable because the product currently targets a single school. **Constraint:** implement behind a single lookup seam (e.g. `periodTimeRange(period)` in the timetable entity/lib) so a future per-plan period timetable (schema + editing) can replace the const without touching consumers. Do not scatter time literals through the UI.
2. **Print/PDF → deferred to a follow-up change, but must not be blocked.** This page ships screen-only, yet every print-enabling constraint from the print research stays in force as a design rule: static non-sticky non-zoomed grid, SSR-renderable page at a stable URL (keeps server-side batch PDF via Cloudflare Browser Rendering viable — explicitly attractive to the author), all content print-visible (no conditionally-rendered/collapsed-out-of-DOM content), semantic tokens only. The PRD Non-Goal stays untouched for now; the follow-up change owns the amendment.
3. **Route → path params: `/plans/[id]/teacher/[teacherId]`**, plus an **in-page teacher switcher** (a picker in the page header navigating between teacher URLs — link-navigation pattern like `CohortSwitcher`, `src/_pages/plan-detail/ui/chrome/CohortSwitcher.tsx:16`). Sets the URL pattern the future `/plans/[id]/student/[studentId]` sibling will mirror.
4. **Chips → not pixel-identical; same design language.** A simpler presentational chip in the page slice reusing the shared subject-color tokens (`subjectChipClass`), typography, and shape conventions of the board — no extraction from `PlacedChip`, no surgery on the editing hot path.
5. **Grid extras → availability shading AND collision indicators.** Shade the teacher's blocked slots (`teacher_availability`, strong/soft) and surface collision badges where the teacher's courses currently conflict — the page doubles as per-teacher QA for authors. (Collision derivation must come from the shared/entity read-side logic, not the editing store.)
6. **Merged composites → one block on the grid, real rosters in the list.** The grid mirrors the board's reality (a merged session occupies one slot as one block); the course list below resolves the real child courses, each with its own student roster — consistent with the choice-picker precedent that composites are scheduling artifacts.
7. **Course list contents → occurrence times + student rosters + hours placed/required (`deriveHours`) + co-teachers + cohort/level badges** (matching `/teachers` badge conventions). **Roster presentation:** the author floated rosters-behind-expansion; challenged and resolved to **always-visible compact rosters** (multi-column, dense) because per-teacher volume is small (~2–6 courses) and collapsed content breaks every future print path. If disclosure is ever added, it must be CSS-collapse with the content always in the DOM and forced open under `@media print` — never conditional rendering.
