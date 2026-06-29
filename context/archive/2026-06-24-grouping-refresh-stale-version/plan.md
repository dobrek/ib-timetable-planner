# Grouping Refresh (Stale Version) Implementation Plan

## Overview

Surface when a cohort's grouping palette is **out of date** relative to the live catalog, and let the author **recompute** it on demand — finishing a feature whose detection primitive and recompute engine already ship and are tested. The work is pure UI/load wiring: compute a per-cohort `stale` flag in the load path and render a palette-scoped notice with an inline Recompute button. Placements are never touched.

## Current State Analysis

The detection + recompute machinery was built ahead of its UI (historically "S-06"), then orphaned. Concretely:

- **`isGroupingStale(supabase, { planId, cohort })`** (`src/_pages/plan-detail/api/staleness.ts:13`) recomputes the live catalog hash via `loadCohortCourses` + `computeCatalogHash`, reads the latest `course_groupings.catalog_hash` for `(plan_id, cohort)`, and returns stale on absent/null/mismatch. It is **called by no UI or loader** and is **not exported from `api/index.ts`** — the only reference is the integration test (`endpoint.integration.test.ts:5,78`).
- **`computeGroupings` Astro Action → `computeAndPersistGroupings` → `replace_cohort_groupings` RPC** is already **idempotent** (atomic `DELETE`+`INSERT` per `(plan, cohort)`). Re-running overwrites; nothing guards "only if empty." The client wrapper `computeGroupings({ planId, cohort })` (`api/grouping-client.ts:4`) returns `{ error: string | undefined }`.
- **`loadPlannerData`** (`src/_pages/plan-detail/api/load.ts:29`) already loads the live catalog (`catalog` at `load.ts:65`) and queries `course_groupings` (`load.ts:51-55`) — but the select omits `catalog_hash`, and no `stale` flag is computed or threaded.
- **`PlannerBoardProps`** (`src/_pages/plan-detail/model/drag.ts:19`) has no `stale` field.
- The only compute entry point is **`ComputeGroupingsEmptyState`** (`ui/ComputeGroupingsEmptyState.tsx`), rendered only when `groupings.length === 0` (`ui/PlannerBoard.tsx:113`). Once groupings exist there is no recompute control.

Key constraints discovered:

- **Placements have no FK to groupings** — regroup (atomic replace) cannot orphan or cascade-delete any placement or bundle. The board survives recompute fully intact. Validation (`model/collisions.ts`) consumes `placements` + the live catalog, **never** the stored groupings, and re-runs every render — so staleness is a _palette-fidelity_ problem only, never a correctness one.
- **Staleness is per-cohort** — dp1/dp2 hash independently; `isGroupingStale` already filters `.eq("plan_id").eq("cohort")`. The cohort switcher navigates + remounts the island (`ui/CohortSwitcher.tsx`), so the flag re-evaluates for free on switch.
- **The catalog hash must stay deterministic** — `computeCatalogHash` uses Web Crypto SHA-256 over a **code-point-sorted** canonical serialization (`src/shared/lib/catalog-hash/compute-catalog-hash.ts:13`). Do not reintroduce locale-sensitive sorting; a prior `localeCompare` bug silently corrupted this feature.

## Desired End State

When a cohort's catalog has changed since its groupings were last computed, the **palette column is replaced** by a `warning`-toned recompute panel ("Suggestions are out of date. Your placed timetable is unchanged — recompute to refresh the palette.") with a **Recompute** button. The whole palette is downstream of the stale groupings, so it is hidden rather than shown-with-a-warning, removing the footgun of dragging stale suggestions. The **board/grid stays visible and interactive** — existing placements remain valid and editable. Clicking Recompute: shows a busy state, calls the existing `computeGroupings` Action, then on success re-runs the loader (`refreshPage()`); on failure it renders an inline `role="alert"` error inside the panel (mirroring `ComputeGroupingsEmptyState`, since the plan-detail board mounts no `<Toaster>`). After a successful recompute the normal palette returns (the live hash now matches the stored one). When the catalog is unchanged, the normal palette renders. The board's placements are identical before and after recompute. dp1 and dp2 reflect their own staleness independently.

