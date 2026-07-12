# Bulk Course-Choice Editing for Multiple Students — Implementation Plan

## Overview

Add a bulk course-choice editor to the students catalog: select multiple students in the active cohort tab (checkbox column + select-all), then apply "add course set X / ensure course set Y absent" in one operation through a new atomic `bulk_edit_student_choices` RPC. The literal user story — filter to Math SL choosers, add TOK1, ensure no TOK2 — becomes one filter + select-all + one dialog invocation.

## Current State Analysis

Grounded in `context/changes/changing-courses-for-multiple-students/research.md` (same commit, read fully):

- **Domain model is already sufficient.** `student_choices (student_id, course_id, plan_id)` with UNIQUE `(student_id, course_id)` and composite FKs to plan-pinned students/courses. Add = insert-if-absent; remove = delete-if-present. No schema change needed.
- **Filtering is solved.** `filterStudents` (`src/_pages/students/model/filter-students.ts:9-24`) already narrows by course-choice intersection via the `CourseFilter` MultiSelect — the "who has Math SL" step exists and is tested.
- **No row selection exists anywhere in the slice.** `StudentTable.tsx` is purely presentational; the shadcn `Table` primitive already carries `[role=checkbox]` head/cell styling and `data-[state=selected]:bg-muted` row styling, unused today.
- **Mutation seam is uniform.** Every student mutation is `defineDomainAction` (shared Zod schema) → framework-free domain fn → typed `student-client.ts` wrapper; forms refresh via `refreshPage()` loader re-run, no client patching.
- **Atomic multi-row junction writes have a house pattern**: validation-free plpgsql RPC called after TS-side gates — `replace_course_teachers` (`supabase/migrations/20260620120001_replace_course_teachers_fn.sql`), `apply_generated_placements`, etc. All `security invoker` + `set search_path = ''` + `public.`-qualified.
- **Downstream ripple is already handled**: stale `course_groupings` are caught by the `catalog_hash` staleness banner; all constraint validation is live-derived from choices at board load. The one amplified (pre-existing) gap is silent validation drift on already-placed boards — addressed here with a lightweight hint only (decided).

## Desired End State

On `/plans/[id]/students`, each cohort tab's table has a checkbox column with a header select-all (indeterminate when partial). Selecting rows reveals a bulk-action bar ("N selected · Edit choices… · Clear"). The bulk dialog offers two cohort-scoped course pickers — **Add courses** and **Remove courses** (either may be used alone) — then a confirmation step showing the computed effect ("Add TOK1 — 19 of 23 will gain it · Remove TOK2 — 4 will lose it") together with a persistent drift-hint line ("review plan boards for new conflicts afterwards") before applying atomically. On success a plain toast confirms, the page loader re-runs via a full navigation, and the island remount clears the selection.

