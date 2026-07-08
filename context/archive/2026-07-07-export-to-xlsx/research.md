---
date: 2026-07-07T22:15:53+02:00
researcher: Claude
git_commit: 016c546cb03913daead47b156be5b87209bb256c
branch: main
repository: 10xdev3 (ib-timetable-planner)
topic: "Export to xlsx — feasibility with current UI, data model, and tech stack; Cloudflare Workers limitations"
tags: [research, codebase, export, xlsx, cloudflare-workers, plan-detail, entities-timetable]
status: complete
last_updated: 2026-07-07
last_updated_by: Claude
last_updated_note: "All open questions resolved; added: paid Cloudflare plan on record; design constraint — pure runtime-agnostic workbook transform for future server-side batch export (per-student/per-teacher)"
---

# Research: Export to xlsx — feasibility check

**Date**: 2026-07-07T22:15:53+02:00
**Researcher**: Claude
**Git Commit**: 016c546cb03913daead47b156be5b87209bb256c
**Branch**: main
**Repository**: 10xdev3 (ib-timetable-planner)

## Research Question

Check the feasibility of building an "export to xlsx" feature with the current UI, data model, and tech stack. Additionally, check whether the stack needs extending (current Cloudflare limitations) to make it work.

## Summary

**Feasible today, with no Cloudflare extension required — provided generation runs client-side.**

1. **Data model: ready.** A single existing loader, `loadCombinedPlannerData` (`src/_pages/plan-detail/api/load.ts:44`), already assembles everything a master-grid export needs: both cohorts' placements, course display names + colors, teacher names, grid dimensions, bi-weekly week tags, optional flags, and parked bundles. No new DB queries or migrations are needed — only re-composition of existing loaders and pure helpers.
2. **UI: a natural slot exists.** The board toolbar's `trailing` slot (`PlannerBoard.tsx:248`) / `BoardSettingsMenu` is the obvious entry point; the plans-list row menu (`PlansHub.tsx:145-169`) is a secondary one. There is **no file-download precedent anywhere in `src/`** — this feature introduces the first one.
3. **Cloudflare: no blocker if client-side.** The full plan state (including unsaved in-session edits) already lives in the browser board store. Generating the file in the React island via `write-excel-file` (~19 KB gzip, active, styling-capable, zero Node APIs) bypasses every Workers limit — no CPU-cap, bundle-size, or `nodejs_compat` concern. This matches the documented infrastructure escape hatch ("move logic to client-side islands", `infrastructure.md:52`).
4. **Server-side is viable but conditional.** The 10 ms free-plan CPU cap is the one real risk; on paid (30 s) it's comfortable. A new `/api/` route would be auth-gated for free by the deny-by-default middleware (which even anticipates a future export route at `src/middleware.ts:18`). Only needed if a non-interactive consumer (email/cron/curl) must fetch the file.
5. **Product-history flag:** every prior document specifies **CSV, never xlsx**. Export is PRD **Open Question #3** — unresolved, not a committed slice. Building this change resolves that question in-scope and changes the format; the required content is pinned: a **master-grid distinguishing both cohorts and representing co-teaching + bi-weekly weeks** (`prd.md:380-381`).

## Detailed Findings

### 1. Data model — what an exporter would serialize

**Schema root.** `plans` is the domain root (`supabase/migrations/20260611180006_plans_as_domain_root.sql`); cohort is a native enum `('dp1','dp2')` (line 28). A plan's timetable content is uniquely identified by its `placements` rows — keyed `(plan_id, cohort, day, period, course_id)` unique (`plans_as_domain_root.sql:98-99`) — with `week` (both/a/b), `is_optional`, and `bundle_id` grouping co-located placements into cells. Grid geometry comes from `plans.slot_grid_preset` (e.g. `"5x10"`), parsed by `parseGridPreset` (`src/shared/lib/grid/grid.ts:27`, max 7×12).

**Supporting tables:** `courses` (name, level, group_index, hours_per_week, week_mode, color), `teachers` (code, full_name), `course_teachers` junction (a course has a *set* of teachers — co-teaching), `students` + `student_choices`, `course_overlaps`/`course_merges`, `bundles` (one placed bundle per cell), `shelf_bundles` (parked, off-board — unscheduled courses).

