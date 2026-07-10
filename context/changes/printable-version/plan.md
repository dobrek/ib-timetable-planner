# Printable Version Implementation Plan

## Overview

Make the application **print-friendly via browser-native print** — a global `@media print`
stylesheet plus a small per-page **Print** button calling `window.print()` — so a plan author can
"Save as PDF" or print any meaningful page on paper. No PDF-generation library, no bespoke print
views or routes: we clean up the *real* pages for paper. Three schedule surfaces are the priority
(student schedule, teacher schedule, two-cohort board); the catalog lists and dashboard fall out for
free once the shell print block exists. This change also **owns the PRD Non-Goal override** that
makes print-friendliness in scope.

## Current State Analysis

- **Zero print infrastructure exists** — no `@media print`, `@page`, `window.print()`,
  `print-color-adjust`, or PDF dependency anywhere in `src/` (confirmed by research + grep). This is
  greenfield on a substrate deliberately kept print-ready.
- **The perspective pages were architected to be printable.** `StudentPlanPage.tsx` and
  `TeacherPlanPage.tsx` are pure SSR islands — data loaded in Astro frontmatter, passed as a
  serialized prop to one `client:load` island whose full grid + course list are in the initial HTML.
  They hydrate only for a switcher, the xlsx export button, and (teacher) a collision dialog — none
  of which the static print content needs. `ScheduleGrid.tsx:41` self-documents as "static,
  print-viable … no zoom, no sticky headers, no drag."
- **The board is the one hard target.** The route renders `fullWidth`
  (`plans/[id]/index.astro:31`) and mounts `PlannerBoard` (`client:load`). The only side-by-side
  dp1|dp2 layout is the **editing** grid `PlannerGrid.tsx` — print-hostile: a wrapper carrying inline
  `style={{ zoom }}` + `w-max`, sticky headers (`sticky top-0`/`left-0`), inside an `overflow` scroll
  shell (`BoardShell` center column). "Hide the chrome" alone is insufficient here.
- **The biggest technical gotcha is layout clipping, not chrome-hiding.** The shell pins content to
  one viewport: `SidebarLayout.astro:53` outer `flex h-screen`; `:127` fullWidth main
  `overflow-hidden`; `:131` centered main `overflow-y-auto`; `BaseLayout.astro:50-55`
  `html, body { height:100% }`. Unless these are reset to `height:auto`/`overflow:visible` under
  print, **only the first page prints.**
- **Two theming hazards.** (1) Dark mode is a `.dark` class on `<html>` applied pre-paint
  (`BaseLayout.astro:20-26`) that redefines every semantic token (`global.css:67-122`) — printing in
  dark mode yields white-on-black. (2) Browsers strip background colors unless
  `print-color-adjust: exact`; nothing sets it today, so subject chips + shaded cells print blank.
  `SUBJECT_COLOR_HEX` (`subject-colors.ts:56-65`) already mirrors the intended light print colors.
- **Print/PDF is a stable PRD Non-Goal** (`prd.md:468`, `roadmap.md:217`), with XLSX the sanctioned
  artifact. This change consciously overrides that via a documented amendment — a product decision,
  already approved in `change.md`.
- **Chrome is well-isolated.** Nearly all interactive shell chrome is a single `<aside>`
  (`SidebarLayout.astro:54-123`) plus the breadcrumb (`:134`) and config Banner
  (`BaseLayout.astro:29-44`).
- **Tailwind v4.3.0** ships the `print:` variant out of the box (`print:` → `@media print`). Do NOT
  add a `@custom-variant print`; it already exists as a core media variant.

## Desired End State

From any meaningful page, the author hits a **Print** button (or Cmd/Ctrl-P) and the browser's print
dialog / Save-as-PDF shows a clean, ink-on-white document: no sidebar, breadcrumb, banner, switcher,
export button, drag affordances, or interactive badges — just the page's real content (schedule grid
+ course list, or catalog table), in A4 landscape, with subject colors intact, correct across
multiple pages, and identical whether the session was in light or dark mode. Verification: a
Playwright print-emulation suite asserts the chrome-hidden/content-visible contract across the three
schedule surfaces, and a manual print-preview checklist confirms pagination + color fidelity.

### Key Discoveries:

- Perspective pages need **no new data pipeline** — the rendered DOM *is* the print artifact
  (`StudentPlanPage.tsx:78-90`, `TeacherPlanPage.tsx:144-160`).
