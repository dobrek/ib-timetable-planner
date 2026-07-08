---
date: 2026-07-08T00:00:00+02:00
researcher: Claude (Opus 4.8)
git_commit: 2fc9aeac804fc8c5f2cb672544296f9a34fd7196
branch: main
repository: 10xdev3 (ib-timetable-planner)
topic: "Feasibility of exporting a teacher's plan view to XLSX (grid sheet + one sheet per course listing assigned students), client-side now, reusable server-side later"
tags: [research, codebase, export, xlsx, teacher-plan-view, entities-timetable, write-excel-file, fsd, workers]
status: complete
last_updated: 2026-07-08
last_updated_by: Claude (Opus 4.8)
---

# Research: Export teacher plan view to XLSX — feasibility

**Date**: 2026-07-08
**Researcher**: Claude (Opus 4.8)
**Git Commit**: `2fc9aeac804fc8c5f2cb672544296f9a34fd7196`
**Branch**: `main`
**Repository**: 10xdev3 (ib-timetable-planner)

## Research Question

Check the feasibility of a new feature: **export the teacher plan view to an `.xlsx` file**. The workbook holds the teacher's plan as one worksheet, plus a **dedicated worksheet per course** listing that course's assigned students. Client-side for now, but the transform must **not block later reuse** in a potential server-side batch operation (e.g. exporting plans for all teachers at once).

## Summary

**Highly feasible — this is ~80% assembly of parts that already exist, sitting exactly at the intersection of two shipped changes** (`2026-07-07-export-to-xlsx` and `2026-07-05-teacher-plan-view`). No new data loading, no schema work, no new dependency, no Cloudflare change. The genuinely new code is small and well-bounded.

Six findings shape the design:

1. **All data is already hydrated in the teacher-view island.** `TeacherPlanViewData` (`src/_pages/teacher-plan-view/api/loader.ts:38-52`) carries everything an export needs — both cohorts' placements/catalog/courseDisplay/studentNames, `teacherNames`, `merges`, grid dims, teacher identity — as plain serializable Records/arrays. The export handler is a pure client-side transform over props, exactly like the board's `ExportMenu.exportView`.

2. **The per-course student rosters are already computed.** `buildPerspectiveCourseItems` (`src/entities/timetable/model/perspective-course-list.ts:35`) returns one `PerspectiveCourseItem` per real course the teacher conducts — each with `studentKeys`, `teacherKeys`, `hours`, occurrences, and **merge-composite resolution to child courses with their own rosters** (`:67-81`). This is precisely the "list of assigned students per course" the feature needs; the page already renders it (`TeacherPlanPage.tsx:57-91`).

3. **The pure XLSX transform layer already exists and is runtime-agnostic.** `src/entities/timetable/model/export/` holds `buildTimetableSheet`, `buildRosterSheet`, and `sheet-types.ts` — framework-free, **no `write-excel-file` import**, library-shaped output declared locally (`sheet-types.ts:4-8` explicitly anticipates "the future server-side batch-export path, a Worker route"). All three are on the entity's public API (`src/entities/timetable/index.ts:19-21`). `SUBJECT_COLOR_HEX` (`src/shared/config/subject-colors.ts:56`) gives xlsx cell fills. **These are directly reusable.**

4. **The glue is trapped in the wrong slice.** `buildExportWorkbook` / `exportFileName` / `ExportMenu` live in `_pages/plan-detail/lib` + `ui` and are **cohort-shaped** (`dp1`/`dp2`, `BoardSurface`). FSD forbids `_pages/teacher-plan-view` from importing another page slice, and `write-excel-file/browser` is not workerd-safe. So the teacher export needs its **own** thin workbook assembler + filename helper + button — but the reusable seam it stands on is the entity transforms + `SUBJECT_COLOR_HEX`, not the plan-detail glue.

5. **"One sheet per course" introduces one real new constraint: worksheet-name sanitization.** `write-excel-file@4.1.1` **validates but does not sanitize** sheet names — it *throws* on empty / >31 chars / illegal `[ ] / \ : * ?`, and does **not** check uniqueness at all, while Excel requires it (colliding names silently corrupt the workbook). Course display names can be long, contain `:`/`/`, and collide across cohorts. The new per-course-sheet transform **must** strip illegal chars, truncate to 31, and de-duplicate names. This is the single highest-risk implementation detail.