**One loader returns nearly everything.** `loadCombinedPlannerData` (`src/_pages/plan-detail/api/load.ts:44-142`, wired in `src/pages/plans/[id]/index.astro:15`) loads both cohorts in parallel and returns `CombinedPlannerData { planName, shared, dp1, dp2 }` — placements, `courseDisplay` (name + color), `catalog` (`GroupingCourse[]` with `teacherKeys`/`studentKeys`/`hours`/`weekMode`), teacher/student name maps, availability, parked bundles.

**Display helpers all exist** (pure, reusable):
- `resolveCourseDisplay` (`src/entities/timetable/model/course-display.ts:12`), `formatCourseBadgeLabel` (`src/shared/lib/course-label/course-label.ts:4`)
- `dayLabel` / `periodLabel` (`src/shared/lib/slot-labels/`), `periodTimeRange` (`src/entities/timetable/lib/period-times.ts:13`), `cohortLabel` (`src/shared/config/cohorts.ts:25`)
- Per-teacher / per-student narrowing is already pure predicate filtering: `teacherCourses` / `studentCourses` / `perspectivePlacements` (`src/entities/timetable/model/perspective.ts:19-27`) — directly reusable for per-teacher/per-student sheets.

**Two genuine gaps (small):**
- **Subject colors resolve to Tailwind classes, not hex.** `subjectChipClass` (`src/shared/config/subject-colors.ts:42`) returns CSS classes; xlsx cell fills need a hue→hex map (values live in `src/app/styles/global.css`). A small `SUBJECT_COLOR_HEX` map must be added.
- **Per-course teacher/student rosters as strings are not pre-assembled.** The data is present (`catalog[].teacherKeys/studentKeys` + name maps) but joining is left to the consumer. A thin export selector would do this composition.

### 2. UI surfaces and transport conventions

**Entry points:**
- Primary: `PlanSummaryBar` (`src/_pages/plan-detail/ui/chrome/PlanSummaryBar.tsx:44-62`) — the header rendered in every board mode; its `trailing` slot is populated at `PlannerBoard.tsx:248-260` (currently `LensPicker` + `BoardSettingsMenu`). An Export button or a `BoardSettingsMenu` item fits here.
- Secondary: per-plan row `DropdownMenu` in `PlansHub.tsx:145-169` (Clone/Rename/Delete → + Export).
- Teacher/student perspective pages (`TeacherPlanPage.tsx:102-108`, `StudentPlanPage.tsx`) have their own headers if per-person export is wanted later.

**No precedent exists** for file downloads: zero hits for `createObjectURL`, `Content-Disposition`, `Blob`, or any spreadsheet lib across `src/`; no export dependency in `package.json`. Both client-side and server-side paths are greenfield.

**Transport conventions (from `lessons.md` + code):** Astro Actions are the single transport for mutations/compute, but **API routes (`src/pages/api/`) are explicitly reserved for raw Request/Response needs including file downloads** (lessons.md "Astro Actions are the single transport…" rule). Today only `api/auth/signin|signout` exist. The middleware is deny-by-default and its comment **already anticipates a future `/api/export.csv`** staying auth-gated (`src/middleware.ts:18`); `.xlsx` is not in the exempted static-extension regex, so a server export route would be session-protected with zero extra work.

**Client-side state is already sufficient.** The board island hydrates the complete two-cohort dataset (`client:load`, `PlanDetailPage.astro:29`) and `useCombinedBoardState` (`src/_pages/plan-detail/model/use-cohort-board-state.ts:49-104`) exposes **live** placements — i.e. a client-side export captures unsaved in-session edits, which a server route cannot (it sees only persisted rows). No `dynamic import()` precedent exists in the codebase yet; introducing one for the xlsx lib on click would be a new-but-clean pattern (and at ~19 KB gzip, arguably unnecessary).

### 3. Cloudflare Workers constraints & library choice