- The clean seam is "static DOM already in the SSR response" — a print stylesheet over the present
  DOM is the lowest-effort, highest-fidelity path.
- The theme is 100% OKLCH + `color-mix` semantic tokens (`global.css:8-122`) — this is exactly why
  raster PDF libs are a poor fit and browser-native print (which understands the real CSS) is right,
  and why dark-neutralization + `print-color-adjust: exact` are mandatory, not optional.
- The board's grid wrapper carries an **inline** `style={{ zoom }}` (`PlannerGrid.tsx:99`) — inline
  styles beat stylesheet rules, so the print reset must be `zoom: 1 !important`.
- e2e precedent: `e2e/specs/student-plan-view.spec.ts`, `teacher-plan-view.spec.ts`,
  `export-xlsx.spec.ts`; authenticated `chromium` project reuses `auth.setup.ts` storageState;
  helpers in `e2e/support/{board,catalog,planner}.ts`.

## What We're NOT Doing

- **No PDF-generation pipeline** — no `jsPDF`/`html2canvas`, `@react-pdf/renderer`, or Cloudflare
  Browser Rendering. The browser's "Save as PDF" *is* the export. (Batch PDF — "all 40 teachers in
  one file" — is a separate future change; Browser Rendering is the tool for it *then*.)
- **No bespoke static print components or dedicated `/print` routes.** The board gets best-effort CSS
  on the live page, not a redesigned two-column static grid on a print route (explicitly ruled out by
  the product decision).
- **No new data assembly / loaders** — print renders the existing widgets.
- **No mono-only redesign** — subject color-coding is preserved (colored chips), not replaced by
  patterns/labels; B&W printers get gray fills (color-coding degrades, names remain).
- **No change to the xlsx export** — it remains the sanctioned high-fidelity board artifact and a
  parallel precedent, not a foundation for this work.
- **No `@custom-variant print`** — the core `print:` variant already exists.

## Implementation Approach

A global-first, incremental strategy. **Phase 1** cements the product mandate (PRD/roadmap
amendment). **Phase 2** lays the global print foundation in the two shared layouts + `global.css`:
structural resets (unclip), dark-token neutralization, `print-color-adjust: exact`, `@page` A4
landscape, and hiding shell chrome + portalled overlays — after which the catalog lists and dashboard
already print. **Phase 3** adds a shared framework-free `PrintButton` and wires the two perspective
pages (hide header controls, flatten the teacher collision badge). **Phase 4** tackles the board with
best-effort CSS (hide palette/shelf/toolbar, reset zoom/sticky/overflow) plus its Print button,
validating landscape pagination. **Phase 5** locks the contract with Playwright print-emulation e2e.

Global structural resets are expressed as inline Tailwind `print:` utilities on the layout divs
(colocated, no fragile selectors); global concerns that can't be utilities — `@page`, token
neutralization, `print-color-adjust`, overlay hiding, the board grid resets — live in a single
`@media print { … }` block appended to `global.css` after `@layer base` (line 222+).

## Critical Implementation Details

- **Inline-zoom override (board).** `PlannerGrid.tsx:99` sets `style={{ zoom }}` inline on
  `[data-slot="planner-grid"]`. Inline styles win over stylesheet rules, so resetting zoom for print
  **requires `!important`**: `@media print { [data-slot="planner-grid"] { zoom: 1 !important } }`. A
  Tailwind `print:` utility cannot override an inline style here.
- **BaseLayout scoped-style specificity.** The `html, body { height:100% }` clip source lives in
  `BaseLayout.astro`'s component `<style>` (`:49-55`), which Astro scopes with a `[data-astro-cid-*]`
  attribute (specificity 0,1,1). A plain `@media print { html, body { height:auto } }` in `global.css`
  (0,0,1) would lose the cascade. Put the print reset for `html, body` **inside BaseLayout's scoped
  `<style>`** (`@media print { html, body { height: auto } }`), not in `global.css`.
- **Dark-token neutralization is a full re-declaration.** CSS custom properties have no "reset to
  parent" — under `@media print` the light values (the `:root` block, `global.css:8-65`, incl. the
  subject `<hue>-100`/`<hue>-900` pairs) must be re-declared on `.dark` so a dark session prints
  ink-on-white. Re-declare the **full** token set, not a subset — a missed token prints
  white-on-dark. Mechanical duplication of the `:root` block is the correct, safe approach.