6. **The server-side batch path is genuinely unblocked.** `write-excel-file/universal` (`.toBlob()`) is the workerd-safe entry; the middleware already auto-gates a future `.xlsx`/`/api/export` route (`src/middleware.ts:18`); `nodejs_compat` is on; the signin API route is the pattern to copy. Keeping the workbook transform library-free in `entities/timetable` (binding `write-excel-file` only at the leaf call sites) satisfies the "don't block reuse" requirement by construction.

**Bottom line:** feasible with confidence. Effort is small-to-medium. The two design forks to settle before planning are (a) the **teacher-grid sheet shape** (reuse cohort-column `buildTimetableSheet` with a single merged column vs. a thin teacher-grid variant), and (b) **per-course sheet naming + richness**. A notable architectural opportunity: build the transform **persona-agnostic** (teacher *or* student) so the sibling `student-plan-view` gets export nearly for free.

## Detailed Findings

### 1. The teacher plan view — data, structure, and where an Export button lands

The teacher view shipped in `2026-07-05-teacher-plan-view` and has since been refactored to render through **shared widgets** (the `student-plan-view` sibling forced promotion to `widgets/`). Note: the paths named in that change's *plan* (`ui/TeacherScheduleGrid.tsx`, `ui/TeacherCourseList.tsx`, `model/teacher-perspective.ts`) **no longer exist under those names** — the current reality is:

- Slice files: `src/_pages/teacher-plan-view/{api/loader.ts, ui/TeacherPlanPage.tsx, ui/TeacherSwitcher.tsx}` (verified `ls`); the grid + course list are the shared `src/widgets/timetable-board/ui/{ScheduleGrid.tsx, PerspectiveCourseList.tsx}`.
- Narrowing predicates: `src/entities/timetable/model/perspective.ts` (not `teacher-perspective.ts`).

**Island data shape** — `TeacherPlanViewData` (`src/_pages/teacher-plan-view/api/loader.ts:38-52`), all plain serializable (no Maps — `loader.ts:59-60`):

```ts
type TeacherViewCohortData = {          // loader.ts:30-36
  courses: GroupingCourse[];            // FULL cohort catalog (collision derivation needs all)
  courseDisplay: Record<string, CourseDisplay>;
  placements: PlannerPlacement[];
  studentNames: Record<string, string>;
};
type TeacherPlanViewData = {            // loader.ts:38-52
  planId; planName; days; periods;
  teacher: TeacherSummary;             // { id, code, fullName|null }
  teachers: TeacherSummary[];          // for the switcher
  availability: BoardAvailabilityCell[];
  teacherNames: Record<string, string>;
  courseInfo: Record<string, CourseInfo>;   // per-course level/groupIndex/cohort/hoursPerWeek
  merges: CourseMerge[];               // { parentId, childId }
  dp1: TeacherViewCohortData;
  dp2: TeacherViewCohortData;
};
```

`GroupingCourse` (`src/shared/lib/catalog-hash/types.ts:18-25`) carries `teacherKeys`, `studentKeys`, `hours`, `weekMode` per course — everything a per-course roster needs. `studentKeys` already folds overlap/merge unions (computed upstream in `loadCohortCourses`).

**Header slot for the button** — `TeacherPlanPage.tsx:102-108` is a `justify-between` flex row with the title block on the left and `<TeacherSwitcher>` on the right. An Export affordance goes naturally beside the switcher (wrap both in `flex items-center gap-2`), mirroring how the board toolbar hosts `ExportMenu` (`PlannerBoard.tsx:276-284`). The island is `client:load` with all data in props, so the handler is fully client-side.

**The teacher grid merges BOTH cohorts onto one grid** (`TeacherPlanPage.tsx:49-54, 181-190`): `dp1`/`dp2` cohort views are derived independently, then occupants merged into one `Map<cellKey, GridOccupant[]>` with each chip tagged `{...occupant, cohort}`, fed to a single `<ScheduleGrid>`. This is the crux for the export grid shape — see §4.

### 2. Per-course rosters are already assembled (persona-agnostic)

