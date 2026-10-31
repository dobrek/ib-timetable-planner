<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Viewer Reads Everything Read-Only (S-405)

- **Plan**: context/changes/viewer-read-only/plan.md
- **Scope**: All phases (5 of 5); diff `a988f86..f9fd62c`
- **Date**: 2026-10-31
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical · 5 warnings · 5 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Success criteria evidence

Everything ran on HEAD `f9fd62c` on 2026-10-31:

- `/verify` sequence: `pnpm check` (0 errors), `pnpm lint`, `pnpm steiger`, `pnpm audit` (no unignored high), `pnpm test` (246 files, 2467 tests), `pnpm build`. All pass.
- Integration suites, with the solver up: `generation-read`, `generation-delivery`, `generation-proposal`, `role-matrix`. 4 files, 287 tests, all pass.
- `pnpm test:e2e`, the full suite including `chromium-viewer` and every phase's listed specs: 59/59 pass.
- All 16 Manual rows are checked. Each has dated Playwright evidence in `change.md`, and the user signed them off, so none is a rubber stamp.

## Findings

### F1 — A viewer's in-cell read controls are exposed as disabled

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/_pages/plan-detail/ui/grid/slot-cell/PlacedChip.tsx:76; src/_pages/plan-detail/ui/grid/slot-cell/SlotCell.tsx:85,201; src/_pages/plan-detail/ui/chrome/BoardShell.tsx:85
- **Detail**:
  - **Cause:** dnd-kit's Accessibility plugin (`@dnd-kit/dom/index.js:236-277`) works on every registered draggable, enabled or not. On its activator it sets `tabindex=0`, `role=button` (on the chip), `aria-roledescription=draggable`, an `aria-describedby` with pick-up instructions, and `aria-disabled`.
  - **What a viewer gets:** every viewer cell and chip is a registered, disabled draggable. So each is a tab stop announced as a disabled draggable with instructions to pick it up. The viewer's only in-cell controls inherit the disabled state: Group/Ungroup and "Show collision details".
  - **Evidence:** confirmed in the browser on 2026-10-30 (`change.md` 2.8). Pointer clicks work, but the accessibility tree reports them `[disabled]`.
  - **Against the rules:** this contradicts CLAUDE.md's "absent, never disabled". For authors it already happens in unbundled cells, which is why `e2e/support/board.ts:162-168` clicks with `force: true`.
  - **Pinned by tests:** both viewer specs use `aria-disabled="true"` as their no-drag proof (`read-only.viewer.spec.ts:198`, `generation.viewer.spec.ts:117`), and so does `SlotCell.test.tsx`.
  - **Related, lower stakes:** the read-only availability grid copies `ScheduleGrid`'s ARIA. That gives a `role=grid` with no focusable cell and a header row one column short of the body rows.
- **Fix A ⭐ Recommended**: When `!canEdit`, mount the board's single `DragDropProvider` without the Accessibility plugin (`BoardShell` already passes a customised `PLUGINS` list). Then move the three tests' no-drag proof to behaviour: a stepped drag of a viewer chip leaves it where it was.
  - Strength: One seam, and the author's drag path is untouched. It removes the tab stops, the pick-up instructions and the inherited disabled state for viewers in one place.
  - Tradeoff: The three tests must change their locators and proof, because viewer chips stop presenting as `role=button`. The author-side pre-existing case stays as it is.
  - Confidence: MED — the attribute-writing code and the plugin list are verified, but the change hasn't been run.
  - Blind spot: Whether any other viewer locator or style relies on the plugin's attributes.
- **Fix B**: Render read-only chip and cell variants that never call `useDraggable` (separate components, because of the rules of hooks).
  - Strength: No draggable is registered at all, which gives the cleanest semantics.
  - Tradeoff: Duplicated leaf components that can drift from their editable twins, and a larger diff on the board's hot files.
  - Confidence: MED — straightforward, but `useCellDnd` also registers the droppable, so the cell split needs care.
  - Blind spot: The hook-order constraints inside `SlotCell`.