- **`print-color-adjust: exact` must be broad.** Apply it widely under print (e.g. on `*` within the
  print block, or on the grid/list subtree + chips) so subject chips, availability shading, and the
  break-band hatch render on paper; without it browsers strip those backgrounds. Save-as-PDF honors
  it; on physical B&W printers the user must still enable "background graphics."
- **Board pagination is the one unvalidated risk.** dp1+dp2 × 5 days ≈ 10 sub-columns > A4-landscape
  printable width, so the grid will overflow. Best-effort target is to rely on the browser's
  fit-to-page scaling after unclipping; if print-preview shows clipping/illegibility, the fallback is
  a fixed print scale on `[data-slot="planner-grid"]` (e.g. `zoom`/`transform: scale`) tuned to fit
  one landscape width. Resolve this empirically in Phase 4, not by guessing.

---

## Phase 1: Product decision — amend PRD + roadmap Non-Goals

### Overview

Record the approved override: browser-native print-friendliness (CSS + `window.print()`) is now in
scope; a PDF-generation *pipeline/service* remains a non-goal. This is the mandate the code phases
depend on, so it goes first.

### Changes Required:

#### 1. PRD Non-Goals

**File**: `context/foundation/prd.md`

**Intent**: Narrow the blanket "Printable / PDF export" non-goal (`:468`) to reflect that
print-friendliness via browser-native print is now in scope, while a bespoke PDF-generation pipeline
stays out. Cross-reference the `printable-version` change.

**Contract**: Edit the single bullet at `prd.md:468` (do not delete it — reframe it). New wording
distinguishes "print-friendly via `@media print` + browser Save-as-PDF (in scope, shipped by
`printable-version`)" from "server/library PDF-generation pipeline & batch export (still out of
scope)." Keep the surrounding "carried forward" list intact.

#### 2. Roadmap parked item

**File**: `context/foundation/roadmap.md`

**Intent**: Update the matching parked-item line (`:217`) so it mirrors the PRD reframing and points
to the change; XLSX remains the sanctioned high-fidelity/batch artifact.

**Contract**: Edit the `- **Printable / PDF export** — …` line at `roadmap.md:217`. Note that
per-page print-friendliness ships in `printable-version`; PDF-generation pipeline / batch export
remain parked.

#### 3. Change identity

**File**: `context/changes/printable-version/change.md`

**Intent**: Advance lifecycle to reflect planning is complete.

**Contract**: Frontmatter `status: preparing` → `planned`; `updated: 2026-07-09`. (The `/10x-plan`
skill writes this.)

### Success Criteria:

#### Automated Verification:

- [ ] Build stays clean (docs-only, no code): `pnpm build`

#### Manual Verification:

- [ ] `prd.md:468` reads as a scoped override (print-friendly in scope; PDF pipeline out), not a
      blanket non-goal.
- [ ] `roadmap.md:217` mirrors the PRD wording and references `printable-version`.
- [ ] `change.md` frontmatter shows `status: planned`.

**Implementation Note**: After automated verification passes, pause for manual confirmation before
Phase 2.

---

## Phase 2: Global print foundation (shell + theming)

### Overview

Establish the print substrate in the two shared layouts and `global.css`: unclip the viewport-pinned
shell, hide the discrete shell chrome + all portalled overlays, neutralize dark mode, force color
fidelity, and set the page geometry. After this phase the **catalog lists and dashboard print for
free** (already static tables in centered mode), and the perspective/board content prints structurally
(chrome-hiding of their page-local controls comes in Phases 3–4).

### Changes Required:

#### 1. Global `@media print` block

**File**: `src/app/styles/global.css`

**Intent**: Add one top-level `@media print { … }` block (after `@layer base`, i.e. after line 222)
carrying every print concern that can't be an inline utility: page geometry, dark-token
neutralization, color fidelity, overlay hiding, and `break-inside` hints. This is the heart of the
feature.

**Contract**: A single `@media print` block containing:
- `@page { size: A4 landscape; margin: 12mm }` (no existing `@page` to conflict with).
- Full light-token re-declaration on `.dark` (copy the `:root` values, `global.css:8-65`, including
  every `--subject-*` / `--subject-*-foreground` pair) so dark sessions print ink-on-white.
- Broad `print-color-adjust: exact` (+ `-webkit-print-color-adjust: exact`) so chip/cell/band
  backgrounds render.
