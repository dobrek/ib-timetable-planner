---
date: 2026-07-09T15:15:01+0200
researcher: Claude (Opus 4.8)
git_commit: e1ffe91879556f90b171a949a4c3f55786c9c8d0
branch: main
repository: dobrek/ib-timetable-planner
topic: "Feasibility of making meaningful pages printable — hide/replace interactive chrome"
tags: [research, codebase, print, css, perspective-views, timetable, export]
status: complete
last_updated: 2026-07-09
last_updated_by: Claude (Opus 4.8)
---

# Research: Feasibility of Printable Pages

**Date**: 2026-07-09T15:15:01+0200
**Researcher**: Claude (Opus 4.8)
**Git Commit**: e1ffe91879556f90b171a949a4c3f55786c9c8d0
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

Check the feasibility of making all our meaningful pages printable, such that all
non-relevant elements (navigation, popups, interactive buttons …) are hidden or replaced
with a meaningful print version where that makes sense.

**Scope agreed for this study** (via clarifying questions): prioritise the read-only
**schedule views** — the per-student schedule, the per-teacher schedule, and the two-cohort
planner board/timetable. Evaluate all approaches (CSS chrome-hiding, dedicated print
layout/route, bespoke print representations) and **recommend a strategy per page**.

## Summary

**Feasible, low-risk, and largely pre-designed — for the single-person schedule pages this
is nearly free; for the two-cohort board it needs one new static component.**

Three findings dominate:

1. **The student & teacher perspective views were architected to be printable from day one.**
   They are static, fully SSR-rendered, always-in-DOM React islands whose source is littered
   with explicit "print-viable" design comments, and the `teacher-plan-view` change recorded
   **binding "print-viability" design rules** (static grid, no zoom/sticky/overflow, semantic
   tokens, full SSR at a stable URL) precisely to keep a future print path open. Printing them
   is essentially a **CSS-only** job.

2. **Zero print infrastructure exists today** — no `@media print`, no `@page`, no
   `window.print()`, no `print-color-adjust`, no PDF dependency anywhere in `src/`. This is
   greenfield, but on a substrate deliberately kept print-ready. Tailwind v4.3.0 ships the
   `print:` variant out of the box.

3. **Print/PDF is an explicit PRD Non-Goal**, and XLSX export is the project's *sanctioned*
   shareable artifact. So this change carries a **product decision**: it must own a PRD
   Non-Goal amendment. The `teacher-plan-view` research already flagged that the print change
   would need exactly this.

**Recommended overall approach: browser-native print** — a global `@media print` stylesheet +
a small "Print" button calling `window.print()`. Not a PDF-generation library. The browser's
"Save as PDF" *is* the PDF export (zero bundle, zero server, workerd-trivial). Cloudflare
Browser Rendering is the right tool *later* for batch PDF ("all 40 teachers in one file"),
overkill now.

**The single biggest technical gotcha is not chrome-hiding — it's layout clipping.** The app
shell pins everything to `h-screen` with `overflow` scroll containers; unless those are reset
to `height:auto`/`overflow:visible` under `@media print`, only the first page prints.

> **Product decision (2026-07-09, resolved):** The team is OK overriding the PRD Non-Goal.
> The goal is to make the **application print-friendly via CSS** (`@media print` +
> `window.print()` / browser Save-as-PDF) — **not** to build a custom, dedicated print view or
> PDF-generation pipeline. This rules out the "bespoke static grid on a dedicated print route"
> option for the board; the board instead gets **best-effort CSS** on the live page. The plan
> owns the `prd.md`/`roadmap.md` Non-Goal amendment.

### Recommendation matrix (per page)