`buildPerspectiveCourseItems` (`src/entities/timetable/model/perspective-course-list.ts:35-91`) is the shared engine behind both the teacher and student course lists. Its only persona input is a `memberOf` predicate (`:41`) — teacher-set membership for the teacher view (`teacherCourses`), student-set membership for the student view. Each `PerspectiveCourseItem` (`:13-25`):

- `courseId`, `cohort`, `occurrences: PlannerPlacement[]` (day→period sorted; merge child inherits parent's block, `:75`)
- `hours: { placed, required } | null` (from `deriveHours`)
- `teacherKeys: string[]`, `studentKeys: string[]`
- `mergedIntoId?` — set on resolved merge children

The page resolves names at render (`TeacherPlanPage.tsx:80-91`): roster = `item.studentKeys.map(k => studentNames[k] ?? k).sort(localeCompare)`; co-teachers = `item.teacherKeys.filter(k => k !== teacher.id).map(k => teacherNames[k] ?? k)`. **This is exactly the per-course "assigned students" content the new sheets need — already computed, merge-resolved, name-resolvable.** The export transform can take `PerspectiveCourseItem[]` + the name maps directly.

Because the model is persona-agnostic, a per-course-sheet transform built on `PerspectiveCourseItem[]` serves the **student view** identically — a strong reuse argument for building it once (see Architecture Insights).

### 3. The shipped XLSX export — what is reusable vs. trapped

Shipped in `2026-07-07-export-to-xlsx`. Layer map:

| Module | Layer | Reusable for a teacher/Worker export? |
|---|---|---|
| `entities/timetable/model/export/sheet-types.ts` | entities | **Yes** — zero deps; library-shaped types declared locally (`:4-8`) |
| `entities/timetable/model/export/timetable-sheet.ts` (`buildTimetableSheet`) | entities | **Yes**, but **cohort-column-oriented** — see §4 |
| `entities/timetable/model/export/roster-sheet.ts` (`buildRosterSheet`) | entities | Partially — emits ONE "all subjects" sheet (rows), wrong granularity for one-sheet-per-course |
| `shared/config/subject-colors.ts` (`SUBJECT_COLOR_HEX`) | shared | **Yes** — importable anywhere |
| `_pages/plan-detail/lib/export-workbook.ts` (`buildExportWorkbook`) | _pages/plan-detail | **No** — page-slice-trapped + cohort-shaped (`dp1`/`dp2`, `BoardSurface`) |
| `_pages/plan-detail/lib/export-file-name.ts` (`exportFileName`) | _pages/plan-detail | **No** — page-slice-trapped + `BoardSurface`-shaped |
| `_pages/plan-detail/ui/chrome/ExportMenu.tsx` | _pages/plan-detail | **No** — plan-detail UI, binds `write-excel-file/browser` |

**Reusable output types** (`sheet-types.ts:29-69`): `TimetableSheetCell` (a rich cell union — `value`, `fontWeight`, `align`, `wrap`, `backgroundColor`, `fillPatternStyle`, `textColor`, `columnSpan`/`rowSpan`, `height`, per-side borders — or `null` for span placeholders) and `TimetableSheet = { rows, columns: {width}[], stickyRowsCount, stickyColumnsCount }`. Both transforms emit this shape; the call site renames `rows`→`data` to produce `write-excel-file` sheet descriptors.

**The library binding is a single leaf** (`ExportMenu.tsx:2,33-34`): `import writeXlsxFile from "write-excel-file/browser"` then `await writeXlsxFile(sheets).toFile(fileName)`, `sonner` toast on failure. `sheets` is the descriptor array passed positionally; per-sheet name/sticky/columns live inside each element.

**Dependency:** `write-excel-file@^4.1.1` already installed (`package.json:53`); `fflate` present transitively. No new dependency for the client path.

### 4. The teacher-grid sheet shape — the main design fork

`buildTimetableSheet` (`timetable-sheet.ts:36`) takes `columns: TimetableSheetColumn[]` where **each column is a cohort** (`{ cohort, placements, courseDisplay }`, `:13-17`): combined = 2 side-by-side cohort columns per day, focus = 1. It stacks multiple occupants per cell as sub-rows (`:117-133`), applies subject fills, break bands, weighted borders, frozen panes — all reusable machinery.

A **teacher grid is a different shape**: one person, courses from both cohorts co-located in the same day×period cell (as the on-screen grid does). Two paths:

- **Reuse path (cheapest):** call `buildTimetableSheet` with a **single** `TimetableSheetColumn` whose `placements` = the teacher's dp1+dp2 placements unioned (`perspectivePlacements(cohort.placements, new Set(teacherCourses(cohort.courses, teacherId).map(c=>c.id)))` per cohort, concatenated) and `courseDisplay` = the merged map. `groupCellOccupants` stacks both cohorts' courses as sub-rows exactly like the screen. **Caveat:** the sheet's `occupantLabel` (`:212-217`) emits name + week + optional but **no cohort suffix**, so a dp1 vs dp2 course in the same cell is visually indistinguishable in the file.
- **Thin-variant path:** add an optional cohort-label parameter to `buildTimetableSheet` (or a small `buildTeacherGridSheet`) so occupant labels can carry a `(DP1)`/`(DP2)` tag. Modest work — `sheet-types.ts` and all border/fill/break machinery are reused.

Recommendation to settle in planning: the reuse path is fine if a teacher rarely has a dp1 and dp2 course in the identical slot (they usually don't; simultaneous is a conflict). If cohort disambiguation in-cell is required, prefer the thin generalization over a fork.

### 5. `write-excel-file` multi-sheet API + the sheet-name constraint (verified against installed source)

**Multi-sheet call** (README `node_modules/write-excel-file/README.md:536-555`; types `browser/index.d.ts:40-43`, `types/SheetOptions.d.ts:7-19`): pass an array of `{ data, sheet, columns, stickyRowsCount, stickyColumnsCount }`; `.toFile(name)` (browser) or `.toBlob()` (universal). The repo's `WorkbookSheet` (`export-workbook.ts:34-40`) already mirrors this.

**Sheet-name rules — the caller's responsibility** (`node_modules/write-excel-file/modules/xlsx/validateSheetName.js`, invoked per sheet):
- empty → throws; >31 chars → throws; contains any of `[ ] / \ : * ?` → throws (regex `/[\[\]\/\\:*?]+/`).
- **uniqueness is NOT validated by the library** (grepped: no dedupe logic) — but Excel requires it; duplicates yield a silently corrupt workbook.

So the per-course-sheet transform must, before naming sheets: **strip the six illegal chars, truncate to ≤31, and de-duplicate** (e.g. suffix `~2` within the 31-char budget). The grid sheet needs a fixed safe name (`"Timetable"`). Course *codes*/badge labels may make cleaner, shorter, collision-resistant tab names than display names — a naming decision for planning.

**Entry points** (`node_modules/write-excel-file/package.json` exports): `/browser` (client; uses Web Workers → **not** workerd-safe), `/universal` (`.toBlob()`; **workerd-safe** — the server reuse entry), `/node` (avoid on workerd).

### 6. Server-side batch reuse — unblocked, and how to keep it that way

- **FSD placement:** put the reusable assembler (e.g. `build-teacher-workbook.ts`, or persona-agnostic `build-perspective-workbook.ts`) in `src/entities/timetable/model/export/` and barrel it through `src/entities/timetable/index.ts`. It composes the existing pure builders and returns library-free `TimetableSheet` descriptors. Both consumers can already import the entity (verified: `teacher-plan-view` and `student-plan-view` slices and the plan-detail board all import `@/entities/timetable` today; `src/pages/api/*` routes sit above all FSD layers and import downward freely — precedent `src/pages/api/auth/signin.ts:2`). **Do not** reuse `_pages/plan-detail/lib/export-workbook.ts` — page-slice-local, unreachable, and cohort-shaped.
- **Binding stays at the leaves:** the island imports `write-excel-file/browser` and calls `.toFile()`; a future Worker route imports `write-excel-file/universal` and returns `.toBlob()` in a `Response` (`Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`). `entities` never imports the library.
- **Auth/routing:** `src/middleware.ts` is deny-by-default and its line 18 comment explicitly keeps future extension-bearing routes like `/api/export.csv` auth-gated; `.xlsx` is excluded from the static-asset regex, so a server export route is protected with zero allowlist change. `wrangler.jsonc:6` has `nodejs_compat`; no R2/KV bindings (a true "all teachers" batch might later want R2/a queue for staging + large payloads, but a single-teacher synchronous route needs none).
- **Dev-SSR only:** if a `src/pages/api/*` export route is dev-SSR'd, add `"write-excel-file/universal"` to `ssrPrebundleDeps` in `astro.config.mjs:39-50` (one-line dev-stability change; the client island doesn't need it).

## Code References

- `src/_pages/teacher-plan-view/api/loader.ts:24-52` — `TeacherPlanViewData` / `TeacherViewCohortData` (all export inputs, serializable)
- `src/_pages/teacher-plan-view/ui/TeacherPlanPage.tsx:49-54,102-108,181-190` — cohort-merge for the grid; header slot beside `TeacherSwitcher`
- `src/entities/timetable/model/perspective-course-list.ts:13-91` — `PerspectiveCourseItem` + `buildPerspectiveCourseItems` (per-course rosters, merge resolution, persona-agnostic)
- `src/entities/timetable/model/perspective.ts:19-64` — `teacherCourses`, `perspectivePlacements`, `narrowViolationsToTeacher`, `teacherUnavailableCells`
- `src/entities/timetable/model/export/sheet-types.ts:4-8,29-69` — library-free cell/sheet types (runtime-agnostic by design)
- `src/entities/timetable/model/export/timetable-sheet.ts:13-24,36` — `buildTimetableSheet` (cohort-column oriented)
- `src/entities/timetable/model/export/roster-sheet.ts:5-19` — `buildRosterSheet` (all-subjects flat sheet; wrong granularity for per-course)
- `src/entities/timetable/index.ts:19-21,17-18` — export transforms + perspective on the public API
- `src/entities/timetable/lib/period-times.ts:13` — `periodTimeRange` (P1–P10, else null) for occurrence times
- `src/shared/config/subject-colors.ts:56` — `SUBJECT_COLOR_HEX` for xlsx fills
- `src/_pages/plan-detail/lib/export-workbook.ts:15-40,50,75` — cohort-shaped glue (reference pattern, NOT reusable)
- `src/_pages/plan-detail/ui/chrome/ExportMenu.tsx:2,31-38` — the single `write-excel-file/browser` binding + toast pattern
- `src/middleware.ts:18` — deny-by-default; future export route stays auth-gated
- `wrangler.jsonc:5-6` — `compatibility_date`, `nodejs_compat`; no R2/KV
- `astro.config.mjs:39-50` — `ssrPrebundleDeps` (add `write-excel-file/universal` only if a route is dev-SSR'd)
- `package.json:53` — `write-excel-file@^4.1.1` (already installed)
- `node_modules/write-excel-file/modules/xlsx/validateSheetName.js` — the 31-char / illegal-char throw (no uniqueness check)

## Architecture Insights

- **The reusable seam is the entity, not the plan-detail glue.** Everything durable already lives in `entities/timetable` (transforms, types) + `shared/config` (hex). The plan-detail workbook assembler, filename helper, and menu are correctly *not* shared — they're cohort-shaped page UI. The teacher export re-stands on the entity and writes its own thin glue.
- **Build the workbook transform persona-agnostic.** The course list and grid are already shared across teacher *and* student views via `widgets/timetable-board` + `buildPerspectiveCourseItems` (persona = a `memberOf` predicate). Placing a `build-perspective-workbook` in `entities/timetable/model/export/` at the same altitude means the `student-plan-view` sibling gets "export my plan" for near-free — matching the established extraction pattern rather than duplicating a teacher-only path. Confirmed reuse (two views today) clears FSD's bar for shared placement.
- **"One sheet per course" is a new granularity, not a reuse of `buildRosterSheet`.** The existing roster sheet is one flat "all subjects" table (rows). The feature wants N sheets (one per course). That's a small new transform (`buildCourseStudentSheet(item, names) → TimetableSheet`), fed by `PerspectiveCourseItem`. The sheet-name sanitization/dedup logic belongs in the assembler that names them.
- **Runtime-agnosticism is already the codebase's stated design intent** (`sheet-types.ts:4-8`) — the "don't block server-side reuse" requirement is satisfied by keeping the transform library-free in `entities` and binding `write-excel-file` (`/browser` vs `/universal`) only at the leaf. This is the same discipline the shipped export already follows.
- **No performance concern.** Generation is a click-driven, one-teacher, few-hundred-cell operation client-side; the <200ms drag-drop budget (CLAUDE.md hard rule) is untouched. A teacher teaches ~2–6 courses, so ~3–7 sheets — trivial for `write-excel-file`.

## Historical Context (from prior changes)

- `context/archive/2026-07-07-export-to-xlsx/{plan.md,research.md,change.md}` — built the xlsx machinery; **Open Question #6 recorded the exact design constraint this change honors**: "the grid→workbook assembly must be a pure, runtime-agnostic transform … importable from both the board island and a future Worker route; `write-excel-file/universal` runs on workerd." Also: per-teacher/per-student sheets and batch export were explicitly deferred there (`plan.md` "What We're NOT Doing") — this change picks up the per-teacher thread.
- `context/archive/2026-07-05-teacher-plan-view/{plan.md,research.md}` — built the teacher view + extracted `entities/timetable`; scope decision #2 mandated the page stay "print-viable" and SSR-render at a stable URL, keeping a future Cloudflare Browser Rendering batch-PDF path open (a parallel/alternative export medium to xlsx worth noting). NB: that plan's file paths (`TeacherScheduleGrid.tsx`, `teacher-perspective.ts`) predate the widget promotion — verify current names (per lessons.md doc-coupling rule; §1 above).
- `context/foundation/prd.md` Open Question #3 was resolved by the xlsx change (XLSX supersedes the historical "master-grid CSV"); a per-teacher workbook is a natural extension of that resolution, not a new product question. Print/PDF remains a hard PRD non-goal — xlsx is the sanctioned export medium.
- `context/foundation/lessons.md` — relevant priors: "Prefer declarative pipelines over imperative accumulator loops" (the sanitize/dedup + assembler code), "A convention that cites a code mechanism is coupled to it — verify the symbol" (the stale teacher-view paths above), "Green build/test/lint ≠ type-safe — `pnpm check` is the mandatory type gate."

## Related Research

- `context/archive/2026-07-07-export-to-xlsx/research.md` — library comparison (why `write-excel-file`), Cloudflare limits, client-vs-server analysis
- `context/archive/2026-07-05-teacher-plan-view/research.md` — teacher-perspective data chain, print-viability design rules, Cloudflare Browser Rendering as a batch-PDF option

## Open Questions

1. **Teacher-grid sheet shape (§4):** reuse `buildTimetableSheet` with a single merged column (cheapest; loses in-cell cohort disambiguation) vs. a thin cohort-tag generalization of the transform? Recommendation: reuse unless in-cell DP1/DP2 disambiguation is required, then generalize (don't fork).
2. **Per-course sheet naming:** tab name from course *display name* (sanitize + truncate 31 + dedup) or a shorter *code/badge label*? What dedup suffix scheme? (Illegal-char strip + 31-char truncate + uniqueness are mandatory regardless — §5.)
3. **Per-course sheet richness:** just the student roster (the literal ask), or also occurrence times / hours placed-required / co-teachers / cohort-level header per sheet? All inputs are already in `PerspectiveCourseItem`.
4. **Include the plan-detail-style "all subjects" roster sheet too, or only per-course sheets?** The ask says per-course; confirm the flat roster sheet is not also wanted.
5. **Persona-agnostic now, or teacher-only now?** Build `build-perspective-workbook` (serves teacher + student) vs a teacher-specific transform with student export deferred. Recommendation: persona-agnostic transform in `entities`, wire the teacher button now — the student button becomes a one-file follow-up.
6. **Availability shading / collision badges in the grid sheet?** The on-screen teacher grid shows both; the shipped board export renders "clean" (no collision styling). Confirm the file mirrors the clean board-export convention (recommended) rather than the annotated on-screen view.
7. **Filename convention:** `<plan-slug>-<teacher-code>.xlsx`? (mirror `exportFileName`'s slugging, add teacher code/name.)
8. **Entry-point affordance:** a single Export button (this teacher) beside `TeacherSwitcher`, matching the board's icon-button pattern — confirm no menu is needed (unlike the board's 3-view dropdown, a teacher view has one export target).