- Hide portalled overlays uniformly: `[role="dialog"]`, Radix popper/portal wrappers, and the
  `sonner` toast container (covers the teacher collision dialog + export toasters without per-page
  work). Use `display: none`.
- `break-inside: avoid` on schedule grid rows and perspective course cards to reduce mid-row page
  splits.
Do **not** add `@custom-variant print`.

#### 2. Unclip + hide chrome in `SidebarLayout`

**File**: `src/app/layouts/SidebarLayout.astro`

**Intent**: Reset the viewport clamps to flow onto paper, and hide the sidebar + breadcrumb from
print, via inline Tailwind `print:` utilities (colocated, no fragile global selectors).

**Contract**: Add `print:` utilities to the existing class lists —
- outer shell (`:53`, `flex h-screen`): add `print:h-auto print:block print:overflow-visible`.
- `<aside id="app-sidebar">` (`:54`): add `print:hidden`.
- fullWidth `<main>` (`:127`, `overflow-hidden`): add `print:overflow-visible print:h-auto`.
- centered `<main>` (`:131`, `overflow-y-auto`): add `print:overflow-visible`.
- breadcrumb `<nav aria-label="Breadcrumb">` (`:134`): add `print:hidden`.

#### 3. Unclip `html, body` + hide Banner in `BaseLayout`

**File**: `src/app/layouts/BaseLayout.astro`

**Intent**: Reset the `height:100%` clamp inside the component's own scoped `<style>` (specificity —
see Critical Implementation Details), and hide the config-missing Banner from print.

**Contract**: In the scoped `<style>` (`:49-55`), add `@media print { html, body { height: auto } }`.
Wrap the `<Banner>` render (`:29-44`) in a `<div class="print:hidden">` container — do **not** try to
pass `print:hidden` to `<Banner>` itself: `Banner.astro` accepts only `variant` and Astro does not
auto-forward `class` to a component's root, so the class would be a silent no-op.

### Success Criteria:

#### Automated Verification:

- [ ] Build clean: `pnpm build`
- [ ] Lint + structure: `pnpm lint` && `pnpm steiger`

#### Manual Verification:

- [ ] Print-preview any catalog list (`/plans`, `/plans/[id]/courses|teachers|students`) and
      `/dashboard`: no sidebar/breadcrumb/banner, full table flows across pages (not just page 1).
- [ ] Toggle dark mode on, then print-preview: output is ink-on-white (no white-on-black).
- [ ] A page with subject-colored content shows colored backgrounds in preview with "background
      graphics" on.
- [ ] Multi-row content paginates without content being clipped after the first page.

**Implementation Note**: After automated verification passes, pause for manual confirmation before
Phase 3.

---

## Phase 3: Perspective pages — Print button + student & teacher

### Overview

Add the shared **Print** affordance and finish the two high-fidelity schedule pages: hide their
page-local controls (switcher, export, print button) from print and flatten the teacher's interactive
collision badges to static chips.

### Changes Required:

#### 1. Shared `PrintButton`

**File**: `src/shared/ui/print-button.tsx` (kebab-case per the other `shared/ui` `.tsx` files; +
export `{ PrintButton }` from `src/shared/ui/index.ts`)

**Intent**: A small, framework-free, stateless icon button that triggers `window.print()` and hides
itself from the printout — mirroring `ExportStudentPlanButton`'s ghost/icon presentation so it slots
beside the export button.

**Contract**: `PrintButton()` renders the shared `Button` (`variant="ghost" size="icon"`) with a
lucide `Printer` icon, `title`/`aria-label` "Print", `onClick={() => window.print()}`, and a
`print:hidden` class on itself. No props required (optional `title` override acceptable). `window`
is referenced only inside the handler (SSR-safe). `.tsx` (renders JSX).

#### 2. Wire the student page

**File**: `src/_pages/student-plan-view/ui/StudentPlanPage.tsx`

**Intent**: Add the Print button to the header controls and ensure those controls don't print.

**Contract**: Add `<PrintButton />` inside the header controls `<div>` (`:60-75`) alongside
`<StudentSwitcher>` + `<ExportStudentPlanButton>`; add `print:hidden` to that controls `<div>` so the
switcher, export button, and print button are all suppressed on paper. Keep the `<h1>`/subtitle,
`<ScheduleGrid>`, and `<PerspectiveCourseList>` printing (no change).