- **Decision**: FIXED (Fix A). `BoardShell` takes `canEdit`, and a viewer's `DragDropProvider` runs `READ_ONLY_PLUGINS` (the shared list without `Accessibility`). `PlannerBoard` passes `canEdit`.
  - **Unit test:** the new `BoardShell.test.tsx` checks that an editor's disabled draggable is decorated and a viewer's is not, so no `aria-disabled` reaches its read controls. It goes red when the viewer gets the full plugin list.
  - **E2E:** new `readOnlyChip` and `expectNoDrag` helpers in `e2e/support/board.ts`. The tripwire now asserts the viewer's chip is not a `role=button` draggable, and proves by behaviour that it doesn't drag; the proof goes red when viewer chips are made draggable again.
  - **`generation.viewer.spec.ts`:** asserts no draggable semantics only. The solver places that chip, so a drag there can't be checked against a known empty cell.
  - **Unchanged:** the `SlotCell` unit test (it pins the leaf's `disabled` flag) and the pre-existing behaviour in the author's unbundled cells.
  - **Verified:** lint, type check and unit tests (2469) pass; the viewer specs pass twice over; the author drag specs pass (11/11).

### F2 — A viewer's pending page says "could not be read" after an author's visit sweeps the proposal

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/_pages/plan-detail/model/generation/pending-panel.ts:41; src/_pages/plan-detail/model/generation/use-pending-proposal.ts:87
- **Detail**:
  - **What happens:** a successful tick that returns `null` after the store was tracking a job maps to `"unreadable"`: "…could not be read just now — refresh". `isActive(null)` is false, so the poll stops, and a refresh then 404s.
  - **Reachable as the normal ending of three viewer paths**, when an author's visit runs between two viewer ticks:
    - a stalled job with no checkpoint, which the author's visit reclaims and sweeps;
    - a finished job whose delivery fails verification, translation or the empty-result check, so the job is failed and its clone swept;
    - a failed job whose clone the author's visit sweeps.
  - **Already known:** the Phase 1 implementer flagged this as an unhandled edge case.
- **Fix**: Have the store or the dispatch tell "was tracking a job, now null" apart from an unread page. Add a `"removed"` panel ("This proposal was removed — its generation ended without a board", linking to `/plans`), mirroring the SSR route's existing swept notice, and a unit test for stalled → null.
  - Strength: It names the real state instead of advising a refresh that 404s. The route already has the same story for an editor's own visit.
  - Tradeoff: One more `PendingPanel` kind, plus remembering the previous snapshot (in the store or the page).
  - Confidence: HIGH — the sweep paths and the `null` read are verified in `generation-delivery.ts` and `generation-read.ts`.
  - Blind spot: Whether `createPollingStore` can expose the prior snapshot cleanly or the page has to hold it.
- **Decision**: FIXED. `resolvePendingPanel` gains a `"removed"` kind: a `null` read after the page held a job (`tracked`) resolves to it ahead of stranded and unreadable, for editors and viewers alike. A new `useHasTrackedJob` (in `use-pending-proposal.ts`) remembers that a job was held, using React's "information from previous renders" state adjustment, which keeps the island Compiler-clean.
  - **Page:** shows "This proposal's generation ended without a board, so it has been removed." (worded like `SweptProposalNotice.astro`), with no Refresh, since a refresh would 404.
  - **Tests:** `pending-panel.test.ts` gains 2 dispatch cases (gone, and gone on a page the route called stranded). `PendingProposalPage.test.tsx` drives a stalled view, then `null`, through a partial mock of the ticker, for a viewer and an editor. Breaking the dispatch turns 6 tests red; breaking the hook turns 2 red.

### F3 — `generation.viewer.spec.ts` can time out in step 1, and its teardown masks failures

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: e2e/specs/generation.viewer.spec.ts:62-125
- **Detail**:
  - **The race in step 1:**
    - The author's single post-Generate read is rerouted to `readPlanJob`.
    - For an editor, the strip renders nothing for a succeeded, undelivered job (`GenerationStatusStrip.tsx:140` is viewer-only, falling through to `return null` at `:163`).
    - So if the solve (about 0.7 s locally) finishes before that read lands, "Open proposal" never appears and step 1 times out. The source board doesn't poll, so nothing retries it, and a loaded CI runner widens the window.
  - **The teardown:**
    - If step 2 fails, `deletePlan(proposal)` hits the "open it to deliver first" guard (`pending-guards.ts:100-112`) and throws from `finally`. That hides the real failure and skips deleting the source.
    - `createPlan` also runs outside any `try`, so a failure in step 1 leaks the plan (`generation.spec.ts` has the same shape).
  - **Undocumented:** the interception itself is not recorded in the plan or `change.md`. It does not mask a viewer regression, because the viewer's page is never intercepted.
- **Fix**: After the Generate action returns, take the proposal URL from the viewer's hub row, which only reads and never delivers. Wrap everything from `createPlan` in `try`/`finally`. In teardown, open an undelivered proposal as the author before deleting it. Note the interception in `change.md`.
- **Decision**: FIXED.
  - **Step 1:** the author's page now waits for the `startGeneration` response and closes. The viewer takes the proposal's URL from its own hub row, which only reads, so a solve that beats the author's one rerouted read can no longer leave the spec without a link.
  - **Scope and teardown:** everything from `createPlan` sits inside `try`/`finally`. The new `tearDown` opens an undelivered proposal as the author, which delivers it, waits for the board, then deletes the proposal and the source, each only if the hub still lists it.
  - **Documented:** the interception is recorded in `change.md` § Decisions.
  - **Verified:** the viewer project passes 9/9 across three repeats, and `generation.spec.ts` stays green. A forced failure in step 2 reports that failure, not a teardown error, and both plans are still deleted.

### F4 — The status strip's viewer states are an inline if-ladder, and its copy has drifted from the pending page

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/plan-detail/ui/chrome/GenerationStatusStrip.tsx:68,130-131,140
- **Detail**:
  - **The inconsistency:** the pending page chooses its panel through a pure `resolvePendingPanel` in `model/`. The strip picks the same row states (stalled, awaiting an author, halted) through inline `!canEdit &&` branches in the UI file.
  - **Copy drift:** the strip says "an author's visit will settle it", while the pending page says "An author's or admin's visit".
  - **Against preference:** this goes against the user's orchestration-over-patching preference and `ui-conventions.md`'s rule that `model/` owns the decision.
  - **Out of scope here:** `PlannerBoard` also has about 6 inline `canEdit` gates, but the plan prescribed simple unmounting there.
- **Fix**: Extract `resolveSourceStrip(job, canEdit)` into `model/generation/`, test it like `pending-panel.test.ts`, and use "an author or admin" in both places.
  - Strength: One named state per row situation, testable without the DOM, and the copy can't drift again.
  - Tradeoff: It refactors a component that already works and is tested; the editor's states move too.
  - Confidence: HIGH — `pending-panel.ts` is the template in the same folder.
  - Blind spot: None significant.
- **Decision**: FIXED. A new `model/generation/status-strip.ts` holds `resolveStatusStrip(job, canEdit)`. It covers the whole strip, so it is named for the strip rather than the source only.
  - **Kinds:** `provenance` | `stalled` | `active` | `failed` | `halted` | `awaiting-author` | `none`.
  - **Component:** `GenerationStatusStrip` now switches over the resolved kind instead of inline `!canEdit &&` branches. The JSX of each line is unchanged.
  - **Copy:** unified with the pending page. "Stopped reporting progress — an author's or admin's visit will settle it" and "Finished — waiting for an author or admin to open it". The strip test's two copy assertions now use the new wording.
  - **Tests:** the new `status-strip.test.ts` is a 20-case table (each state × editor/viewer); it goes red when the viewer-only `stalled` guard is dropped.
  - **Out of scope:** `PlannerBoard`'s plan-prescribed unmount gates are unchanged.

### F5 — Two convention docs still describe the mechanisms from before S-405

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: context/foundation/ui-conventions.md:247; context/foundation/test-plan.md:369,385
- **Detail**:
  - `ui-conventions.md` still says the board threads "~11 per-cell handlers" through `CellWiring`. It is now the read fields plus an optional `edit` group of six.
  - That file also has no entry for the new binding idioms: the route-computed `canEdit`, and the absent-handler `edit?`.
  - `test-plan.md` still lists "the two setup files" and says the viewer account "arrive[s] with S-405".
  - Lesson: "a convention that cites a code mechanism is coupled to it".
- **Fix**: Update `ui-conventions.md` (the `CellWiring` shape, plus a short note on the route-computed `canEdit` and the absent-handler idiom) and `test-plan.md` (the `chromium-viewer` project, `viewer.setup.ts` and the viewer account).
- **Decision**: FIXED.
  - **`ui-conventions.md`:** the `CellWiring` line now describes the read fields plus the optional `edit` group of six, with current `file:line` cites (`PlannerGrid.tsx:37`, `PlannerBoard.tsx:215`). A new section, "Capability gating (read-only callers)", records five rules:
    - the route-computed `canEdit`;
    - absent, never disabled, through optional handler records;
    - capability-dependent states as `model/` dispatches;
    - write-free reads for non-editors;
    - the read-only board's `READ_ONLY_PLUGINS`.
  - **`test-plan.md`:**
    - the stack table: three setup files, five projects including `chromium-viewer`;
    - §6.3: the `*.viewer.spec.ts` naming bullet, the three-account auth reuse, the S-405 viewer account, and the `readOnlyChip`/`expectNoDrag` helpers;
    - the "Last updated" header.
  - **Left alone:** the table's historical "7 e2e specs" count, which predates this change.

### F6 — `useCombinedBoardState` defaults `canEdit` to `true`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/plan-detail/model/use-cohort-board-state.ts:64
- **Detail**:
  - A positional `canEdit = true` fails open. The harm is small: it only chooses `checkPlan` over `readPlanJob`, and the server answers `FORBIDDEN`.
  - It is inconsistent with `useGenerationJob`, `createPendingProposalStore` and `usePendingProposal`, which require it.
  - The only caller passes it.
- **Fix**: Make the parameter required (`canEdit: boolean`).
- **Decision**: FIXED. `canEdit` is now a required `boolean` and moves to the 4th position, ahead of the defaulted `focus`, `lensCriteria` and `generationJob`, so no caller can fall back to editing. A required parameter after defaulted ones would have forced explicit `undefined`s. Updated: `PlannerBoard`'s call and docblock, and the two `use-cohort-board-state.test.tsx` calls. The type check passes, and the plan-detail tests pass 802/802.

### F7 — `planFileStem` sits in `shared/lib/slugify/`, unrecorded, and its names can be ambiguous

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/shared/lib/slugify/plan-file-stem.ts
- **Detail**:
  - The plan put it in a new `shared/lib/plan-file-stem/` folder. It moved into `slugify/` because a new folder would push `shared/lib` past steiger's 15-module grouping limit.
  - The move is justified, but it is recorded only in the run report, not in the plan or `change.md`.
  - A non-current plan named "X current" exports as `x-current-…`, the same stem as the current plan "X".
- **Fix**: Record the location decision and the accepted naming ambiguity in `change.md` § Decisions.
- **Decision**: FIXED. `change.md` § Decisions now records both points:
  - **The location:** `slugify/` instead of a new folder, because of steiger's 15-module `shared-lib-grouping` limit under `--fail-on-warnings`.
  - **The naming ambiguity, accepted:** "X current" vs the current "X". The file name is a convenience snapshot; the plan's name in the app is the source of truth.

### F8 — A viewer's poll has no ceiling while a job is stalled or waiting

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/plan-detail/model/generation/use-pending-proposal.ts:87,123
- **Detail**:
  - Each tick is narrow: two indexed status reads, plus the source name. The ~124 KB snapshot is read only on the delivered tick.
  - But the poll lives on for as long as the tab is visible and an author hasn't acted, which can be days. An editor's poll ends with the ladder.
  - `plan-brief.md` accepts this as a risk.
- **Fix**: Optionally back off to 30–60 s once the snapshot is stalled or waiting for delivery; otherwise leave it as the accepted risk.
- **Decision**: FIXED, with a 10-minute grace period instead of a flat 30–60 s interval. A flat interval would have broken the plan's "flips within ~5 s" and the viewer spec's 20 s flip timeout.
  - **Behaviour:** a viewer's wait (stalled or awaiting delivery) keeps the 5 s cadence for `WAITING_BACKOFF_AFTER_MS` (10 min), then reads at most once per `WAITING_POLL_INTERVAL_MS` (60 s). An editor's ticker is untouched.
  - **Mechanism:** a tick that isn't due returns the snapshot unchanged without reaching the network, which `createPollingStore`'s `read` contract sanctions, so the shared store needs no change.
  - **Tests:** 3 new store tests, a finished-board wait, a stalled wait and an editor that never backs off. The viewer cases go red when the back-off is disabled.

### F9 — Two components gate capability differently from the rest

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/courses/ui/CourseTable.tsx:25; src/_pages/plan-detail/ui/palette/CombinedPalettePanel.tsx:59
- **Detail**:
  - The board, `StudentTable`, `TeacherTable`, `LinkedBaseList` and `AvailabilityCell` use the absent-handler idiom.
  - `CourseTable` instead takes `canEdit` plus always-present `onEdit`, `onManageMerge` and `onDelete`.
  - `CombinedPalettePanel` hard-codes `canEdit: true` into `resolvePaletteView`.
- **Fix**: Give `CourseTable` an optional `edit` record like the student and teacher tables. Let the panel resolve its own non-hidden view without passing a capability it doesn't know.
- **Decision**: FIXED.
  - **`CourseTable`:** drops `canEdit` and takes `onOpenOverlaps` (always) plus an optional `edit: { onEdit, onManageMerge, onDelete }`. The actions column and row menu render only with `edit`, and the overlap badge's "Manage"/"View" name follows its presence. `CourseCatalog` passes `edit` only when `canEdit`.
  - **Palette:** `palette-view.ts` gains `resolvePaletteContent({ groupingsCount, stale })`, and `resolvePaletteView` is now `canEdit ? resolvePaletteContent(…) : "hidden"`. `CombinedPalettePanel` asks `resolvePaletteContent` instead of passing a made-up `canEdit: true`.
  - **Docs:** `ui-conventions.md`'s idiom list names `CourseTable`'s `edit`.
  - **Not converted:** `StudentTable` and `TeacherTable` keep `canEdit` at table level, because they also gate non-handler controls (selection, New); their row menus already use `edit`.
  - **Verified:** type check, lint and steiger clean; 2502 unit tests pass (4 new `resolvePaletteContent` cases); `CourseTable.test.tsx` unchanged in meaning; the author's course and palette specs and the viewer tripwire pass 9/9.

### F10 — Some viewer-facing copy still speaks to an editor

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/_pages/courses/ui/CourseCatalog.tsx:46; src/_pages/teachers/ui/TeacherCatalog.tsx:47; src/_pages/students/ui/StudentCatalog.tsx:58; src/_pages/plans-list/model/generation-toasts.ts; src/_pages/plan-detail/ui/chrome/GenerationStatusStrip.tsx:105
- **Detail**: The plan didn't cover these strings, which a viewer still sees:
  - the catalogs' "Manage …" subtitles;
  - the hub toast "Proposal ready" for a job that is still undelivered;
  - the strip's running line, "you can leave the page".

  The hub subtitle and the pending page were adjusted; these were not.
- **Fix**: Give each a viewer variant, chosen from `canEdit` (which these islands already receive).
- **Decision**: FIXED.
  - **Catalogs:** the subtitles read "The plan's cross-cohort course catalog." / "Teachers and their course assignments." / "Students and their course choices." for a viewer.
  - **Hub toast:** a non-editor watching a job finish undelivered gets "Proposal finished — waiting for an author" (a `headline` helper in `generation-toasts.ts`). It still says "Proposal ready" once delivered, and an editor's headline is unchanged.
  - **Strip:** the running line drops "— you can leave the page" for a viewer.
  - **Tests:** 3 new toast tests and 1 strip test, each red when broken. The catalog subtitles are plain ternaries with no new test.

## Triage summary (2026-10-31)

| Decision | Findings |
|---|---|
| Fixed | F1 (Fix A), F2, F3, F4, F5, F6, F7, F8, F9, F10 |
| Skipped | none |

Verified with every fix in, on a fresh build:
- `/verify`: install, astro sync, check (0 errors), lint, steiger, audit, test (2506), build. PASS.
- Integration suites `generation-read`, `generation-delivery`, `generation-proposal` and `role-matrix`, with the solver up: 287/287.
- `pnpm test:e2e`, the full suite including `chromium-viewer`: 59/59.