Verify by: the new `e2e/specs/bulk-edit-choices.spec.ts` driving the literal story end-to-end on workerd against local Supabase (filter → select all → add TOK1, remove TOK2 → confirm → badge assertions), plus green `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, and the `/verify` gate.

### Key Discoveries:

- `radix-ui` v1.6.0 (unified package, already installed) exports `Checkbox` — the new shared primitive needs **no new dependency** (template: `src/shared/ui/switch.tsx`).
- The RPC needs **no cohort parameter**: following the `replace_course_teachers` precedent, validation stays in TS (`assertChoicesInCohort` + a new students-side twin) and the composite FK `(plan_id, student_id) → students(plan_id, id)` backstops cross-plan injection inside the transaction.
- `submitForm` (`src/shared/lib/forms/submit-form.ts`) already provides the exact error routing + success-toast + `refreshPage()` flow the dialog needs. But `refreshPage()` is a **full browser navigation** (no `<ClientRouter />` exists anywhere in `src/`), which replaces the document and the island-mounted Toaster — a success toast is a sub-second flash and cannot carry instructions. The drift hint therefore lives in the dialog's confirmation step, not the `successMessage`.
- Selection state must clear on **any** filter change (decided: WYSIWYG). Clearing is derived from the filter *values* — one mechanism covers every change source, including `setActiveCohort`'s coupled `courseIds` reset — rather than wrapping each setter. (`useUrlSyncedFilters` mirrors state out via `history.replaceState` only; back/forward is a full page load that remounts the island, so setters are in fact the only in-island change source.)
- The catalog loader's truncation guard is currently unreachable: it fires at ≥2000 rows (`src/_pages/students/api/loader.ts:18,70-76`) but PostgREST caps every response at 1000 (`supabase/config.toml:18` `max_rows`) — past 1000 choices the read silently truncates. Bulk adds grow that count, so Phase 2 aligns `CHOICES_LIMIT` to the real 1000 ceiling (loud failure); pagination and the identically-capped, unguarded `load-cohort-courses.ts` read stay out of scope.

## What We're NOT Doing

- **No proactive conflict computation** after a bulk edit (decided: lightweight hint only). The board's live validation remains the sole conflict authority; a follow-up change can add proactive detection.
- **No cross-cohort selection** — selection is bound to the active cohort tab by construction.
- **No undo** — the confirmation summary is the safety mechanism.
- **No first-class "replace X with Y" mode** — the `{add, remove}` primitive covers it; presets can come later if the pattern proves common.
- **No grouping invalidation code** — the existing `catalog_hash` staleness banner already covers it.
- **No change to single-student editing** — `updateStudent` keeps its non-atomic diff path. Its stale docblock is corrected in Phase 2 (required, one line): it claims a "no new Postgres functions" project rule that this change directly disproves.
- **No raise of the loader's choices cap and no pagination.** In scope instead: aligning the guard threshold to the effective PostgREST `max_rows = 1000` ceiling (Phase 2) so truncation fails loudly — today the ≥2000 guard is unreachable and truncation past 1000 is silent. The unguarded `load-cohort-courses.ts` read shares the cap; explicit follow-up.
- **No server-side merge-parent exclusion** — the dialog's pickers exclude merge-parent courses client-side; `assertChoicesInCohort` checks plan + cohort + existence only, so a crafted call can attach a merge-parent choice. Accepted as parity with the existing single-student path (same gate); closing both paths at once is a possible follow-up.

## Implementation Approach

Three phases, backend-first, each independently verifiable:

1. **Persistence**: one migration adding a validation-free, atomic `bulk_edit_student_choices` plpgsql function (idempotent insert via `on conflict do nothing`, then set delete, one transaction), regenerate DB types, prove SQL-level behavior with a raw-RPC integration test.
2. **Action layer**: shared `bulkChoiceInput` Zod schema, a framework-free `bulkEditChoices` domain fn (TS cohort gates for both the add-courses and the selected students, then the RPC), action registration, typed client wrapper, and the pure confirmation-summary helper — unit + integration tested.
3. **UI**: shared `Checkbox` primitive, `useCatalogSelection` hook (cohort- and filter-scoped, WYSIWYG clearing), checkbox column + select-all in `StudentTable`, bulk-action bar, and `BulkChoiceDialog` (pickers → confirmation summary → apply → refresh + drift-hint toast) — closed out by a Playwright E2E spec that gates the happy-path story and selection-clearing in CI.

## Critical Implementation Details

- **Selection clearing is value-derived, not setter-wrapped.** `useCatalogSelection` observes the filter values (cohort, query, courseIds) — e.g. keyed off a serialized filter signature — and clears when any of them change. One mechanism covers every change source, including `setActiveCohort`'s coupled `courseIds` reset, with no setter wrapping in `StudentCatalog`. (Setters are the only in-island change source: `useUrlSyncedFilters` uses `history.replaceState` without a popstate listener, so back/forward is a full page load that remounts the island.)
- **The RPC is deliberately validation-free** (mirrors `replace_course_teachers`): the TS domain fn is the authoritative gate, and the composite FKs reject cross-plan rows *inside* the transaction, so a crafted call cannot partially apply. Do NOT add `security definer`.
- **Insert before delete inside the function** — same partial-visibility principle as `updateStudent`, though here both run in one transaction so ordering is about consistency of the SQL with the house pattern, not failure windows.
- **Post-apply selection clearing comes free** — `refreshPage()` is a full browser navigation (no `<ClientRouter />` in the app), so the island remounts and every piece of ephemeral state, selection included, is discarded. Don't build clearing logic that assumes the island survives the refresh; an explicit `clear()` before `refreshPage()` is optional belt-and-braces.

## Phase 1: Atomic Persistence Layer

### Overview

Create the `bulk_edit_student_choices` RPC, regenerate database types, and prove idempotence/atomicity at the SQL level.

### Changes Required:

#### 1. Migration: `bulk_edit_student_choices` function

**File**: `supabase/migrations/<timestamp>_bulk_edit_student_choices_fn.sql` (via `pnpm exec supabase migration new bulk_edit_student_choices_fn`)

**Intent**: One transaction that adds a course set to every listed student (skipping rows that already exist) and removes another course set from all of them — the atomic write the bulk edit rides on.

**Contract**: `bulk_edit_student_choices(p_plan_id uuid, p_student_ids jsonb, p_add_course_ids jsonb, p_remove_course_ids jsonb) returns void`, `language plpgsql`, `security invoker`, `set search_path = ''`, all tables `public.`-qualified. Body: (1) `insert into public.student_choices (plan_id, student_id, course_id) select` the cross join of the two jsonb arrays (`jsonb_array_elements_text(...)::uuid`) `on conflict (student_id, course_id) do nothing`; (2) `delete from public.student_choices where plan_id = p_plan_id and student_id in (…) and course_id in (…)`. `coalesce(…, '[]'::jsonb)` both course arrays. Docblock states the validation-free contract (TS gates + composite-FK backstop) and cites `replace_course_teachers` as precedent, per the "Re-create SQL functions from the latest live definition" lesson.

#### 2. Regenerated database types

**File**: `src/shared/api/database.types.ts`

**Intent**: Surface the new function in the generated `Database` type so `supabase.rpc("bulk_edit_student_choices", …)` is typed.

**Contract**: `pnpm exec supabase gen types typescript --local > src/shared/api/database.types.ts` after `supabase db reset`; diff should show only the new function entry.

#### 3. Raw-RPC integration test

**File**: `src/_pages/students/api/bulk-edit-choices.integration.test.ts`

**Intent**: Prove SQL-level behavior independent of the TS wiring: add is idempotent across students that already hold a choice, remove deletes only listed pairs, add+remove compose in one call, and a cross-plan student id fails the whole call atomically (FK) leaving no partial writes.

**Contract**: Mirrors `students-crud.integration.test.ts` — service-role client, `createPlan` + `seedPlanCatalog` + `addStudentWithChoices` factories, `teardown` in `afterAll`, env-gated `describe.skip`. Calls `supabase.rpc("bulk_edit_student_choices", …)` directly (precedented by the `clone_plan` raw-RPC tests).

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly: `pnpm exec supabase db reset`
- Type-check clean over regenerated types: `pnpm check`
- Build passes: `pnpm build`
- Integration tests pass: `pnpm test:integration`
- Lint passes: `pnpm lint`

#### Manual Verification:

- Function visible and callable in local Supabase Studio; a hand-run call against seeded data behaves idempotently

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Server Action + Client Wrapper

### Overview

Expose the RPC as a `bulkEditChoices` Astro Action following the slice's exact recipe, plus the pure confirmation-summary helper the dialog will need. Two small in-slice corrections ride along: aligning the loader's truncation guard to the effective PostgREST cap, and fixing the stale `update-student.ts` docblock.

### Changes Required:

#### 1. Shared schema

**File**: `src/_pages/students/model/schemas.ts`

**Intent**: One `bulkChoiceInput` Zod schema shared by the action gate and the RHF resolver.

**Contract**: `{ planId: z.uuid(), cohort: cohortSchema, studentIds: z.array(z.uuid()).min(1, …).max(500, …), addCourseIds, removeCourseIds }` — both course arrays modeled on the existing `choiceCourseIds` field (`.max(64)`, `.default([])`, dedupe transform). Two cross-field refinements: at least one course across add+remove ("Pick at least one course to add or remove", anchored to `addCourseIds`), and no id present in both sets ("A course can't be both added and removed", anchored to `removeCourseIds`). Export `BulkChoiceFormValues` (`z.input`) and `BulkChoiceInput` (`z.output`). Extend `schemas.test.ts` for the refinements and dedupe.

#### 2. Students-side cohort gate

**File**: `src/_pages/students/api/assert-students-in-cohort.ts`

**Intent**: The selected-students twin of `assertChoicesInCohort`: every submitted student id must exist in the plan and match the cohort — a stale or crafted call must not edit other-cohort or other-plan students.

**Contract**: Same shape as `assert-choices-in-cohort.ts:12-29` (query `students` by `plan_id` + `in("id", …)`, compare cohort, throw `DomainError("BAD_REQUEST", …)`); message constant added to `api/constants.ts`. No-op is impossible (schema enforces `min(1)`), but keep the early-return guard for symmetry.

#### 3. Domain function

**File**: `src/_pages/students/api/bulk-edit-choices.ts`

**Intent**: The framework-free orchestration: gate students and add-courses against plan+cohort, then invoke the atomic RPC.

**Contract**: `bulkEditChoices(supabase, input: BulkChoiceInput): Promise<void>` — `assertStudentsInCohort(...)`, `assertChoicesInCohort(supabase, planId, cohort, addCourseIds)` (remove ids need no cohort gate: deleting a pair that can't exist is a no-op, and the delete is plan-pinned), then `supabase.rpc("bulk_edit_student_choices", { p_plan_id, p_student_ids, p_add_course_ids, p_remove_course_ids })` with the arrays passed as JSON; RPC error → `DomainError("INTERNAL_SERVER_ERROR", …)`. No CONFLICT mapping — `on conflict do nothing` makes concurrent overlapping adds benign.

#### 4. Action registration + client wrapper

**Files**: `src/_pages/students/api/actions.ts`, `src/_pages/students/api/student-client.ts`, `src/_pages/students/api/index.ts`

**Intent**: Wire the new mutation through the established seam.

**Contract**: `bulkEditChoices: defineDomainAction({ input: bulkChoiceInput, run: bulkEditChoices })` in `studentActions` (top barrel already spreads it); one-line `bulkEditChoices = (values) => callAction(actions.bulkEditChoices, values)` wrapper; barrel exports as the slice currently does.

#### 5. Confirmation-summary helper

**File**: `src/_pages/students/model/summarize-bulk-choices.ts` (+ co-located test)

**Intent**: Pure computation of the confirmation step's content from already-loaded data — the safety mechanism replacing undo.

**Contract**: `summarizeBulkChoices(students: readonly StudentRow[], addCourseIds: readonly string[], removeCourseIds: readonly string[])` → per add-course `{ courseId, gains }` (students currently missing it) and per remove-course `{ courseId, losses }` (students currently holding it). Zero counts are meaningful output ("0 students have TOK2" is the story's assurance) — never filtered out.

#### 6. Domain-fn integration coverage

**File**: `src/_pages/students/api/bulk-edit-choices.integration.test.ts` (extends Phase 1's file)

**Intent**: Prove the TS gates: cross-cohort add-course rejected, cross-cohort/cross-plan student rejected, happy path adds+removes across several students, and rejected calls leave prior state untouched.

**Contract**: Drives `bulkEditChoices(supabase, …)` directly, same harness as Phase 1.

#### 7. Loader truncation-guard alignment

**File**: `src/_pages/students/api/loader.ts`

**Intent**: Make the existing truncation guard reachable — it fires at ≥2000 rows while PostgREST caps every response at 1000 (`supabase/config.toml:18` `max_rows`), so past 1000 choices the read silently truncates instead of refusing loudly.

**Contract**: Set `CHOICES_LIMIT` to 1000 (the effective PostgREST ceiling) so `assertChoicesNotTruncated` fires at the real cap. No pagination, no cap raise. The same silent ceiling on the unguarded `load-cohort-courses.ts` read (board-validation input) is out of scope — explicit follow-up.

#### 8. Stale docblock correction (required drive-by)

**File**: `src/_pages/students/api/update-student.ts`

**Intent**: The docblock claims the project "rules out … no new Postgres functions" — this change ships the direct counterexample in the same slice; leaving the false project-rule claim invites future plans to inherit it (lessons.md: stale-mechanism propagation).

**Contract**: One-line correction: the non-atomic diff path is a per-change tradeoff, not a project rule; atomic set-writes go through plpgsql RPCs (`replace_course_teachers`, `bulk_edit_student_choices`).

### Success Criteria:

#### Automated Verification:

- Unit tests pass (schema refinements, summary helper): `pnpm test`
- Integration tests pass (domain-fn gates + happy path): `pnpm test:integration`
- Type-check clean: `pnpm check`
- Lint + FSD structure pass: `pnpm lint && pnpm steiger`
- Build passes: `pnpm build`

#### Manual Verification:

- (None — this phase has no user-visible surface; manual checks land in Phase 3)

**Implementation Note**: Automated verification is sufficient to proceed; confirm with the human only if anything deviated from plan.

---

## Phase 3: Catalog Selection UI + Bulk Dialog

### Overview

The user-visible feature: row selection, bulk-action bar, and the add/remove dialog with confirmation summary.

### Changes Required:

#### 1. Shared `Checkbox` primitive

**File**: `src/shared/ui/checkbox.tsx` (+ export from `src/shared/ui/index.ts`)

**Intent**: The one missing primitive for row selection, with indeterminate support for the header select-all.

**Contract**: Wraps `Checkbox` from the installed unified `radix-ui` package (no new dependency), templated on `switch.tsx` — semantic tokens only (`bg-primary`/`border-input`/`text-primary-foreground` class family), `data-slot` attribute, supports `checked: boolean | "indeterminate"`. Per the "Detokenize shadcn primitives on add" lesson.

#### 2. Selection hook

**File**: `src/_pages/students/model/use-catalog-selection.ts` (+ co-located test for any extracted pure logic)

**Intent**: Own the ephemeral selected-student set, scoped to the current filter view (decided: WYSIWYG — cleared on any cohort/query/course-filter change).

**Contract**: `useCatalogSelection(filterSignature: string)` → `{ selectedIds: ReadonlySet<string>, toggle(id), toggleAll(visibleIds: readonly string[]), clear() }`. `toggleAll` selects all visible rows, or clears them when all are already selected. Clearing on filter change is derived from the `filterSignature` value (serialize cohort + query + sorted courseIds in `StudentCatalog`), not from wrapping setters — one mechanism for every change source (back/forward is a full page load, so setters are the only live change source anyway).

#### 3. Table selection column

**File**: `src/_pages/students/ui/StudentTable.tsx`

**Intent**: Checkbox column + header select-all (indeterminate when partial), keeping the component presentational.

**Contract**: New props `{ selectedIds: ReadonlySet<string>, onToggleRow(id), onToggleAll() }` alongside the existing ones; header `TableHead` hosts the select-all `Checkbox` (checked / indeterminate / unchecked from `selectedIds` vs `rows`), each body row a `Checkbox` cell with an accessible label naming the student; selected rows get `data-state="selected"` (styling already present in `table.tsx`). Row-checkbox clicks must not trigger the name link.

#### 4. Bulk-action bar

**File**: `src/_pages/students/ui/BulkActionBar.tsx`

**Intent**: Persistent visibility of the true selection count (the count is the only live indicator once WYSIWYG clearing keeps hidden selections impossible) and the entry point to the dialog.

**Contract**: Renders only when `selectedIds.size > 0`, between the filter row and `Tabs` in `StudentCatalog.tsx`: "N selected" + "Edit choices…" `Button` + "Clear selection" ghost button. Presentational; callbacks from the island.

#### 5. Bulk-edit dialog

**File**: `src/_pages/students/ui/BulkChoiceDialog.tsx`

**Intent**: The two-step add/remove flow: pick courses (either picker alone is valid), review the computed effect, confirm.

**Contract**: Cloned from the `StudentFormDialog` shell (Dialog + RHF + `zodResolver(bulkChoiceInput)` + `submitForm`). Step 1: two `MultiSelect` pickers ("Add courses", "Remove courses"), both scoped to the active cohort's real (non-merge-parent) courses — the full cohort list for both, so "ensure absent" works even when no selected student holds the course. Step 2 (internal `"edit" | "confirm"` state): renders `summarizeBulkChoices` output as lines like "Add TOK1 — 19 of 23 students will gain it" / "Remove TOK2 — 4 students will lose it (19 don't have it)", plus a persistent drift-hint line — e.g. "Applying may create new conflicts on plan boards — review them afterwards."; Back returns to step 1. Confirm submits via `submitForm` with a plain `successMessage` ("Choices updated for 23 students") — the toast is only a pre-navigation flash and must not carry instructions. On success: dialog closes, `refreshPage()` re-runs the loader via a full navigation (filters persist in the URL; the island remount clears the selection).

#### 6. Island wiring

**File**: `src/_pages/students/ui/StudentCatalog.tsx`

**Intent**: Compose the new hook, bar, table props, and dialog without disturbing the existing one-hook-per-flow layout.

**Contract**: `useCatalogSelection(filterSignature)` beside the existing hooks; bulk-dialog open state joins `useCatalogDialogs`; selected `StudentRow[]` (resolved from `selectedIds` against the active cohort's rows) feeds the dialog for the summary; `planId` + `activeCohort` seed the submit values.

#### 7. E2E spec

**File**: `e2e/specs/bulk-edit-choices.spec.ts`

**Intent**: Permanent CI regression gate for the two behaviors only a browser can verify: the full happy-path story across selection → dialog → confirm → refresh, and WYSIWYG selection-clearing over URL-synced filter state.

**Contract**: Authenticated project, following `e2e/CLAUDE.md` rules — reuse `support/planner.ts` (`createPlan`, `gotoStable`, `shortId`, `deletePlan`) and `support/catalog.ts` (`createCourse`, `createStudent`, `pickInMultiSelect`); role-based locators only; unique-suffixed entities; teardown via plan-delete cascade. Two independent tests:
1. **Happy-path story**: seed one plan with three dp1 courses (stand-ins for Math SL / TOK1 / TOK2) and three students — two choosing "Math" (one of them also "TOK2"), one bystander choosing neither. Filter by the "Math" course, select all (2 rows), bulk-add "TOK1" + bulk-remove "TOK2", assert the confirmation step surfaces the gain/loss counts **and the drift-hint line**, apply, then assert: both selected students' rows show the TOK1 badge and no TOK2 badge; the bystander's choices are untouched; the selection bar is gone (the full-page refresh remounts the island). No toast assertion — toasts don't survive the post-apply navigation.
2. **Selection-clearing (WYSIWYG)**: select rows, then change the search text and assert the bulk bar disappears; re-select, change the course filter, assert cleared again. Assertions target the bar's count text (business outcome), not component internals.

New feature-specific locator helpers (choice-badge lookup within a row, bulk-bar locator) stay local to the spec; promote to `support/` only when a second spec needs them.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`
- Lint + FSD structure pass: `pnpm lint && pnpm steiger`
- Build passes: `pnpm build`
- E2E suite passes incl. the new spec: `pnpm test:e2e` (local Supabase + `pnpm env:local` required)
- Full local CI gate green: `/verify`