#### 3. Wire the teacher page + flatten collision badges

**File**: `src/_pages/teacher-plan-view/ui/TeacherPlanPage.tsx`, `src/widgets/timetable-board/ui/ScheduleGrid.tsx`

**Intent**: Same header treatment as student; additionally, drop the interactive collision-badge
button affordance in print while keeping the shaded cell + collision-toned chip (the dialog is already
hidden globally in Phase 2).

**Contract**:
- `TeacherPlanPage.tsx`: add `<PrintButton />` to the header controls `<div>` (`:117-141`) and add
  `print:hidden` to that `<div>` (suppresses `<TeacherSwitcher>` + `<ExportTeacherPlanButton>` +
  print button). No change needed for `<CollisionDetailsDialog>` (Phase 2 hides `[role="dialog"]`).
- `ScheduleGrid.tsx`: on the collision/unavailable `<Badge>`/`<button>` (`:187-205`), add
  `print:hidden` to the badge so only the interactive affordance is dropped; the chip's collision
  tone (`border-destructive`/`bg-destructive/10` etc., `:164-168`) and any cell shading stay. This is
  a shared widget used by both perspective pages — the student view passes no `onInspect`, so the
  badge never renders there; the edit is teacher-facing but layer-safe.

### Success Criteria:

#### Automated Verification:

- [ ] Build clean: `pnpm build`
- [ ] Type-check clean (after `astro sync`): `pnpm check`
- [ ] Lint + structure (FSD import direction for the new `shared/ui` export): `pnpm lint` &&
      `pnpm steiger`
- [ ] Unit suite unaffected: `pnpm test`

#### Manual Verification:

- [ ] Student page: Print button appears beside export, triggers the print dialog; in preview the
      switcher/export/print controls are gone, name + grid + course list remain.
- [ ] Teacher page: same; collision badges render as static (no button), cell shading + chip tone
      preserved, no dialog in the printout.
- [ ] Both pages: colors correct and dark-mode-safe in preview; grid + roster paginate cleanly.

**Implementation Note**: After automated verification passes, pause for manual confirmation before
Phase 4.

---

## Phase 4: Board best-effort print CSS + Print button

### Overview

Make the live two-cohort board print as "the board cleaned up for paper": hide all editing chrome,
neutralize the print-hostile grid shell (zoom/sticky/overflow), add its Print button, and validate
landscape pagination — falling back to a fixed print scale if the wide grid clips.

### Changes Required:

#### 1. Board grid resets (global block)

**File**: `src/app/styles/global.css` (extend the Phase 2 `@media print` block)

**Intent**: Neutralize the editing grid's print-hostile mechanics that inline utilities can't reach
(the inline `zoom`, sticky headers, scroll clip).