| Page | Route | Recommended strategy | New rendering? | Effort |
|---|---|---|---|---|
| **Student schedule** | `/plans/[id]/students/[studentId]` | CSS `@media print` + `window.print()`; hide chrome, force light tokens, `print-color-adjust:exact`, `@page A4 landscape` | None — already SSR-static | **S** |
| **Teacher schedule** | `/plans/[id]/teachers/[teacherId]` | Same as student, plus flatten interactive collision badges (keep shaded cell+chip) and hide the collision dialog | None | **S** |
| **Two-cohort board** | `/plans/[id]` | **Best-effort CSS on the live board** (per the product decision — no bespoke component/route): the print block hides toolbar/palette/shelf/drag chrome, resets zoom to 100%, un-sticks headers, and unclips `overflow-auto` so the real grid content flows onto paper. Accept it prints as the board cleaned-up-for-paper, not a redesigned artifact; the per-person perspective pages remain the high-fidelity print path. Width/pagination of dp1+dp2 × 5 days is the risk to validate. | None (CSS only) | **M** |
| _(bonus)_ catalog lists & dashboard | `/plans`, `/plans/[id]/{courses,teachers,students}`, `/dashboard` | Fall out **for free** once the global shell print block exists (they are already static tables in centered mode) | None | ~0 |

## Detailed Findings

### Area 1 — The read-only perspective views (student & teacher schedules)

Both pages are **pure SSR**: data is loaded in Astro server frontmatter and passed as a
serialized prop to a single `client:load` island — no client-side fetch. Because `client:load`
(not `client:only`) server-renders the full tree, **the complete grid + course list are in the
initial HTML** before any JS runs. The islands hydrate only to attach a switcher dropdown, the
xlsx export button, and (teacher) a collision modal — none of which the static print content
needs.

The components self-document the intent:
- `StudentPlanPage.tsx:16-23` — "a static print-viable single-cohort grid … The page is static
  after hydration." No `useState` at all.
- `TeacherPlanPage.tsx:36-43` — "a static print-viable grid"; the page's *only* `useState` is the
  collision-dialog `inspection` state (`TeacherPlanPage.tsx:46`).
- `ScheduleGrid.tsx:41` — "The static, print-viable perspective timetable: no zoom, no sticky
  headers, no drag, no `overflow-auto` ancestor dependency — all content always in the DOM."
- `PerspectiveCourseList.tsx:39` — rosters are **never** conditionally rendered because
  "collapsed-out-of-DOM content would break every future print path."

**Print-keep (static) vs print-hide (interactive), per page:**

- **Student** — keep: name `<h1>` + subtitle (`StudentPlanPage.tsx:55-59`), `<ScheduleGrid>`
  (`:78-83`), `<PerspectiveCourseList>` (`:85-90`). Hide: `<StudentSwitcher>` (`:61-66`),
  `<ExportStudentPlanButton>` + its `<Toaster>` (`:67-74`). No dialogs/filters on this page.
- **Teacher** — keep: title `<h1>` + subtitle (`TeacherPlanPage.tsx:112-116`), `<ScheduleGrid>`
  with static `unavailable` availability shading (`:144-153`), `<PerspectiveCourseList>` with
  co-teacher note + student roster (`:155-160`). Hide: `<TeacherSwitcher>` (`:118`),
  `<ExportTeacherPlanButton>` + `<Toaster>` (`:119-140`), `<CollisionDetailsDialog>` (`:162-173`),
  and **flatten** the interactive collision-badge `<button>`s in the grid
  (`ScheduleGrid.tsx:187-205`) — keep the shaded cell + chip beneath them, drop the button
  affordance.

Both wrap in `SidebarLayout` (centered mode), so they also inherit the shell chrome (Area 3).

### Area 2 — The two-cohort planner board (`/plans/[id]`)

This is the only genuinely hard target and the one place "hide the chrome" is insufficient.

- The route renders in **`fullWidth`** mode (`plans/[id]/index.astro:31`) and mounts one big
  island — `PlannerBoard` — with `client:load` (`PlanDetailPage.astro:29`). Everything on the
  board is interactive.
- The **only** component that lays out the side-by-side dp1|dp2 grid is the **editing** grid
  `PlannerGrid.tsx:88` (day headers span cohort sub-columns; sub-label row at `:116-154`), and
  it delegates every cell to the drag/drop `SlotCell`. Its zoom, sticky headers, and
  `overflow-auto` shell are **print-hostile** (confirmed by `teacher-plan-view/research.md:33`).