#### Manual Verification:

- Add-only and remove-only invocations both work; submitting with neither picker filled is blocked with an inline message
- Confirmation step counts are correct, including the "0 students have X" assurance case (zero-count line rendered, not hidden)
- Cohort tab switch clears the selection; select-all shows indeterminate state on partial selection
- A plan board opened after a bulk edit shows any new student conflicts via existing live validation (the drift-hint line is E2E-asserted in the confirmation step; the board consequence is checked here)
- Keyboard/screen-reader pass: checkboxes labeled per student, select-all labeled, dialog focus behaves like existing dialogs

**Implementation Note**: The happy-path story, post-apply selection clearing, and search/course-filter clearing are now E2E-gated — the manual checklist covers only what the spec deliberately leaves out. After automated verification passes, pause for manual confirmation of the remaining items.

---

## Testing Strategy

### Unit Tests:

- `schemas.test.ts` — `bulkChoiceInput`: dedupe transforms, `min(1)` students, empty-both-pickers refinement, add/remove overlap refinement
- `summarize-bulk-choices.test.ts` — gains/losses counting incl. all-already-have, none-have (zero counts preserved), and mixed sets
- Any pure logic extracted from `use-catalog-selection` (toggle-all semantics)

### Integration Tests:

- `bulk-edit-choices.integration.test.ts` — raw RPC: idempotent add over pre-existing choices, scoped delete, add+remove in one call, cross-plan FK atomic rejection; domain fn: cohort gates for students and add-courses, rejected call leaves state untouched, multi-student happy path