**Contract**: Inside the existing `@media print` block, add board-scoped rules:
- `[data-slot="planner-grid"] { zoom: 1 !important; width: 100% !important }` (override the inline
  `style={{ zoom }}`; drop `w-max`'s intrinsic width).
- Un-stick the grid's pinned headers: `[data-slot="planner-grid"] .sticky { position: static !important }`
  (Tailwind's `sticky` utility → `.sticky`; scoped to the grid so nothing else is affected).
- Unclip the board's center scroll container so the full grid flows (target the `overflow`
  wrapper around the grid within `[data-slot="planner-board"]`).
- If Phase-4 pagination validation fails, apply the fixed print-scale fallback here (see Critical
  Implementation Details).

#### 2. Hide board editing chrome

**File**: board chrome components under `src/_pages/plan-detail/ui/` — `chrome/PlanSummaryBar.tsx`
(the whole top-bar row: it renders `BoardHeader` — plan name + `CohortSwitcher` — and assembles the
trailing controls `UndoRedoControls` + the `trailing` fragment `LensPicker` + `ExportMenu` +
`BoardSettingsMenu` passed from `PlannerBoard.tsx:265-287`), `chrome/ErrorBanner.tsx`,
`lens/LensBar.tsx` (+ `LensAnnouncer`), `palette/CombinedPalettePanel.tsx`, `shelf/ShelfDrawer.tsx`

> **Structure note (verified):** `BoardHeader.tsx` is a *generic layout* — plan name + `CohortSwitcher`
> + a `{children}` slot — reused by the focus-mode empty-state early-return (`PlannerBoard.tsx:207`); it
> has **no** action cluster of its own. The action controls are composed in `PlanSummaryBar` (undo/redo
> + a `trailing` slot) and `PlannerBoard.tsx:265-287`. Zoom + drag-hint live *inside* the
> `BoardSettingsMenu` dropdown (closed by default → not in the print DOM), so they need no separate hide.

**Intent**: Suppress every non-grid affordance from the printout via `print:hidden` on each discrete
chrome block, leaving only the grid (its placed chips) and a print-only plan-name title (change #4) on
paper.

**Contract**: Add `print:hidden` to the outer element of each: `CombinedPalettePanel` (1st board
column), `ShelfDrawer` (3rd column), the `PlanSummaryBar` row wrapper (i.e. `BoardHeader`'s root
`<div>` — hiding it suppresses the whole top bar in one shot: plan name, `CohortSwitcher`,
`UndoRedoControls`, the parked badge, `LensPicker`, `ExportMenu`, and `BoardSettingsMenu`, since they
are all descendants), the lens bar + announcer, and the error banner(s). Because the summary/header row
carries the plan name, re-add it as a print-only title in change #4. Placed chips within `SlotCell`
keep rendering; only their drag/remove/inspect affordances are suppressed (a print rule hiding
interactive controls inside `[data-slot="planner-grid"]` cells — buttons/handles — while keeping the
chip body and tone).

#### 3. Board Print button

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx` (the `trailing` prop passed to `PlanSummaryBar`)

**Intent**: Give the board the same discoverable Print affordance as the perspective pages.

**Contract**: Render `<PrintButton />` alongside `ExportMenu` / `BoardSettingsMenu` inside the
`trailing={…}` fragment at `PlannerBoard.tsx:265-287` — **not** in `BoardHeader.tsx`, which is a generic
layout reused by the empty-state early-return (`:207`) where a Print button would render with nothing to
print. It self-hides (`print:hidden`), and its containing `PlanSummaryBar` row is `print:hidden` per
change #2 — so it never appears on paper.

#### 4. Print-only board title (parity with the perspective pages)

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx` (or the `BoardShell` center region)

**Intent**: The student/teacher printouts keep their `<h1>` name heading; hiding the whole board top bar
(change #2) drops the board's only title, leaving an anonymous grid. Re-add a minimal print-only heading
so the board PDF identifies its plan.

**Contract**: Render a `hidden print:block` heading carrying the plan name (and the active
cohort/surface if useful) above the grid, so it appears only on paper and is inert on screen.
Token-styled only (no palette-named colors) per the semantic-tokens rule.

### Success Criteria:

#### Automated Verification:

- [ ] Build clean: `pnpm build`
- [ ] Type-check clean (after `astro sync`): `pnpm check`
- [ ] Lint + structure: `pnpm lint` && `pnpm steiger`
- [ ] Unit suite unaffected: `pnpm test`

#### Manual Verification:

- [ ] Board print-preview: no palette/shelf/toolbar/summary/lens/banners/drag affordances; the
      dp1|dp2 grid with placed chips is visible.
- [ ] Board printout carries a plan-name title (the print-only heading, change #4), matching the
      perspective pages.
- [ ] Grid is un-zoomed (100%), headers not floating/overlapping, content not clipped after page 1.
- [ ] **Pagination decision recorded**: landscape fit-to-page is legible, OR the fixed print-scale
      fallback was applied and validated. Document which in the change notes.
- [ ] Colors correct + dark-mode-safe in preview; Print button triggers the dialog and is absent from
      output.

**Implementation Note**: After automated verification passes, pause for manual confirmation
(especially the pagination decision) before Phase 5.

---

## Phase 5: Playwright print-emulation e2e

### Overview

Lock the chrome-hidden / content-visible contract — and the dark-mode neutralization contract — with
automated print-emulation tests, so future chrome changes can't silently leak into the printout and a
newly-added dark token can't silently reintroduce white-on-dark (the plan's stated top fidelity risk,
otherwise manual-only).

### Changes Required:

#### 1. Print-emulation specs

**File**: `e2e/specs/printable-version.spec.ts` (+ any shared selectors via `e2e/support/`)

**Intent**: Assert, under emulated print media, that interactive chrome is hidden and real content is
visible across the three schedule surfaces, and that a dark session prints ink-on-white — mirroring the
existing authenticated-spec pattern.

**Contract**: New spec(s) in the authenticated `chromium` project (reuses `auth.setup.ts`
storageState). For each of student, teacher, board: navigate to a seeded plan's page, call
`await page.emulateMedia({ media: 'print' })`, then assert —
- hidden (`toBeHidden`): `#app-sidebar`; the page's switcher + export button + Print button; for the
  teacher, the collision badge/dialog; for the board, the palette + shelf + toolbar.
- visible (`toBeVisible`): `[role="grid"]` (schedule) / `[data-slot="planner-grid"]` (board), and the
  perspective course list.
- **dark neutralization (theming gate):** in one spec, add `.dark` to `<html>` via
  `page.evaluate(() => document.documentElement.classList.add("dark"))` **before** emulating print, then
  assert a known content element's computed `background-color` (or the resolved `--background` token) is
  **light** (i.e. the dark session prints ink-on-white). Guard for "is light", not an exact value, so
  token tweaks don't make it brittle. `emulateMedia({ media: 'print' })` does not toggle `.dark`, so this
  path is otherwise never exercised by the default light-mode specs.
Reuse route/selector helpers from `e2e/support/{board,catalog,planner}.ts` and follow the seeded-data
conventions in `e2e/specs/{student,teacher}-plan-view.spec.ts`. Optionally add a catalog spot-check
(sidebar hidden, table visible) to cover the free-falling pages.

### Success Criteria:

#### Automated Verification:

- [ ] New print specs pass: `pnpm test:e2e` (or the scoped `printable-version` spec)
- [ ] Full e2e suite still green (no regressions): `pnpm test:e2e`
- [ ] Build + type-check + lint + structure clean: `pnpm build` && `pnpm check` && `pnpm lint` &&
      `pnpm steiger`

#### Manual Verification:

- [ ] The spec fails if a chrome element is made visible under print (sanity-check by temporarily
      removing a `print:hidden`), confirming it's a real gate.
- [ ] The dark-neutralization assertion fails if a token is left out of the `.dark` print
      re-declaration (sanity-check by removing one), confirming the theming gate is real.

**Implementation Note**: Final phase — after automated verification passes, confirm the full CI gate
locally via the `/verify` skill before opening the PR.

---

## Testing Strategy

### Unit Tests:

- No new unit tests warranted — the change is CSS + a stateless button + docs. `PrintButton` has no
  branching logic worth a unit test (its behavior is `window.print()` on click; covered by e2e that
  the control is present/hidden). Existing `pnpm test` must stay green (the `ScheduleGrid` badge edit
  is class-only).

### Integration Tests:

- None — no Supabase/data-layer surface changes.

### E2E Tests (Phase 5):

- Print-emulation (`emulateMedia({ media: 'print' })`) across student, teacher, board asserting the
  chrome-hidden / content-visible contract; optional catalog spot-check.

### Manual Testing Steps:

1. In each of light and dark mode, open student → teacher → board → a catalog list → dashboard and
   use the browser print-preview (Cmd/Ctrl-P) / Save-as-PDF.
2. Verify: sidebar/breadcrumb/banner/switcher/export/print controls absent; real content present;
   ink-on-white regardless of theme; subject colors present with background graphics enabled.
3. Verify pagination: nothing clipped after page 1; the board grid fits/scales acceptably in
   landscape (record the pagination decision).
4. Edge: a teacher with collisions (badges flatten, no dialog, cell shading kept); a student with no
   courses (empty-state prints cleanly); a plan with break-between-period bands (band degrades
   gracefully).

## Performance Considerations

Negligible. No runtime bundle beyond a tiny stateless `PrintButton` (one lucide icon, already in the
dep tree) and static CSS. No effect on the <200ms placement/validation budget — print CSS is inert
until the user prints, and the button does no work until clicked. `print-color-adjust: exact` only
affects the print render.

## Migration Notes

None — additive CSS, one new component, docs edits. No schema, no data, no rollback concerns. A code
rollback fully reverts the feature; the PRD/roadmap wording reverts with it.

## References

- Research: `context/changes/printable-version/research.md`
- Product decision: `context/changes/printable-version/change.md`
- Prior print/PDF feasibility study: `context/archive/2026-07-05-teacher-plan-view/research.md` §4;
  binding "print-viability" design rules: `context/archive/2026-07-05-teacher-plan-view/plan.md:55`,
  `context/archive/2026-07-06-student-plan-view/plan.md:42,62`
- Static print-viable grid: `src/widgets/timetable-board/ui/ScheduleGrid.tsx:41`
- Board print-hostile grid: `src/_pages/plan-detail/ui/grid/PlannerGrid.tsx:88,99`
- Shell chrome + clipping: `src/app/layouts/SidebarLayout.astro:53`, `src/app/layouts/BaseLayout.astro:20,50`
- Theming tokens + subject colors: `src/app/styles/global.css:8-122`,
  `src/shared/config/subject-colors.ts:56-65`
- Export-button precedent (button placement): `src/_pages/student-plan-view/ui/ExportStudentPlanButton.tsx`
- e2e precedent: `e2e/specs/student-plan-view.spec.ts`, `e2e/specs/export-xlsx.spec.ts`, `e2e/support/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not
> rename step titles. See `references/progress-format.md`.

### Phase 1: Product decision — amend PRD + roadmap Non-Goals

#### Automated

- [x] 1.1 Build stays clean (docs-only): `pnpm build` — 2da2393

#### Manual

- [x] 1.2 `prd.md:468` reads as a scoped override (print-friendly in scope; PDF pipeline out) — 2da2393
- [x] 1.3 `roadmap.md:217` mirrors the PRD wording and references `printable-version` — 2da2393
- [x] 1.4 `change.md` frontmatter shows `status: planned` — 2da2393

### Phase 2: Global print foundation (shell + theming)

#### Automated

- [x] 2.1 Build clean: `pnpm build` — 302ce8e
- [x] 2.2 Lint + structure: `pnpm lint` && `pnpm steiger` — 302ce8e

#### Manual

- [x] 2.3 Catalog lists + dashboard print-preview: no shell chrome, full table flows across pages — 7cd2773
- [x] 2.4 Dark mode prints ink-on-white — 7cd2773
- [x] 2.5 Subject-colored content shows backgrounds in preview (background graphics on) — 7cd2773
- [x] 2.6 Multi-row content paginates without first-page clipping — 7cd2773

### Phase 3: Perspective pages — Print button + student & teacher

#### Automated

- [x] 3.1 Build clean: `pnpm build` — 7557bca
- [x] 3.2 Type-check clean (after `astro sync`): `pnpm check` — 7557bca
- [x] 3.3 Lint + structure: `pnpm lint` && `pnpm steiger` — 7557bca
- [x] 3.4 Unit suite unaffected: `pnpm test` — 7557bca

#### Manual

- [x] 3.5 Student: Print button beside export, triggers dialog; controls hidden, content kept in preview — 7cd2773
- [x] 3.6 Teacher: same; collision badges static (no button/dialog), shading + tone preserved — 7cd2773
- [x] 3.7 Both: colors correct + dark-mode-safe; grid + roster paginate cleanly — 7cd2773

### Phase 4: Board best-effort print CSS + Print button

#### Automated

- [x] 4.1 Build clean: `pnpm build` — ce12005
- [x] 4.2 Type-check clean (after `astro sync`): `pnpm check` — ce12005
- [x] 4.3 Lint + structure: `pnpm lint` && `pnpm steiger` — ce12005
- [x] 4.4 Unit suite unaffected: `pnpm test` — ce12005

#### Manual

- [x] 4.5 Board preview: editing chrome hidden, dp1|dp2 grid with chips visible — 7cd2773
- [x] 4.6 Board printout carries a plan-name title (print-only heading, change #4) — 7cd2773
- [x] 4.7 Grid un-zoomed, headers not floating, no post-page-1 clipping — 7cd2773
- [x] 4.8 Pagination decision recorded (landscape fit OR fixed print-scale fallback validated) — 7cd2773
- [x] 4.9 Colors correct + dark-mode-safe; Print button triggers dialog, absent from output — 7cd2773

### Phase 5: Playwright print-emulation e2e

#### Automated

- [x] 5.1 New print specs pass (incl. the dark-neutralization assertion): `pnpm test:e2e` — 7cd2773
- [x] 5.2 Full e2e suite still green: `pnpm test:e2e` — 7cd2773
- [x] 5.3 Build + type-check + lint + structure clean: `pnpm build` && `pnpm check` && `pnpm lint` && `pnpm steiger` — 7cd2773

#### Manual

- [x] 5.4 Spec fails if a `print:hidden` is removed (confirms it's a real gate) — 7cd2773
- [x] 5.5 Dark-neutralization assertion fails if a token is dropped from the `.dark` print re-declaration — 7cd2773