- The **static** `ScheduleGrid` renders only a *single* column-set. The teacher view fakes
  two-cohort by *merging* both cohorts into shared cells with per-chip cohort tags
  (`mergeCohortOccupants`, tag at `ScheduleGrid.tsx:183`) — that is a merged single grid, **not**
  a side-by-side board layout.

Three options were weighed:
- **(a) Best-effort CSS on the live board** — the print block hides the toolbar/palette/shelf/drag
  overlays and drag affordances, resets zoom to 100%, un-sticks the headers, and unclips the
  `overflow-auto` shell so the real placed-chip grid flows onto paper. No new component, no new
  route. Output is "the board cleaned up for paper," not a redesigned artifact — the interactive
  `SlotCell`s still render their placed chips; only the affordances are suppressed. Risk to
  validate: the dp1+dp2 × 5-day grid is wide, so landscape + scaling and pagination need a real
  print-preview check.
- **(b) Bespoke static grid + dedicated print route** (model `ScheduleGrid` on `PlannerGrid`'s
  two-column layout, no `client:load`) — technically cleanest, and no new *domain* logic (all
  inputs are pure `entities/timetable` fns). **But this is exactly the "custom dedicated view"
  the product decision rules out**, so it is not the chosen path.
- **(c) Defer board printing** — rely on per-person schedule prints + the existing xlsx board
  export, add board print later. Legitimate fallback if (a)'s width/pagination proves poor.

**Chosen (per product decision): option (a).** Make the live board print-friendly with CSS; keep
the high-fidelity board artifact as the existing xlsx export and the per-person perspective
prints. Reserve (c) as the fallback if the wide grid doesn't paginate acceptably.

### Area 3 — App-shell chrome + print-CSS/theming mechanics

**Chrome to hide** — almost all of it is one `<aside>`:

- The entire sidebar `<aside id="app-sidebar">` (`SidebarLayout.astro:54-123`) — logo, collapse
  toggle, primary nav, plan sub-nav, user email, theme toggle, sign-out form. Hiding this one
  element removes ~9 chrome items at once.
- The breadcrumb `<nav aria-label="Breadcrumb">` (centered mode only, `SidebarLayout.astro:134-140`).
- The config-missing `<Banner>` (`BaseLayout.astro:29-44`).

**The real work — layout clipping (biggest gotcha):** the shell pins content to one viewport and
uses scroll containers that clip print:
- `SidebarLayout.astro:53` — outer shell `flex h-screen` (100vh clamp).
- `SidebarLayout.astro:127` — `fullWidth` main `overflow-hidden` (hard clip; board only).
- `SidebarLayout.astro:131` — centered main `overflow-y-auto` (scroll container → prints only the
  visible slice).
- `BaseLayout.astro:50-55` — `html, body { height:100% }`.
- The print block **must** reset these to `height:auto` / `overflow:visible` / `display:block`,
  or only the first page prints. This matters more than hiding chrome.

**Tailwind v4 readiness — good.** `tailwindcss@^4.3.0`, CSS-first config (no `tailwind.config.*`,
no `@config`). The built-in `print:` variant (`print: → @media print`) works out of the box; do
**not** add a `@custom-variant print` (it already exists as a core media variant). Existing custom
variants are only `dark` and `collapsed` (`global.css:5-6`).

**Dark-mode + background-color print gotchas (second real hazard):**
- Dark mode is a `.dark` class on `<html>`, applied pre-paint (`BaseLayout.astro:20-26`), which
  redefines every semantic token to dark values (`global.css:67-122`). **Printing in dark mode
  would produce white-on-black.** Fix: re-declare the light token values inside `@media print` so
  print is ink-on-white regardless of `.dark`.
- Browsers **strip background colors** in print unless `print-color-adjust: exact`
  (`-webkit-print-color-adjust: exact`). Nothing sets this today (0 grep hits). Subject-color chips
  and shaded cells rely on backgrounds → they print blank without it.