Verify by: editing a course/student in a cohort with existing groupings → reload the board → the recompute panel replaces the palette (grid still shown) → click Recompute → palette returns, placements unchanged, suggestions reflect the new catalog.

### Key Discoveries:

- `isGroupingStale` re-loads the catalog itself (`staleness.ts:17`) — must be refactored to reuse the catalog `loadPlannerData` already loaded (`load.ts:65`) to avoid a double `loadCohortCourses` on every board load.
- The `warning` Badge variant and `bg-warning`/`text-warning` tokens already exist (`src/shared/ui/badge.tsx`); use semantic tokens, never palette colors.
- The repo's dominant mutation idiom is busy flag → `sonner` toast → `refreshPage()`, **but sonner only renders where an island mounts its own `<Toaster>`** (TeacherCatalog/StudentCatalog/CourseCatalog/PlansHub do; the plan-detail board does **not**). So this panel follows the sibling `ComputeGroupingsEmptyState` variant instead: **busy flag → inline `role="alert"` error on failure → `refreshPage()` on success** (`refresh-page.ts`). `refreshPage()` re-runs the loader preserving `?cohort=`, which recomputes the stale flag; the returning palette is the success signal.
- jsdom + `@testing-library/react` test lane exists (`vitest.config.ts:33`) for the panel component test.

## What We're NOT Doing

- **Not touching placements** — no board-clear, no placement migration, no orphan reconciliation (Option A). The cohort-move orphaned-placement bug (`collisions.ts:88-89`) is a **separate, pre-existing change candidate** (see `research.md` "Deferred / follow-up"); explicitly out of scope.
- **No auto-recompute** on catalog change — manual trigger only.
- **No confirm dialog** — recompute is non-destructive to the board, so it runs immediately.
- **No "last computed" timestamp** — the binary stale/fresh signal is what the panel conveys.
- **No persistent/always-on Recompute control** — the panel (and its button) render stale-only; a fresh cohort shows the normal palette.
- **Not keeping the stale palette visible** — when stale, the palette is _replaced_ (not annotated), since every part of it (grouping boxes, leading-course filter, promoted chip) is derived from the stale groupings. Accepted edge: a failed recompute leaves no palette fallback until a retry succeeds (the board remains; the old rows survive the atomic replace).
- **No schema, migration, RPC, or Action changes** — the backend is complete and idempotent.
- **No new view or route** — extend the existing palette surface only.

## Implementation Approach

Three phases, server-then-client-then-E2E. Phase 1 makes the load path emit a per-cohort `stale: boolean` by reusing the already-loaded catalog (refactoring `isGroupingStale` to take the catalog rather than re-fetch it) and threading the flag through `PlannerBoardProps`. Phase 2 consumes that flag in `PlannerBoard`, which branches the palette column: when stale it renders a new recompute panel **in place of** `PlannerPalette` (the whole palette is stale-derived), reusing the existing `computeGroupings` client wrapper and the sibling `ComputeGroupingsEmptyState`'s busy-button → inline-error-on-failure → `refreshPage()`-on-success idiom (no `<Toaster>` on this board); the board/grid stays put. `PlannerPalette` itself is untouched. Phase 3 proves the full stack with one Playwright spec on the existing harness. Each phase is independently verifiable; Phase 2 depends on Phase 1's prop, and Phase 3 exercises both.

## Critical Implementation Details

- **Off the hot path, not the per-drop budget.** The `<200ms` budget is the per-drop validator, not page load. Computing one SHA-256 over the already-loaded catalog plus a single-column `course_groupings` read on board load is fine — but it must run **after** the catalog is loaded, so it is sequential to the existing `Promise.all`. Guard it behind `groupings.length > 0`: a plan with no groupings renders the empty state, so computing staleness there is wasted work (and would always read "stale" on the null stored hash).

## Phase 1: Load-path wiring (per-cohort `stale` flag)

### Overview

Refactor `isGroupingStale` to accept the already-loaded catalog, export it, compute a per-cohort `stale` flag in `loadPlannerData`, and add `stale` to `PlannerBoardProps`.

### Changes Required:

#### 1. Refactor `isGroupingStale` to reuse the loaded catalog