**Repo facts:** `wrangler.jsonc` has `compatibility_date: "2026-05-08"` + `nodejs_compat` (full v2 polyfills); **no R2/KV/D1 bindings** (no place to stage files — server generation would be in-request); `output: "server"` with `@astrojs/cloudflare` (note: `package.json` is on **Astro 7** — `astro ^7.0.6`, migrated 2026-07-03 — CLAUDE.md still says v6). No CI bundle-size gate; `pnpm audit --audit-level=high` is a CI gate (relevant below).

**Workers limits (2026, official docs):**

| Limit | Free | Paid |
|---|---|---|
| Worker script size (gzipped) | 3 MB | 10 MB |
| CPU time / request | **10 ms** | 30 s (configurable to 5 min) |
| Memory | 128 MB | 128 MB |

A few-thousand-cell timetable is a few hundred KB of XML + one deflate pass — trivially fine on paid, **borderline on the free plan's 10 ms CPU cap**. That cap is the single real server-side risk. `infrastructure.md:52,82` already flags Worker bundle size as a watched risk (7 MB yellow line) and names client-side islands as the mitigation; `infrastructure.md:50` requires vetting every new dep for workerd compatibility.

**Library comparison:**

| Library | Gzip size | Workers/browser compat | Styling (merges/colors/borders) | Maintenance |
|---|---|---|---|---|
| **write-excel-file** 4.x | **~19 KB** | Clean — `universal` entry uses only `Blob` + `fflate`; browser entry offloads to a Web Worker | Yes: `rowSpan`/`columnSpan`, backgrounds, per-side borders, fonts, column widths, frozen headers | Active; sole dep `fflate` |
| exceljs 4.4.0 | ~256 KB | Needs Node streams/Buffer (polyfilled, but `node:*` leak risk in the adapter bundle) | Full | Effectively unmaintained (last release 2023) |
| SheetJS `xlsx` CE | ~140 KB | Yes (pure JS) | **None in CE** (styling is paid Pro); npm stale at 0.18.5 with a flagged CVE → would trip `pnpm audit` CI gate; current versions only via cdn.sheetjs.com tarball | Active but npm-hostile distribution |
| xlsx-js-style | ~317 KB | Yes | Basic (bolted onto stale SheetJS 0.18.5 core) | Fork, ~2 years stale |

**Recommendation from the research:** `write-excel-file` — the only option simultaneously maintained, tiny, styling-capable enough for a timetable grid, and runtime-agnostic (same code path client-side and, if ever needed, on workerd). exceljs and SheetJS CE both conflict with this repo's constraints (audit gate, dep-vetting rule, bundle discipline).

**Client-side vs server-side:**
- **Client-side (recommended):** bypasses *all* Workers limits (plan-independent); data already hydrated (including live edits); export becomes a pure `model/` transform — Vitest-testable, fitting the "pure domain logic in model/" convention; zero worker-bundle growth. Trade-off: not reusable for future emailed/scheduled exports; exports session state rather than server-authoritative state (arguably a feature for a planning tool).
- **Server-side (fallback):** viable via an auth-gated `/api/` route using `write-excel-file/universal`; requires paid-plan CPU headroom to be safe; heavy CJS deps would need adding to `ssrPrebundleDeps` (`astro.config.mjs:38-50`) for dev-SSR stability. Reach for it only when a non-interactive consumer appears.

**Bottom line on the user's second question:** no Cloudflare extension (R2, paid limits, config change) is needed for the client-side path. The server-side path would want confirmation of the paid plan (or a `limits` block) and possibly R2 only if exports ever need staging — none of which the MVP requires.

### 4. Product history — what "export" has meant so far