- **Subject color tokens flip** between light/dark (`--subject-*` at `global.css:49-64` /
  `106-121`; chip classes `SUBJECT_CHIP_CLASS` at `subject-colors.ts:75-84`, applied e.g.
  `ScheduleGrid.tsx:168`). Force the *light* pair under print **and** set `print-color-adjust:
  exact`, or chips print as near-invisible boxes. (A hex mirror `SUBJECT_COLOR_HEX`,
  `subject-colors.ts:56-65`, already exists for the xlsx path — same intended print colors.)

**Where print CSS should live — global.** All chrome and clipping originate in the two shared
layouts, so a single top-level `@media print { … }` block in `global.css` (after `@layer base`,
i.e. after line 222) covers every route uniformly. Put structural resets + dark-neutralisation +
`print-color-adjust` there; use inline `print:hidden` for the 2–3 discrete elements you own
(aside `:54`, breadcrumb `:134`, Banner). Add `@page { size: A4 landscape; margin: 12mm }` (there
is no existing `@page` to conflict with; landscape suits a wide 5-day grid). Consider
`break-inside-avoid` on grid rows and course cards.

### Area 4 — The xlsx export precedent (reuse boundary)

The recently-shipped `student-export-plan-to-xlsx` (and its earlier teacher sibling) is a
**fully client-side** pipeline: `write-excel-file/browser` bound only in the two export buttons,
fed by pure, framework-free sheet builders in `entities/timetable/model/export/*`
(`buildTimetableSheet`, `buildPerspectiveWorkbook`).

**Reuse assessment for print:**
- **Reusable:** the *upstream* per-person data assembly — the same narrowed `placements`,
  `courseDisplay`, and `PerspectiveCourseItem[]` that feed the export **already feed the on-screen
  `<ScheduleGrid>` and `<PerspectiveCourseList>`**. So a print view needs *no new data pipeline* —
  the rendered DOM is already the artifact. Also reusable: the filename helpers `slugify`
  (`slugify.ts:7`, diacritic-folding) + `studentExportFileName` (`export-file-name.ts:11`) for
  naming a saved PDF.
- **Not reusable:** the sheet *output* model (`TimetableSheetCell` with spans / hex colors) targets
  spreadsheet cells, not HTML — a print path renders the React widgets, it does not consume
  `TimetableSheet`. The xlsx export is a **parallel precedent, not a foundation**.

## Code References