### E2E Tests (Playwright, `pnpm test:e2e`):

- `e2e/specs/bulk-edit-choices.spec.ts` — the browser-only risks: (1) happy-path story end-to-end (filter → select-all → add/remove → confirmation counts + drift-hint line → apply → badge assertions + bystander untouched + selection cleared); (2) WYSIWYG selection-clearing on search and course-filter changes. Runs on real workerd against local Supabase, same CI gate as the existing 20+ specs.
- Deliberately not E2E'd (manual or lower-layer instead): zero-count assurance rendering, cohort-tab clearing, indeterminate select-all visuals, accessibility, board-conflict consequence — low regression risk or already unit/integration-covered logic.

### Manual Testing Steps:

1. `pnpm exec supabase db reset && pnpm dev`, open a seeded plan's students page
2. Exercise add-only and remove-only invocations; verify empty-both is blocked inline and the zero-count assurance line renders in the confirmation step
3. Verify cohort-tab switch clears selection and select-all shows indeterminate on partial selection
4. Open the plan board afterwards and confirm live validation reflects the new choices (and the groupings staleness banner appears if groupings were computed)

## Performance Considerations

The write is a single RPC round-trip regardless of selection size; the confirmation summary is O(students × courses) over already-loaded ids — negligible at catalog scale. No impact on the <200ms placement-validation budget (that path derives from the live catalog and is untouched). The effective scale ceiling is PostgREST's `max_rows = 1000` per read; Phase 2 aligns the loader guard to it so hitting the ceiling fails loudly. Bulk adds approach it faster; pagination and the identically-capped `load-cohort-courses.ts` read stay out of scope (explicit follow-up).