- Export was slice **S-10 / FR-015**, originally gated behind a variant "finalize" step; `multi-variant-management` (2026-06-11) removed the gate and re-scoped it to "**export any plan as master-grid CSV**" — then it was never built (`context/archive/2026-06-11-multi-variant-management/plan.md:44,47,95`).
- It remains **PRD Open Question #3** (`prd.md:480-483`): "CSV export in scope? … If in scope, it must represent the enriched model (co-teaching, bi-weekly week tags, both cohorts distinguishable)." Same conditional framing in `roadmap.md:203`.
- **Only printable/PDF export is a hard non-goal** (`prd.md:465`, `roadmap.md:217`).
- The legacy workflow being replaced is "algorithm output + manual Excel" (`prd.md:32`); the artifact to reproduce is the **final placed master-grid** (day × period cells per cohort), *not* the algorithm's grouping list (`data/out/*.csv` are inbound fixtures only, `prd.md:73-74`).
- **The xlsx format itself is new** — no prior doc mentions xlsx or any spreadsheet library. Choosing xlsx (with styling: colors, merges, frozen headers) over bare CSV is a real product decision this change implicitly makes; it also happens to *justify* itself, since CSV cannot represent the two-cohort/co-teaching/week-tag richness in one readable sheet.

## Code References

- `src/_pages/plan-detail/api/load.ts:44-142` — `loadCombinedPlannerData`, the one loader assembling a full two-cohort plan
- `src/_pages/plan-detail/model/use-cohort-board-state.ts:49-104` — live client-side board store (placements incl. unsaved edits)
- `src/_pages/plan-detail/ui/PlannerBoard.tsx:248-260` — `trailing` toolbar slot (Export button home)
- `src/_pages/plan-detail/ui/chrome/PlanSummaryBar.tsx:44-62` — board header composition
- `src/_pages/plan-detail/ui/chrome/BoardSettingsMenu.tsx:35-41` — gear popover (alternative Export home)
- `src/_pages/plans-list/ui/PlansHub.tsx:145-169` — per-plan row menu (secondary entry point)
- `src/entities/timetable/model/perspective.ts:19-27` — pure per-teacher/per-student narrowing (reusable for extra sheets)
- `src/entities/timetable/model/placement.ts:4-25` — `PlannerPlacement` core type
- `src/shared/lib/grid/grid.ts:27` — `parseGridPreset` (grid geometry)
- `src/shared/config/subject-colors.ts:39-42` — subject color enum → Tailwind classes (hex map missing)
- `src/shared/lib/course-label/course-label.ts:4` — course badge label formatter
- `src/shared/api/load-cohort-courses.ts:20,90-95` — catalog + courseDisplay assembly
- `src/middleware.ts:7-21` — deny-by-default auth; line 18 anticipates a future export route
- `src/pages/api/auth/signin.ts:4-20` — the only existing API-route convention
- `wrangler.jsonc:5-11` — compat date, `nodejs_compat`, ASSETS-only bindings
- `astro.config.mjs:31-58` — `ssrPrebundleDeps` plugin + `output: "server"` (Astro 7)
- `supabase/migrations/20260611180006_plans_as_domain_root.sql:28,91-103` — cohort enum, placements keying

## Architecture Insights

- **The exporter is a pure transform.** Everything needed exists as data + pure helpers; the cleanest shape is a framework-free export model (grid assembly from placements + display resolution) in `model/`, fed either by the live board store (client path) or by re-composed loaders (server path). This fits the FSD layering and the "declarative pipelines" lesson.
- **Client-side generation is the documented escape hatch** for Workers constraints (`infrastructure.md:52`), and this feature is its poster child: the data is already in the browser, and the only consumer is the interactive author.
- **API routes are the sanctioned transport for file downloads** per the Actions lesson — so *if* a server path is ever added, it's a `src/pages/api/` route (auth-gated by default), not an Action.
- **Dep discipline matters here**: the `pnpm audit` CI gate (SheetJS CVE), the workerd dep-vetting rule, and the bundle-size yellow line all actively discriminate between xlsx libraries — `write-excel-file` is the only candidate that clears all three.
- Per-teacher/per-student sheets come nearly free: the perspective predicates (`perspective.ts`) already derive per-person timetables from the same placements by pure filtering — a multi-sheet workbook (master grid + per-teacher tabs) is composition, not new logic.

## Historical Context (from prior changes)