Board & perspective rendering:
- [`src/pages/plans/[id]/index.astro:31`](https://github.com/dobrek/ib-timetable-planner/blob/e1ffe91879556f90b171a949a4c3f55786c9c8d0/src/pages/plans/%5Bid%5D/index.astro#L31) — board route, `fullWidth`, mounts `PlannerBoard client:load`
- [`src/_pages/plan-detail/ui/grid/PlannerGrid.tsx:88`](https://github.com/dobrek/ib-timetable-planner/blob/e1ffe91879556f90b171a949a4c3f55786c9c8d0/src/_pages/plan-detail/ui/grid/PlannerGrid.tsx#L88) — only side-by-side two-cohort layout; print-hostile (zoom/sticky/overflow)
- [`src/widgets/timetable-board/ui/ScheduleGrid.tsx:41`](https://github.com/dobrek/ib-timetable-planner/blob/e1ffe91879556f90b171a949a4c3f55786c9c8d0/src/widgets/timetable-board/ui/ScheduleGrid.tsx#L41) — the static, "print-viable" single-column grid; collision badges at `:187-205`; chip bg at `:168`
- [`src/widgets/timetable-board/ui/PerspectiveCourseList.tsx:39`](https://github.com/dobrek/ib-timetable-planner/blob/e1ffe91879556f90b171a949a4c3f55786c9c8d0/src/widgets/timetable-board/ui/PerspectiveCourseList.tsx#L39) — rosters always in DOM to preserve print paths
- [`src/_pages/student-plan-view/ui/StudentPlanPage.tsx:16`](https://github.com/dobrek/ib-timetable-planner/blob/e1ffe91879556f90b171a949a4c3f55786c9c8d0/src/_pages/student-plan-view/ui/StudentPlanPage.tsx#L16) — static-after-hydration; chrome to hide at `:61-74`
- [`src/_pages/teacher-plan-view/ui/TeacherPlanPage.tsx:36`](https://github.com/dobrek/ib-timetable-planner/blob/e1ffe91879556f90b171a949a4c3f55786c9c8d0/src/_pages/teacher-plan-view/ui/TeacherPlanPage.tsx#L36) — static grid; collision dialog `useState` at `:46`, chrome `:118-173`

App shell & theming (the print CSS surface):
- [`src/app/layouts/SidebarLayout.astro:53`](https://github.com/dobrek/ib-timetable-planner/blob/e1ffe91879556f90b171a949a4c3f55786c9c8d0/src/app/layouts/SidebarLayout.astro#L53) — `flex h-screen` clamp; aside `:54`; fullWidth main `overflow-hidden` `:127`; centered main `overflow-y-auto` `:131`; breadcrumb `:134`
- [`src/app/layouts/BaseLayout.astro:20`](https://github.com/dobrek/ib-timetable-planner/blob/e1ffe91879556f90b171a949a4c3f55786c9c8d0/src/app/layouts/BaseLayout.astro#L20) — pre-paint dark-mode script; Banner `:29-44`; `html,body height:100%` `:50-55`
- [`src/app/styles/global.css:5`](https://github.com/dobrek/ib-timetable-planner/blob/e1ffe91879556f90b171a949a4c3f55786c9c8d0/src/app/styles/global.css#L5) — `@custom-variant dark/collapsed`; `.dark` tokens `:67-122`; subject tokens `:49-64`/`:106-121`; `@utility` `:185-200`; `@layer base` body bg `:206-208`
- [`src/shared/config/subject-colors.ts:42`](https://github.com/dobrek/ib-timetable-planner/blob/e1ffe91879556f90b171a949a4c3f55786c9c8d0/src/shared/config/subject-colors.ts#L42) — `subjectChipClass()`; chip class map `:75-84`; hex mirror `:56-65`

Export precedent (reuse boundary):
- [`src/_pages/student-plan-view/ui/ExportStudentPlanButton.tsx`](https://github.com/dobrek/ib-timetable-planner/blob/e1ffe91879556f90b171a949a4c3f55786c9c8d0/src/_pages/student-plan-view/ui/ExportStudentPlanButton.tsx) — sole `write-excel-file` binding; upstream data == the on-screen widgets' data
- [`src/_pages/student-plan-view/lib/export-file-name.ts:11`](https://github.com/dobrek/ib-timetable-planner/blob/e1ffe91879556f90b171a949a4c3f55786c9c8d0/src/_pages/student-plan-view/lib/export-file-name.ts#L11) + [`src/shared/lib/slugify/slugify.ts:7`](https://github.com/dobrek/ib-timetable-planner/blob/e1ffe91879556f90b171a949a4c3f55786c9c8d0/src/shared/lib/slugify/slugify.ts#L7) — reusable filename helpers for a saved PDF

## Architecture Insights

- **Print-viability was designed in, not bolted on.** The read-side split (`entities/timetable`
  pure core + `widgets/timetable-board` static grid) exists specifically so the same rendering
  can serve the editable board and the static, SSR, print-viable perspective views. This is the
  reason the single-person case is nearly free.
- **The clean seam is "static DOM already in the SSR response."** Because the perspective pages
  emit their full grid/list as server HTML and only hydrate for switcher/export/dialog, a print
  stylesheet operating on the already-present DOM is the lowest-effort, highest-fidelity path —
  no re-rendering, no second data pipeline.
- **The theme is 100% OKLCH + `color-mix` semantic tokens.** This is why raster PDF libraries
  (`jsPDF + html2canvas`) are a poor fit (documented in prior research) and why browser-native
  print (which understands the real CSS) is the right tool. It's also why dark-mode neutralisation
  and `print-color-adjust: exact` are mandatory, not optional.
- **Chrome is well-isolated.** Nearly all interactive chrome is a single `<aside>` in one shared
  layout, so a global print block is clean and non-duplicative.

## Historical Context (from prior changes)

- **`context/archive/2026-07-05-teacher-plan-view/research.md` §4 (lines 82–88) is effectively a
  pre-written print/PDF feasibility study.** It recommends **print CSS + `window.print()`** (effort
  S, high fidelity), notes Tailwind v4's `print:` + `break-inside-avoid` utilities, flags the
  missing `print-color-adjust: exact`, prescribes forcing light tokens under `@media print` and
  `@page { size: A4 landscape }`, and rejects `jsPDF+html2canvas` (OKLCH-incompatible),
  `@react-pdf/renderer` (duplicates layout, ~400–500 KB), and Cloudflare Browser Rendering
  (right tool later for batch export, overkill now). A printable-version change would largely
  *execute* this.
- **Binding "print-viability" design rules** were recorded as scope decision #2 in
  `context/archive/2026-07-05-teacher-plan-view/plan.md:55` and carried into
  `context/archive/2026-07-06-student-plan-view/plan.md:42,62` (a regression gate). Print CSS
  itself was explicitly **deferred** to "a follow-up change that also owns the PRD Non-Goal
  amendment" (`teacher-plan-view/plan.md:39`; `plan-brief.md:26`).
- **Print/PDF is a stable PRD Non-Goal**, with XLSX as the sanctioned substitute:
  `context/foundation/prd.md:468`, `context/foundation/roadmap.md:217`,
  `context/foundation/shape-notes.md:514`; reaffirmed in
  `context/archive/2026-07-08-student-export-plan-to-xlsx/research.md:171` ("Print/PDF remains a
  PRD non-goal — xlsx is the sanctioned medium."). **This change must consciously override that
  Non-Goal via a documented PRD amendment** — a product decision, not a technical one.
- **The read-side extraction rationale** (`entities/timetable` shared by board + perspective
  views) is in `teacher-plan-view/plan.md:5,10,14` and the UI half (static `widgets/timetable-board`
  grid) in `student-plan-view/research.md:92,104-117` — the print-friendly building blocks already
  exist.
- Minor gotcha: `context/archive/2026-06-29-breaks-between-periods/research.md:190` notes that if
  the board is printed, the `aria-hidden` period-break spacer rows should degrade gracefully.

## Related Research

- `context/archive/2026-07-05-teacher-plan-view/research.md` — §3 print-hostile board frame, §4
  print/PDF feasibility, §5 domain rules (closest existing analysis).
- `context/archive/2026-07-06-student-plan-view/research.md` — §2–3 read-side split; §6 route/nav
  inventory for the perspective routes.
- `context/archive/2026-07-07-export-to-xlsx/` and `2026-07-08-student-export-plan-to-xlsx/` —
  the xlsx export family (the sanctioned artifact / reuse boundary).
- `context/archive/2026-06-08-architecture-refactor/research.md:50-70` — full route table
  (predates the perspective routes).

## Open Questions

1. ~~**PRD Non-Goal amendment.**~~ **RESOLVED (2026-07-09):** the team is OK overriding the
   Non-Goal. Approach = browser-native print-friendliness via CSS, **not** a custom/dedicated PDF
   view. The plan owns the `prd.md`/`roadmap.md` amendment. (See `change.md` Notes.)
2. **Board width / pagination validation.** Best-effort CSS on the live board is the chosen path;
   the open risk is whether dp1+dp2 × 5 days paginates acceptably in landscape (with scaling), or
   whether we fall back to deferring the board (option c) and leaning on the xlsx export. Needs a
   real print-preview check during the plan/implement phase.
3. **Trigger UX.** A "Print" button (`window.print()`) per page, a global one, or rely on the
   browser's native Cmd/Ctrl-P? A button is the discoverable option and mirrors the existing
   export-button placement.
4. **Colour vs mono.** Force the light subject-colour chips with `print-color-adjust: exact`
   (colour printers / Save-as-PDF), or design a mono-safe fallback (patterns/labels) for
   black-and-white printers? Affects legibility of subject-coded chips on paper.
5. **Scope beyond schedules.** The catalog lists + dashboard print "for free" once the shell block
   exists — do we want them included, or keep the feature tightly scoped to schedules?