**File**: `src/_pages/plan-detail/api/staleness.ts`

**Intent**: Stop the redundant `loadCohortCourses` call so the detector can run on every board load without re-fetching the catalog `loadPlannerData` already has. The detector still owns the stored-hash read and the comparison, staying a cohesive, integration-testable unit.

**Contract**: New signature `isGroupingStale(supabase, { planId, cohort, catalog }): Promise<boolean>` where `catalog: GroupingCourse[]` is the live catalog projection (`from "@/shared/lib/catalog-hash"` or the model `grouping` type — match the type `loadCohortCourses` returns). Body: `computeCatalogHash(catalog)` for the live hash, then the existing latest-row `catalog_hash` query + the same `stored?.catalog_hash == null || stored.catalog_hash !== currentHash` comparison. Drop the `loadCohortCourses` import. Update the JSDoc to drop "no UI here."

#### 2. Export the detector from the API barrel

**File**: `src/_pages/plan-detail/api/index.ts`

**Intent**: Make `isGroupingStale` reachable from the load module (and keep the public surface honest now that it's wired).

**Contract**: Add `export { isGroupingStale } from "./staleness";`.

#### 3. Compute and thread the `stale` flag

**File**: `src/_pages/plan-detail/api/load.ts`

**Intent**: Emit a per-cohort `stale` flag from the already-loaded catalog so the island can swap in the recompute panel, without a second catalog fetch and without paying for the read on plans that have no groupings yet.

**Contract**: After `groupings` is derived (`load.ts:80-86`), compute `const stale = groupings.length > 0 ? await isGroupingStale(supabase, { planId: id, cohort, catalog: catalog.courses }) : false;` and include `stale` in the returned `props` object (`load.ts:108-121`). Import `isGroupingStale` from `./staleness` (or the barrel). The compute is sequential after the existing `Promise.all` (it depends on `catalog`).

#### 4. Add `stale` to the board props type

**File**: `src/_pages/plan-detail/model/drag.ts`

**Intent**: Type the new server-assembled prop.

**Contract**: Add `stale: boolean;` to `PlannerBoardProps` (with a one-line doc comment: per-cohort palette staleness; drives the palette notice only).

#### 5. Update the integration test for the new signature

**File**: `src/_pages/plan-detail/api/endpoint.integration.test.ts`

**Intent**: Keep the existing staleness assertion green under the new signature, and add a stale-after-mutation assertion to lock the wiring's actual behavior.

**Contract**: At the existing call site (`:78`), load the catalog (`const { courses } = await loadCohortCourses(supabase, planId, COHORT)`) and call `isGroupingStale(supabase, { planId, cohort: COHORT, catalog: courses })` — still expect `false` right after compute. Add a follow-up assertion: mutate a grouping input for the plan (e.g. insert a `student_choices` row, or any catalog-affecting edit the factories support), re-load the catalog, and expect `isGroupingStale(...)` to be `true`. Import `loadCohortCourses` from `@/shared/api`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm exec astro check`
- Linting passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Unit suite passes: `pnpm test`
- Integration suite passes (local Supabase up): `pnpm test:integration`
- Build stays clean: `pnpm build`

#### Manual Verification:

- On a plan/cohort with existing groupings and an unchanged catalog, `loadPlannerData` returns `stale: false`; after a catalog edit, a fresh load returns `stale: true` (inspect via the board or a quick log).
- A plan/cohort with **no** groupings still renders the empty state (no extra query, `stale` is `false`).

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Palette-view orchestration + recompute panel

### Overview

Model the left column as **one derived view** the board dispatches on — `"empty" | "stale" | "ready"` — instead of accreting a second inline condition. When stale, the dispatch renders a `warning`-toned recompute panel **in place of** the palette (the entire palette — grouping boxes, leading-course filter, promoted chip — is downstream of the stale groupings, so none of it is trustworthy); the board/grid stays visible (placements are valid). This **removes** the existing scattered `groupings.length === 0` render condition by folding it into the same decision. Reuse the existing compute Action and the sibling `ComputeGroupingsEmptyState`'s busy → inline-error-on-failure → `refreshPage()`-on-success idiom (the plan-detail board mounts no `<Toaster>`, so no sonner here).

### Changes Required:

#### 1. Pure palette-view decision (orchestration seam)

**File**: `src/_pages/plan-detail/model/palette-view.ts`

**Intent**: Make "what does the left column show" a single, tested decision rather than two conditions scattered across `PlannerBoard`'s render. Co-located with the other board guards/transitions in `model/` (per the repo lesson "pure guards/transitions live in `model/`; the component renders"). This is the seam the _next_ palette state plugs into without touching the board's JSX.

**Contract**: Export `type PaletteView = "empty" | "stale" | "ready"` and a pure `resolvePaletteView({ groupingsCount, stale }: { groupingsCount: number; stale: boolean }): PaletteView`. Total precedence: `groupingsCount === 0 → "empty"`, else `stale → "stale"`, else `"ready"`. No imports beyond local types; no I/O.

#### 2. New stale recompute panel

**File**: `src/_pages/plan-detail/ui/GroupingStalePanel.tsx`

**Intent**: Replace the palette when its suggestions are out of date with a panel that explains the situation (board unchanged) and offers Recompute as the single action. Prevents the author from dragging stale suggestions, while keeping the timetable fully visible and interactive.

**Contract**: Default export `GroupingStalePanel({ planId, cohort }: { planId: string; cohort: Cohort })`. It occupies the **same grid column as `PlannerPalette`** — render an `<aside>` with matching sizing (the parent grid is `lg:grid-cols-[20rem_1fr]`) so the layout doesn't shift. Visuals: a `warning`-toned container using semantic tokens (`bg-warning/10`, `text-warning`, `border-warning/50` — mirror the `ErrorBanner` shape), a short message that names both the problem and the reassurance ("Suggestions are out of date. Your placed timetable is unchanged — recompute to refresh the palette."), and a Recompute `Button` whose **accessible name is `Recompute`** (idle) — deliberately distinct from the empty-state's "Compute groupings", so role-based selectors (incl. the Phase 3 E2E) can target it unambiguously. Behavior (a local hook, e.g. `useRecomputeGroupings(planId, cohort)`, in this file below the component — `.tsx` is fine since the file holds JSX): busy flag guards re-entry; on click clear any prior error, then call `computeGroupings({ planId, cohort })` (existing wrapper from `../api/grouping-client`); on `result.error` → set a local `error` string rendered **inline** as `role="alert"` (`text-destructive text-sm`, mirroring `ComputeGroupingsEmptyState` + `ErrorBanner`); on success → `await refreshPage()` (the returning palette is the success signal). Button shows "Recomputing…" + `disabled` while busy. Import `refreshPage` from `@/shared/lib/forms`, `Button` from `@/shared/ui`. **No `sonner`/`toast` import** — the plan-detail board mounts no `<Toaster>` (only the catalog/plans islands do), so a toast would render nowhere; the sibling empty-state uses inline error for exactly this reason. On failure the panel stays put (stale is still true) — the persistent button + inline error give the author a retry.

#### 3. Dispatch the left column from the resolved view

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Replace the two scattered render conditions (the `groupings.length === 0` early return + the would-be stale ternary) with a **single dispatch** over `resolvePaletteView`, mirroring the existing `switch (data.kind)` dispatch in `handleDrop`. The orchestrator decides the view once; each view is a dumb component. `PlannerPalette` needs no new props.

**Contract**: Destructure `stale` from `props` (`PlannerBoard.tsx:39`). Compute `const paletteView = resolvePaletteView({ groupingsCount: groupings.length, stale })` once. Route rendering off it: `paletteView === "empty"` keeps the **existing** empty-state layout (the early `return` of `BoardHeader` + `ComputeGroupingsEmptyState`, `PlannerBoard.tsx:113-122` — composition unchanged, just keyed off the named view instead of the bare `groupings.length === 0` literal); in the grid layout the left column is `paletteView === "stale" ? <GroupingStalePanel planId={planId} cohort={cohort} /> : <PlannerPalette groupings={groupings} names={names} hours={hours} />` (`PlannerBoard.tsx:130`). The right-hand board/grid is unchanged. Import `resolvePaletteView` from `../model/palette-view` and `GroupingStalePanel`. Net: a scattered condition is removed, not added.

#### 4. `PlannerPalette` — no change

**File**: `src/_pages/plan-detail/ui/PlannerPalette.tsx`

**Intent**: Confirmed untouched. The view decision is the board's (via `resolvePaletteView`); the palette stays a pure "render a fresh palette" component. (Listed explicitly so the implementer doesn't add a `stale` prop here.)

**Contract**: No edit.

#### 5. Palette-view unit test

**File**: `src/_pages/plan-detail/model/palette-view.test.ts`

**Intent**: Lock the dispatch decision — the seam's whole value is that it's tested in isolation, so the board's render needs no branching test.

**Contract**: Vitest (node lane, pure). Assert the truth table: `{ groupingsCount: 0, stale: false } → "empty"`, `{ 0, true } → "empty"` (empty wins), `{ 3, true } → "stale"`, `{ 3, false } → "ready"`.

#### 6. Panel component test

**File**: `src/_pages/plan-detail/ui/GroupingStalePanel.test.tsx`

**Intent**: Lock the panel's behavior: it renders the Recompute control, clicking it invokes the compute wrapper and disables the button while busy, and an error result renders inline (board fallback is unaffected because the panel stays).

**Contract**: jsdom lane + `@testing-library/react`. Mock `../api/grouping-client` (`computeGroupings`) and `@/shared/lib/forms` (`refreshPage`). Assert: the message + Recompute button render; clicking calls `computeGroupings` with `{ planId, cohort }`; the button is disabled / shows the busy label during the pending call; an `{ error }` result renders the inline `role="alert"` message and does **not** call `refreshPage`. (The view dispatch is covered by the `palette-view` unit test; the end-to-end swap by Phase 3.)

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm exec astro check`
- Linting passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Unit suite passes (incl. the new `palette-view` + panel tests): `pnpm test`
- Build stays clean: `pnpm build`

#### Manual Verification:

- The `groupings.length === 0` literal is gone from `PlannerBoard`'s render — the empty/stale/ready selection flows through `resolvePaletteView` (read the diff).
- Cohort with stale palette: the `warning` recompute panel **replaces** the palette column (grouping boxes + filter are gone); the grid/board stays visible and interactive (existing placements can still be dragged, weeks set, bundles toggled).
- The empty-state layout is unchanged (no groupings still shows the centered "Compute groupings" prompt, no grid).
- The layout does not shift when the panel replaces the palette (same column width).
- Clicking Recompute shows the busy label, reloads, and the normal palette returns (the returning palette is the success signal; live hash now matches stored).
- Placements are identical before and after recompute (no board change).
- Switching cohorts re-evaluates staleness independently (dp1 can show the panel while dp2 shows its palette, and vice versa).
- A failed recompute surfaces an inline `role="alert"` error and leaves the panel in place for a retry (no `refreshPage`).
- Fresh (unchanged) catalog: the normal palette renders, no panel.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Phase 3: E2E coverage (stale → recompute round-trip)

### Overview

One authenticated Playwright spec proving the full-stack flow the unit and integration tests can't: a real catalog edit makes the rendered board swap the palette for the recompute panel, and a real `/_actions/computeGroupings` round-trip on workerd restores the palette — with a built-in **over-staleness guard** (a freshly computed palette must not render as stale).

### Risk Protected

Staleness wiring only materializes when **auth → SSR load (server hashes the live catalog) → the rendered island branch → a real `/_actions/*` recompute → `refreshPage` re-evaluation** integrate. The unit test mocks the Action; the integration test exercises `isGroupingStale` in isolation. Neither proves:

1. **Over-staleness (the high-value guard):** the load-path hash (computed in `loadPlannerData` from the live catalog) matches the persist-path hash (written by `computeAndPersistGroupings`). If they diverge, a _freshly computed_ palette renders as permanently stale. The spec asserts the panel is **absent** right after compute — this fails loudly if the two hash sites drift.
2. A real catalog edit + reload actually flips the rendered board to the panel (SSR `stale` threading end-to-end).
3. Recompute over real workerd persists and `refreshPage()` brings the normal palette back.

### Changes Required:

#### 1. New E2E spec

**File**: `e2e/specs/grouping-staleness.spec.ts`

**Intent**: Drive the stale→recompute lifecycle through the real UI on workerd, modeled on `cohort-switching.spec.ts` (the closest exemplar: builds catalog across pages, computes groupings, asserts board state). Authenticated `chromium` project (reuses `storageState`); owns a uniquely-named plan and tears it down by deleting it.

**Contract**: A single `test` (configure a raised timeout ~120s — it builds catalog across pages and computes groupings, like the cohort-switching spec). Reuse, do not re-declare: `createPlan`, `createTeacher`, `gotoStable`, `shortId`, `deletePlan` from `../support/planner`; `createCourse`, `createStudent` from `../support/catalog`; `computeGroupings`, `paletteChip`, `display` from `../support/board`. Flow:

1. Provision: a plan, a teacher, one **DP1** course, one DP1 student choosing it (makes it placeable).
2. `gotoStable(/plans/<id>)` → `computeGroupings(page, display(course))` → the course's `paletteChip` is visible.
3. **Over-staleness guard:** assert `getByRole("button", { name: "Recompute", exact: true })` has count 0 (the freshly computed palette is not stale).
4. Make the catalog stale: add a **second** DP1 student choosing the same course (`createStudent` — grows that course's `studentKeys`, so the catalog hash changes).
5. `gotoStable(/plans/<id>)` (reload the board).
6. **Stale assertion:** the `Recompute` button is visible **and** the course's `paletteChip` is absent (the panel replaced the palette).
7. **Recompute:** click `Recompute`; wait for the course's `paletteChip` to reappear (post-`refreshPage`) and the `Recompute` button to be gone.
8. `deletePlan(page, plan.name)`.

Assert business outcomes (panel↔palette swap), not transient state — the returning palette is the success signal, and the failure path's inline error is covered by the Phase 2 unit test — per `e2e/CLAUDE.md` "wait for state, never time."

**Note**: Per-cohort independence (dp1 stale while dp2 isn't) is already covered by `cohort-switching.spec.ts`'s remount proof plus the Phase 1 integration test's per-cohort filter; do **not** duplicate a second cohort here — keep the spec to the single high-value lifecycle. If a board locator or flow step needs a new helper, keep it local to the spec; promote to `support/` only when a second spec needs it (`e2e/CLAUDE.md`).

### Success Criteria:

#### Automated Verification:

- Local Supabase up + `pnpm env:local`; the new spec passes under the real workerd preview: `pnpm test:e2e` (or scoped: `pnpm exec playwright test grouping-staleness`).
- Type checking passes (the spec is type-checked): `pnpm exec astro check`.

#### Manual Verification:

- Watch the spec (or its trace) confirm the panel appears only after the catalog edit, and the palette returns after Recompute.
- The over-staleness assertion (step 3) genuinely guards: temporarily break the load-path hash (e.g. perturb the projection) and confirm the spec fails at step 3 — then revert.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

### Unit Tests:

- `resolvePaletteView` (node, pure): the empty/stale/ready truth table, including empty-wins-over-stale.
- `GroupingStalePanel` (jsdom): renders the Recompute control; click invokes `computeGroupings({ planId, cohort })`; busy state disables the button; an error result renders the inline `role="alert"` message and skips `refreshPage`.

### Integration Tests:

- `isGroupingStale` under the new `{ planId, cohort, catalog }` signature: `false` immediately after compute; `true` after a catalog-affecting mutation.

### E2E Tests:

- `grouping-staleness.spec.ts` (Playwright, workerd): compute → assert no panel (over-staleness guard) → edit catalog → reload → panel replaces palette → Recompute → palette restored. Reuses the `support/{planner,catalog,board}.ts` helpers.

### Manual Testing Steps:

1. Open a plan/cohort with existing groupings; confirm the normal palette renders (fresh).
2. Edit a course or a student choice in that cohort (via the courses/students UI).
3. Reload the board → the palette column is replaced by the "out of date" recompute panel; the grid stays.
4. Confirm existing placements remain draggable/editable while the panel is shown.
5. Click Recompute → busy label → reload → panel gone, normal palette returns, placements unchanged.
6. Switch to the sibling cohort → confirm its staleness is independent (one may show the panel, the other the palette).
7. Simulate a compute failure → confirm an inline `role="alert"` error and the panel stays for a retry.

## Performance Considerations

One extra SHA-256 over the already-loaded catalog plus one single-column `course_groupings` read per board load — sequential after the existing parallel load, guarded behind `groupings.length > 0`. This is off the per-drop validation budget (`<200ms`), which is unaffected. No double `loadCohortCourses` (the whole point of the `isGroupingStale` refactor).

## Migration Notes

None. No schema, migration, RPC, or Action changes. `catalog_hash` already exists on `course_groupings` and is already written by `replace_cohort_groupings`.

## References

- Research: `context/changes/grouping-refresh-stale-version/research.md`
- Decisions: `context/changes/grouping-refresh-stale-version/change.md`
- Detector: `src/_pages/plan-detail/api/staleness.ts:13`
- Load path: `src/_pages/plan-detail/api/load.ts:49,65,80`
- Board props: `src/_pages/plan-detail/model/drag.ts:19`
- Palette: `src/_pages/plan-detail/ui/PlannerPalette.tsx:22`
- Compute client + Action: `src/_pages/plan-detail/api/grouping-client.ts:4`, `api/grouping-actions.ts:5`
- Idiom: `src/shared/lib/forms/use-confirm-action.ts`, `src/shared/lib/forms/refresh-page.ts`
- Hash determinism: `src/shared/lib/catalog-hash/compute-catalog-hash.ts:13`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Load-path wiring (per-cohort `stale` flag)

#### Automated

- [x] 1.1 Type checking passes: `pnpm exec astro check` — e457157
- [x] 1.2 Linting passes: `pnpm lint` — e457157
- [x] 1.3 FSD structure check passes: `pnpm steiger` — e457157
- [x] 1.4 Unit suite passes: `pnpm test` — e457157
- [x] 1.5 Integration suite passes (local Supabase up): `pnpm test:integration` — e457157
- [x] 1.6 Build stays clean: `pnpm build` — e457157

#### Manual

- [x] 1.7 `stale: false` on unchanged catalog; `stale: true` after a catalog edit
- [x] 1.8 No-groupings plan still renders the empty state with no extra query

### Phase 2: Palette-view orchestration + recompute panel

#### Automated

- [x] 2.1 Type checking passes: `pnpm exec astro check` — 763583b
- [x] 2.2 Linting passes: `pnpm lint` — 763583b
- [x] 2.3 FSD structure check passes: `pnpm steiger` — 763583b
- [x] 2.4 Unit suite passes (incl. `palette-view` + panel tests): `pnpm test` — 763583b
- [x] 2.5 Build stays clean: `pnpm build` — 763583b

#### Manual

- [x] 2.6 `groupings.length === 0` literal gone from `PlannerBoard`; empty/stale/ready flow through `resolvePaletteView`
- [x] 2.7 Stale: recompute panel replaces the palette column; grid stays visible/interactive; no layout shift
- [x] 2.8 Empty-state layout unchanged (centered compute prompt, no grid)
- [x] 2.9 Recompute → busy → reload → panel gone, normal palette returns (returning palette = success)
- [x] 2.10 Placements identical before and after recompute
- [x] 2.11 Cohort switch re-evaluates staleness independently (dp1/dp2)
- [x] 2.12 Failed recompute surfaces an inline error and keeps the panel for retry (no refreshPage)
- [x] 2.13 Fresh (unchanged) catalog renders the normal palette, no panel

### Phase 3: E2E coverage (stale → recompute round-trip)

#### Automated

- [x] 3.1 New spec passes on workerd: `pnpm test:e2e` (or `pnpm exec playwright test grouping-staleness`) — 6c6cdca
- [x] 3.2 Spec is type-checked: `pnpm exec astro check` — 6c6cdca

#### Manual

- [x] 3.3 Spec/trace confirms panel appears only after the catalog edit; palette returns after Recompute
- [x] 3.4 Over-staleness guard (step 3) fails if the load-path hash is deliberately broken, then reverted