- `context/archive/2026-06-11-multi-variant-management/plan.md:44,47,95` — export re-scoped to "export any plan as master-grid CSV", finalize-gate dropped (FR-014 overturned), implementation deferred
- `context/archive/2026-06-07-app-shell/research.md:79,95` — export's place in the IA: "Master-grid CSV … both cohorts in output"; end of author journey A
- `context/foundation/prd.md:72-74,178-181,380-381,465,480-483` — CSV export unimplemented; Open Question #3; master-grid content requirements; PDF/print non-goal
- `context/foundation/roadmap.md:203,217` — export as a conditional new slice; print/PDF parked
- `context/foundation/infrastructure.md:50,52,58,81-82` — workerd dep-vetting rule, bundle-size limits + 7 MB yellow line, client-side-island mitigation, new-dep branch-preview process

## Related Research

- `context/archive/2026-06-07-app-shell/research.md` — IA placement of the Export action
- `context/archive/2026-06-30-sticky-days-periods-names/research.md` — board-as-frozen-header-spreadsheet UI model (day/period labels are fixed constants, no custom names to export)

## Open Questions

1. ~~**Format decision (resolves PRD Open Q #3):** confirm xlsx (styled workbook) supersedes the historical "master-grid CSV" requirement.~~ **Resolved 2026-07-07 (author):** XLSX over CSV, for rich and better-structured content — a styled workbook can represent the enriched model (two cohorts, co-teaching, bi-weekly tags) in one readable artifact where CSV cannot. No CSV variant ships. Recorded in `change.md`; `prd.md` Open Q #3 to be updated when the change lands.
2. ~~**Workbook scope:** master grid only, or also per-teacher / per-student sheets?~~ **Resolved 2026-07-07 (author):** the export mirrors the board's focus modes — the user picks which view to export (**combined**, **dp1**, or **dp2**, same surfaces as `CohortSwitcher` / `?focus=`), and the file is prepared for that view. Sensible default: the currently active focus. Per-teacher/per-student sheets are out of scope for this change. **Parked/shelf bundles resolved 2026-07-07 (author): omitted** — the export covers the placed board grid only.
3. ~~**Source of truth:** live in-session board state or persisted DB state?~~ **Resolved 2026-07-07 (author): live board state** — the export captures what the user sees, including unsaved in-session edits. This commits the implementation to client-side generation in the board island (from `useCombinedBoardState`), consistent with the recommendation.
4. ~~**Styling fidelity:** how much of the board look must the sheet reproduce?~~ **Resolved 2026-07-07 (author) as a principle:** the file mirrors the rendered view as closely as is reasonable. Layout is pinned: period rows × day columns, matching `PlannerGrid` (`src/_pages/plan-detail/ui/grid/PlannerGrid.tsx:79-96`) — in combined, each day header spans two cohort sub-columns (DP1 | DP2) with a cohort sub-label row (xlsx merged header cells via `columnSpan`); focus exports are the single-sub-column variant. Individual styling details (subject colors — needs the hue→hex map, week a/b tags, optional markers, break bands after P2/P5, period times) follow the same principle: include where the xlsx medium supports it reasonably; the plan enumerates the exact list.
5. ~~**Cloudflare plan:** only relevant if the server path is chosen.~~ **Resolved 2026-07-07 (author): paid plan.** The MVP is client-side anyway (Q3), but the paid tier (30 s CPU, 10 MB script limit) makes a future server-side path realistic without infra changes.
6. **Future direction (recorded 2026-07-07, not in MVP scope):** a possible **batch export** — one xlsx per student / per teacher — may later run server-side. Design constraint on this change: the grid→workbook assembly must be a pure, runtime-agnostic transform (framework-free, no browser APIs), so it can be imported from both the board island and a future Worker route; `write-excel-file/universal` runs on workerd. Module placement should anticipate cross-slice reuse (`entities/timetable` or `shared/lib` over `_pages/plan-detail/model/` — plan decides per FSD rules). The per-person narrowing for batch already exists as pure predicates (`perspective.ts`).
6. **Doc drift (side finding):** CLAUDE.md still says "Astro 6" while `package.json` is on `astro ^7.0.6` (migrated 2026-07-03) — worth a one-line fix per the "convention cites a mechanism" lesson.