## Migration Notes

Purely additive migration (one new function, no table changes) — safe for CI's `supabase db push` on merge. Rollback = code rollback; the unused function is harmless if left behind.

## References

- Related research: `context/changes/changing-courses-for-multiple-students/research.md`
- Atomic-RPC precedent: `supabase/migrations/20260620120001_replace_course_teachers_fn.sql:1-33`
- Single-student diff path being generalized: `src/_pages/students/api/update-student.ts:18-56`
- Cohort gate to mirror: `src/_pages/students/api/assert-choices-in-cohort.ts:12-29`
- Dialog shell to clone: `src/_pages/students/ui/StudentFormDialog.tsx`
- Integration-test harness to mirror: `src/_pages/students/api/students-crud.integration.test.ts`
- Grouping staleness prior art: `context/archive/2026-06-24-grouping-refresh-stale-version/research.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Atomic Persistence Layer

#### Automated

- [x] 1.1 Migration applies cleanly: `pnpm exec supabase db reset` — 31d91f9
- [x] 1.2 Type-check clean over regenerated types: `pnpm check` — 31d91f9
- [x] 1.3 Build passes: `pnpm build` — 31d91f9
- [x] 1.4 Integration tests pass: `pnpm test:integration` — 31d91f9
- [x] 1.5 Lint passes: `pnpm lint` — 31d91f9

#### Manual

- [x] 1.6 Function callable in local Studio; hand-run call behaves idempotently — 31d91f9

### Phase 2: Server Action + Client Wrapper

#### Automated

- [x] 2.1 Unit tests pass (schema refinements, summary helper): `pnpm test` — 6f2dff5
- [x] 2.2 Integration tests pass (domain-fn gates + happy path): `pnpm test:integration` — 6f2dff5
- [x] 2.3 Type-check clean: `pnpm check` — 6f2dff5
- [x] 2.4 Lint + FSD structure pass: `pnpm lint && pnpm steiger` — 6f2dff5
- [x] 2.5 Build passes: `pnpm build` — 6f2dff5

### Phase 3: Catalog Selection UI + Bulk Dialog

#### Automated

- [x] 3.1 Unit tests pass: `pnpm test`
- [x] 3.2 Lint + FSD structure pass: `pnpm lint && pnpm steiger`
- [x] 3.3 Build passes: `pnpm build`
- [x] 3.4 E2E suite passes incl. `bulk-edit-choices.spec.ts`: `pnpm test:e2e`
- [x] 3.5 Full local CI gate green: `/verify`

#### Manual

- [x] 3.6 Add-only / remove-only work; empty-both blocked inline
- [x] 3.7 Confirmation counts correct incl. zero-count assurance case
- [x] 3.8 Cohort switch clears selection; indeterminate select-all on partial selection
- [x] 3.9 Board live validation reflects new choices after a bulk edit
- [x] 3.10 Accessibility pass (labeled checkboxes, dialog focus)
