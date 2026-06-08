# Course Merge Builder Implementation Plan

## Overview

Close the loop on S-02 (FR-003) by shipping the **merge builder** that was deferred from the Course Catalog slice. The builder lets an author compose **2+ atomic child courses** into a **virtual composite merge parent** — a course row carrying the derived composite level (`AB+SL`), the shared teacher, an independently-authored weekly-hours value, and **zero student choices** — by writing only the parent `courses` row and the `course_merges` link rows. Nothing downstream (grouping algorithm, validator, placements) changes, because they already consume merges correctly as long as the parent is produced in the seed's shape.

The slice ships **Option A** (a dedicated builder dialog + a "Manage merge" kebab affordance) plus one adjacent fix: persisting the catalog's filter state across the post-mutation `navigate()` reload.

## Current State Analysis

The merge model and the entire read path already exist; the builder is **pure UI + a thin mutation layer with no migration**:

- **Domain model is settled** (`research.md:40-71`). Parent = virtual composite (0 choices), holds derived `level`, the shared `teacher_id`, and an independently-authored `hours_per_week`. Children = atomic, student-chosen, keep their own real hours (incl. a deliberate `0` for "taught only inside the merged session"). Children are identified via `course_merges`, **never** via `hours = 0`.
- **Grouping already consumes this shape** (`src/lib/grouping/adapters/supabase.ts:45-58`): it builds one virtual course per merge parent from `parent.teacher_id`, `parent.hours_per_week`, and the union of children's students; regular courses are only those with direct choices, so a 0-choice parent is correctly excluded as regular and added as virtual. Zero-hours warnings are suppressed for merge children (`:158-172`). **No algorithm change is needed.**
- **Read path** (`src/pages/courses.astro:20-43,64`): five parallel Supabase loads; the merge query currently selects **only `parent_course_id`** (`:28`) and sets `isMerged = mergeParentIds.has(c.id)`. To show a parent's children in the manage dialog, the query must also select `child_course_id`.
- **CRUD convention** (`src/actions/index.ts`): every handler is `defineAction({ input: <zod>, handler })` + `requireSession` + `requireSupabase` + `23505 → CONFLICT`. `createOverlap` (`:111-149`) pre-fetches both courses and enforces **same cohort** — the exact pattern merge validation mirrors. The deferral is documented at `:32-35`.
- **UI reuse surface**: `CourseCatalog.tsx` header (`:70-79`) is the home for a "New merge" sibling button; dialogs mount once at island root and open via state (`:122-146`); the row kebab `CourseRowActions` (`:248-282`) is where a "Manage merge" item goes. `TeacherFilter.tsx` is a verbatim popover+command multi-select precedent. `CourseFormDialog.tsx:60-121` is the RHF + `zodResolver` + shared-schema + `navigate()` form pattern. `DeleteCourseDialog.tsx` is the `alert-dialog` confirm pattern for dissolve.
- **Filter state is unbacked** (`CourseCatalog.tsx:43-45`): `activeCohortId`, `selectedTeacherIds`, `hideMerged` are client-side `useState` with no URL backing, and `courses.astro` reads no search params. So `navigate(pathname + search)` after any create/edit/delete **resets all of it to defaults**. The merge dialog would inherit this; Phase 5 fixes it for the whole catalog.

## Desired End State

From the `/courses` screen, an author can:

1. Click **New merge** (beside New course) to open a dialog scoped to the active cohort, multi-select 2+ atomic children, see the parent **name + composite level + teacher** derived live and read-only, enter weekly hours, and confirm — creating the composite parent (badged "Merged") and its links in one action.
2. Open **Manage merge** from a merged row's kebab to **edit the parent's authored hours** or **dissolve** the merge (which deletes the links **and** the now-orphan parent, leaving the atomic children untouched).
3. Keep their **cohort tab, teacher filter, and hide-merged toggle** after any catalog mutation (create/edit/delete/merge), because filter state now round-trips through the URL.

**Verification**: creating a merge produces a parent row in `course_merges` + a 0-choice `courses` row with composite level and shared teacher; the grouping algorithm picks it up as a virtual course with no code change; dissolving removes both the links and the parent; a failed create leaves no orphan parent; filters survive a `navigate()` reload.

### Key Discoveries:

- Grouping reads `parent.teacher_id` for collision (`src/lib/grouping/adapters/supabase.ts:54`) and `parent.hours_per_week` for the virtual course — the builder must keep these populated and the parent's choices empty.
- `course_merges` has `unique(parent_course_id, child_course_id)` **only** (`supabase/migrations/20260602185012_minimal_domain_schema.sql:59-66`) → many-to-many child sharing is permitted at the DB level; the builder allows it (no app-level one-parent-per-child guard).
- `level` is permissive free text (`src/lib/schemas/course.ts:22-25`); composite levels round-trip as text. Composite level is a **derived output**, never free-typed (lesson: identity as tokens, display at edges).
- `course_merges` FKs are `on delete cascade` — deleting the parent course row auto-removes its merge links, so dissolve can delete the parent and let the cascade clear links (or delete links first then parent; both are safe).
- Mutations go through **Astro Actions**, not API routes (lessons: "Astro Actions for form CRUD").

## What We're NOT Doing

- **No migration.** No schema change, no Postgres RPC/function. Atomicity is handled in the app layer (see below).
- **No algorithm, validator, or placement changes.** They already consume merges correctly.
- **No membership editing** in the manage flow — changing which courses are merged is dissolve + recreate this slice. (Add/remove-children is a deferred enhancement.)
- **No Option C nested/grouped presentation.** Merge parents keep today's flat "Merged" badge row. The "composite-row-as-oddball" sub-point stays an open polish item (`research.md:166`).
- **No auto-zeroing of child hours.** A child's standalone hours stay author-controlled on the atomic course form; `0` remains a deliberate choice.
- **No cross-subject merges.** Selected children must share a base name (and cohort, and teacher); the builder blocks otherwise.

## Implementation Approach

Build bottom-up so each layer is verifiable before the UI sits on it:

1. **Pure domain core** — a tested `src/lib` module that, given the selected child `CourseRow`s, validates the merge (≥2, same cohort, distinct levels, shared name, shared teacher) and derives the parent spec (name, composite level, teacher). This is the single source of derivation truth, shared by the dialog's live preview and re-checked server-side. Pure, no DB → unit-tested as a CI gate.
2. **Actions** — `createMerge` / `dissolveMerge` / `updateMergeHours`, mirroring `createOverlap`'s same-cohort lookup. `createMerge` re-runs the domain validation server-side (the authoritative gate), inserts the parent, inserts links, and on any link failure **deletes the just-created parent** (compensating cleanup) so no orphan lingers.
3. **Read-path projection** — extend the merge query to carry child ids onto parent rows so the manage dialog can list them.
4. **Builder dialog** — popover+command child picker + live derived preview + hours, one `createMerge` call, `navigate()` refresh.
5. **Manage dialog** — hours edit + dissolve confirm.
6. **Filter-state persistence** — URL-backed cohort/teacher/hide-merged so `navigate()` is non-destructive.

## Critical Implementation Details

- **Atomicity without transactions.** workerd + supabase-js cannot run a client-side multi-statement transaction, and "no migration" rules out a Postgres function. `createMerge` therefore does: insert parent → insert N links → if any link insert errors, `delete` the parent by its returned id and surface the error. This closes the orphan-parent window for all in-band failures; a process crash strictly between the two steps is the only residual risk and is recoverable via dissolve. Log nothing sensitive; return a typed `ActionError`.
  - **Testable seam (so the orphan-guard is actually verified, not waved through).** The natural DB-level link-failure triggers are unreachable — the load-children gate intercepts missing/FK-violating children, and the derivation gate intercepts duplicate children before any insert — so a live "simulated link failure" has no deterministic trigger. Extract the two-step write as a small pure-ish helper that takes the `insert parent` and `insert links` operations as injected callbacks (e.g. `writeMergeAtomic({ insertParent, insertLinks, deleteParent })`). A unit test stubs `insertLinks` to throw and asserts `deleteParent` is called with the parent id and the error is rethrown. This makes the cleanup path a CI-gated unit test rather than an un-triggerable manual step.
- **Derivation must be deterministic and order-independent.** Composite level joins the children's **distinct** levels in a stable order (e.g. the IB order `AB, SL, HL`, falling back to input order for anything outside that set) so `AB+SL` is produced regardless of pick order. The same module produces the dialog's live preview and the server's stored value — they must not drift.
- **Parent shape invariant.** The inserted parent must have: derived `name`, derived composite `level`, the shared `teacher_id`, the authored `hours_per_week`, `group_index = 0`, and **no student choices**. Keeping this exact shape is what lets the grouping adapter treat it as a virtual course unchanged.

## Phase 1: Merge domain core (pure helpers + schema)

### Overview

A pure, unit-tested module that validates a candidate merge and derives the parent spec, plus the net-new `mergeInput` Zod schema. No DB, no React.

### Changes Required:

#### 1. Merge derivation + validation module

**File**: `src/lib/courses/merge.ts` (net-new; co-located domain helper under `src/lib`)

**Intent**: Single source of truth for merge derivation and validation, consumed by both the dialog's live preview and the server action. Given the selected children, it returns either a derived parent spec or a typed validation failure naming the broken rule.

**Contract**: A pure function (e.g. `deriveMergeParent(children: MergeChildInput[]): MergeDerivation`) where `MergeChildInput` is the minimal projection it needs (`id, name, level, cohortId, teacherId`) and `MergeDerivation` is a discriminated union — `{ ok: true, parent: { name, level, teacherId, cohortId } }` or `{ ok: false, reason }` with `reason` covering: fewer than 2 children, mixed cohorts, duplicate levels, mismatched name, missing/mismatched teacher. **Name rule is exact equality of `course.name` across children — no parsing/suffix-stripping.** In this schema `name` is already the bare subject (e.g. `"German B"`) with the level in its own column (`src/components/courses/types.ts:12-23`), so the parent's `name` is simply that shared `name` verbatim; children whose `name` differs are rejected. Composite `level` = distinct child levels joined with `+` in IB order (`AB, SL, HL`, then any others in input order). Exported, public function first; helpers below it (per project style).

#### 2. `mergeInput` schema

**File**: `src/lib/schemas/course.ts`

**Intent**: Authoritative input contract for `createMerge`, shared between the action gate and the dialog resolver. Carries the raw author inputs; the derivation/cross-field rules live in the pure module and are re-asserted in the action.

**Contract**: Add `mergeInput = z.object({ childCourseIds: z.array(z.uuid()).min(2, …), hoursPerWeek: z.int().min(0, …), cohortId: z.uuid() })` and `export type MergeInput`. Mirror the existing `courseInput` style (trim/transform conventions). Derived fields (name, level, teacher) are **not** in the input — they are computed server-side from the children to prevent client spoofing. `cohortId` is carried only to **assert** against the children-derived cohort (see createMerge); it is never trusted as the parent's cohort. The authoritative parent `cohort_id` is `deriveMergeParent`'s `cohortId` (computed from and validated across the children).

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`
- Type checking / sync passes: `pnpm exec astro sync`
- Linting passes: `pnpm lint`

#### Manual Verification:

- `deriveMergeParent` produces `AB+SL` from SL+AB children regardless of order, and rejects duplicate levels, mixed cohorts, mismatched names, and mismatched/missing teachers with the correct reason.

**Implementation Note**: After automated verification passes, pause for human confirmation before Phase 2.

---

## Phase 2: Server mutation + read-path projection

### Overview

Three actions (`createMerge`, `dissolveMerge`, `updateMergeHours`) and the read-path change that carries child ids onto parent rows.

### Changes Required:

#### 1. Merge actions

**File**: `src/actions/index.ts`

**Intent**: Persist merges using the established action skeleton. `createMerge` is the authoritative gate: it loads the selected children, re-runs `deriveMergeParent`, inserts the composite parent, inserts the links, and compensates on failure. `dissolveMerge` removes the merge (links + orphan parent). `updateMergeHours` edits the parent's authored hours.

**Contract**:
- `createMerge` — input `mergeInput`. Load children by `childCourseIds` (mirror `createOverlap:118-133`); reject if any missing (`NOT_FOUND`) or if `deriveMergeParent` returns `ok: false` (`BAD_REQUEST` with the reason). Insert the parent `courses` row using the **derivation as the source of truth**: `name`/`level`/`teacher_id`/`cohort_id` all from `deriveMergeParent`'s output (NOT from `input.cohortId`), `hours_per_week` from input, `group_index: 0`. Assert `input.cohortId === derivation.cohortId` and reject (`BAD_REQUEST`) on mismatch so a spoofed/stale client cohort can't land the parent in the wrong cohort (which would silently produce a zero-student virtual course in grouping). Capture the inserted id. Insert N `course_merges` rows `{ parent_course_id, child_course_id }`. On link error: `delete` the parent by id, then throw `INTERNAL_SERVER_ERROR`. Map `23505 → CONFLICT`. Return the parent row.
- `dissolveMerge` — input `{ parentCourseId: z.uuid() }`. **Guard first**: confirm the id is a real merge parent (`select parent_course_id from course_merges where parent_course_id = eq(id) limit 1`); if absent, throw `NOT_FOUND` ("Not a merge parent.") so this path can never delete a plain atomic course. Then delete the parent `courses` row (FK `on delete cascade` clears its `course_merges` links); children untouched. Return `{ ok: true }`.
- `updateMergeHours` — input `{ parentCourseId: z.uuid(), hoursPerWeek: z.int().min(0) }`. **Same parent-type guard** (`NOT_FOUND` if the id isn't a merge parent) before updating, so this never edits a non-merge course. Update the parent's `hours_per_week`. Return the updated row.

**Compensating-cleanup snippet** (the one non-obvious bit — the orphan-parent guard):

```ts
const { data: parent, error: parentErr } = await supabase
  .from("courses").insert({ /* derived parent shape */ }).select("id").single();
if (parentErr) { /* 23505 → CONFLICT, else INTERNAL */ }

const { error: linkErr } = await supabase
  .from("course_merges")
  .insert(input.childCourseIds.map((child_course_id) => ({ parent_course_id: parent.id, child_course_id })));
if (linkErr) {
  await supabase.from("courses").delete().eq("id", parent.id); // no orphan parent
  throw new ActionError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to create merge: ${linkErr.message}` });
}
```

#### 2. Read-path: project child ids onto parent rows

**File**: `src/pages/courses.astro`

**Intent**: Carry each parent's child course ids to the island so the manage dialog can list them; preserve `isMerged`.

**Contract**: Extend the merges query (`:28`) to `select("parent_course_id, child_course_id")`. Build a `parent → child ids` map alongside `mergeParentIds`. Project a new `mergeChildIds: string[]` field onto each `CourseRow` (empty for non-parents).

#### 3. CourseRow type

**File**: `src/components/courses/types.ts`

**Intent**: Add the projected child-ids field.

**Contract**: Add `mergeChildIds: string[]` to `CourseRow` with a doc comment ("child course ids when this row is a composite merge parent; empty otherwise").

### Success Criteria:

#### Automated Verification:

- Type checking / sync passes: `pnpm exec astro sync`
- Linting passes: `pnpm lint`
- Build passes: `pnpm build`

#### Manual Verification:

- Calling `createMerge` with 2 valid children creates a 0-choice composite parent + links; the grouping output includes it as a virtual course with no code change.
- A unit test of the `writeMergeAtomic` seam (stubbed `insertLinks` throws) proves the parent is deleted — i.e. a link failure leaves **no** orphan parent row.
- `dissolveMerge` removes the parent and its links; children remain.
- `updateMergeHours` changes the parent's hours and the grouping virtual course reflects it.

**Implementation Note**: Pause for human confirmation before Phase 3.

---

## Phase 3: Merge builder dialog (create)

### Overview

The `New merge` entry point and the create dialog: multi-select children, live-derived read-only preview, hours input, one `createMerge` call.

### Changes Required:

#### 1. MergeBuilderDialog

**File**: `src/components/courses/MergeBuilderDialog.tsx` (net-new)

**Intent**: Author a new merge for the active cohort. Reuses the popover+command multi-select shape from `TeacherFilter` for picking children and the RHF + `zodResolver(mergeInput)` + `navigate()` flow from `CourseFormDialog`.

**Contract**: Props mirror the other dialogs (`open`, `onOpenChange`, `courses`, `cohortId`/active cohort, plus what's needed to resolve teacher labels). Candidate children = courses where `cohortId === activeCohort` and `!isMerged` (a composite parent can't be a child this slice). Selected children drive a **live, read-only preview** via `deriveMergeParent`: parent name, composite level, and teacher — and an inline error when the derivation fails (mismatched name/teacher/levels or <2 selected) that disables Confirm. Hours is a required `z.int().min(0)` input (same controlled-number handling as `CourseFormDialog`'s hours field, `:172-184`). On submit call `actions.createMerge({ childCourseIds, hoursPerWeek, cohortId })`; funnel `isInputError` → `form.setError`, `CONFLICT` → name/preview message, else `toast.error`; on success `toast.success`, close, and `navigate(pathname + search)`. Tokens only (lessons rule #2).

#### 2. "New merge" button + dialog mount

**File**: `src/components/courses/CourseCatalog.tsx`

**Intent**: Add the entry point beside "New course" and mount the dialog at island root, opened via state.

**Contract**: Add a `New merge` `Button` in the header (`:70-79`) next to New course; add `mergeOpen` state and mount `<MergeBuilderDialog>` alongside the other dialogs (`:122-146`), passing the active cohort and `courses`.

### Success Criteria:

#### Automated Verification:

- Type checking / sync passes: `pnpm exec astro sync`
- Linting passes: `pnpm lint`
- Build passes: `pnpm build`

#### Manual Verification:

- Selecting 2 same-name, same-teacher, distinct-level children shows the correct derived name + composite level + teacher; Confirm creates the merge and the badged parent appears after reload.
- Selecting children with mismatched teacher / mismatched name / duplicate level / fewer than 2 shows an inline error and disables Confirm.
- Composite merge parents are excluded from the candidate picker.
- 3-way merge (`AB+SL+HL`) derives and persists correctly.

**Implementation Note**: Pause for human confirmation before Phase 4.

---

## Phase 4: Manage merge (edit hours + dissolve)

### Overview

A "Manage merge" kebab item on merged rows opening a dialog to edit the parent's authored hours or dissolve the merge.

### Changes Required:

#### 1. Manage-merge dialog

**File**: `src/components/courses/MergeManageDialog.tsx` (net-new)

**Intent**: For an existing composite parent, list its children (read-only), let the author edit the authored hours, and dissolve. Dissolve uses the `alert-dialog` confirm pattern naming the consequence (links + parent removed, children kept).

**Contract**: Props mirror `CourseOverlaps`/`DeleteCourseDialog` (`course: CourseRow | null`, `courses`, `onOpenChange`). Resolve children from `course.mergeChildIds` via the `coursesById` map for a read-only list (use `formatCourseLabel`). An hours field (controlled-number, same as elsewhere) submits `actions.updateMergeHours`. A "Dissolve merge" destructive action opens an `alert-dialog` confirm → `actions.dissolveMerge`. Both `navigate()` on success. Tokens only.

#### 2. "Manage merge" kebab item

**File**: `src/components/courses/CourseCatalog.tsx`

**Intent**: Surface the manage action on merged rows only and mount the dialog.

**Contract**: In `CourseRowActions` (`:248-282`), add a `Manage merge` `DropdownMenuItem` rendered only when `row.isMerged` (parallel to "Manage overlaps"). Add `mergeManageTargetId` state + mount `<MergeManageDialog>` at island root, resolving the target via `coursesById` (same shape as the overlap manager, `:51-54,138-145`).

### Success Criteria:

#### Automated Verification:

- Type checking / sync passes: `pnpm exec astro sync`
- Linting passes: `pnpm lint`
- Build passes: `pnpm build`

#### Manual Verification:

- "Manage merge" appears only on merged rows; the dialog lists the correct children.
- Editing hours updates the parent and survives reload; grouping reflects the new hours.
- Dissolve removes the parent row and its links; the atomic children remain in the catalog.

**Implementation Note**: Pause for human confirmation before Phase 5.

---

## Phase 5: Catalog filter-state persistence

### Overview

Mirror the catalog's filter state into URL query params so the post-mutation `navigate(pathname + search)` no longer resets the cohort tab, teacher filter, or hide-merged toggle. Fixes create/edit/delete as well as merge.

### Changes Required:

#### 1. URL-backed filter state

**File**: `src/components/courses/CourseCatalog.tsx`

**Intent**: Seed `activeCohortId`, `selectedTeacherIds`, and `hideMerged` from the URL on mount and write them back to the URL on change, so a `navigate()` to `pathname + search` preserves them.

**Contract**: Read initial state from `window.location.search` (e.g. `cohort`, `teachers` as a comma-joined id list, `merged=hidden`), falling back to today's defaults (`cohorts[0]`, `[]`, `false`). On each filter change, replace the URL query (history `replaceState` or Astro client navigation without scroll) so it stays in sync without a reload. Keep all filtering pure in `useCourseFilters` (unchanged). The values must be plain projections — guard against unknown cohort/teacher ids in the URL (fall back to defaults).

#### 2. (If needed) server-side initial cohort

**File**: `src/pages/courses.astro`

**Intent**: Only if the chosen approach needs the server to know the initial cohort; otherwise the island reads the URL client-side and no Astro change is required.

**Contract**: No data-shape change. If touched, pass through the requested cohort param without affecting the existing parallel loads.

### Success Criteria:

#### Automated Verification:

- Type checking / sync passes: `pnpm exec astro sync`
- Linting passes: `pnpm lint`
- Build passes: `pnpm build`

#### Manual Verification:

- Select Year 2 + a teacher filter + hide-merged, create/edit/delete/merge a course → the same cohort tab, teacher filter, and toggle remain after the reload.
- A bookmarked/shared `/courses?cohort=…&teachers=…` URL opens with that filter state applied.
- Unknown ids in the URL fall back to defaults without error.

**Implementation Note**: Pause for human confirmation. This is the final phase.

---

## Testing Strategy

### Unit Tests (Phase 1, CI gate `pnpm test`):

- `deriveMergeParent`: order-independent composite level (`AB+SL`, `AB+SL+HL`); rejects <2 children, duplicate levels, mixed cohorts, mismatched base name, missing/mismatched teacher — each with the correct reason.
- IB ordering fallback for levels outside `{AB, SL, HL}`.

### Integration / manual scenarios:

- Create → grouping virtual-course presence (no algorithm change); compensating cleanup on link failure (no orphan parent); dissolve cascade; hours edit propagation.

### Manual Testing Steps:

1. Create a 2-child same-subject merge; confirm derived preview, badge, and grouping pickup.
2. Attempt invalid merges (mismatched teacher/name, duplicate level, <2) and confirm inline blocking.
3. Create a 3-way `AB+SL+HL` merge.
4. Edit a merge's hours; dissolve a merge; confirm children survive.
5. Apply filters, run each mutation, confirm filter state persists; test a shared filtered URL.

## Performance Considerations

No new hot path. The merge query gains one column (`child_course_id`) within the existing `.limit(500)` parallel load. Placement validation's <200ms budget is untouched (merges are merge-agnostic at the placement layer).

## Migration Notes

**None.** No schema change. Existing seed merges already render and group correctly; the builder only adds new authored merges in the same shape.

## References

- Research: `context/changes/course-merge-builder/research.md`
- Identity / change record: `context/changes/course-merge-builder/change.md`
- Closest precedent (relational authoring): `src/components/courses/CourseOverlaps.tsx`
- Multi-select precedent: `src/components/courses/TeacherFilter.tsx`
- Form pattern: `src/components/courses/CourseFormDialog.tsx:60-121`
- Same-cohort action pattern: `src/actions/index.ts:111-149`
- Grouping consumption (must stay valid): `src/lib/grouping/adapters/supabase.ts:45-58,158-172`
- Schema home: `src/lib/schemas/course.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Merge domain core (pure helpers + schema)

#### Automated

- [x] 1.1 Unit tests pass: `pnpm test` — 189948a
- [x] 1.2 Type checking / sync passes: `pnpm exec astro sync` — 189948a
- [x] 1.3 Linting passes: `pnpm lint` — 189948a

#### Manual

- [x] 1.4 `deriveMergeParent` produces `AB+SL` order-independently and rejects duplicate levels, mixed cohorts, mismatched names, and mismatched/missing teachers with the correct reason — 189948a

### Phase 2: Server mutation + read-path projection

#### Automated

- [x] 2.1 Type checking / sync passes: `pnpm exec astro sync` — e24adb6
- [x] 2.2 Linting passes: `pnpm lint` — e24adb6
- [x] 2.3 Build passes: `pnpm build` — e24adb6

#### Manual

- [x] 2.4 `createMerge` with 2 valid children creates a 0-choice composite parent + links; grouping includes it as a virtual course with no code change — e24adb6
- [x] 2.5 A unit test of the `writeMergeAtomic` seam (stubbed `insertLinks` throws) proves the parent is deleted — a link failure leaves no orphan parent row — e24adb6
- [x] 2.6 `dissolveMerge` removes the parent and its links; children remain — e24adb6
- [x] 2.7 `updateMergeHours` changes the parent's hours and grouping reflects it — e24adb6

### Phase 3: Merge builder dialog (create)

#### Automated

- [x] 3.1 Type checking / sync passes: `pnpm exec astro sync` — 79fbbac
- [x] 3.2 Linting passes: `pnpm lint` — 79fbbac
- [x] 3.3 Build passes: `pnpm build` — 79fbbac

#### Manual

- [x] 3.4 Selecting 2 valid children shows correct derived name + level + teacher; Confirm creates the merge and the badged parent appears — 79fbbac
- [x] 3.5 Mismatched teacher / mismatched name / duplicate level / <2 children shows inline error and disables Confirm — 79fbbac
- [x] 3.6 Composite merge parents are excluded from the candidate picker — 79fbbac
- [x] 3.7 3-way merge (`AB+SL+HL`) derives and persists correctly — 79fbbac

### Phase 4: Manage merge (edit hours + dissolve)

#### Automated

- [x] 4.1 Type checking / sync passes: `pnpm exec astro sync`
- [x] 4.2 Linting passes: `pnpm lint`
- [x] 4.3 Build passes: `pnpm build`

#### Manual

- [x] 4.4 "Manage merge" appears only on merged rows; the dialog lists the correct children
- [x] 4.5 Editing hours updates the parent and survives reload; grouping reflects the new hours
- [x] 4.6 Dissolve removes the parent row and its links; the atomic children remain

### Phase 5: Catalog filter-state persistence

#### Automated

- [ ] 5.1 Type checking / sync passes: `pnpm exec astro sync`
- [ ] 5.2 Linting passes: `pnpm lint`
- [ ] 5.3 Build passes: `pnpm build`

#### Manual

- [ ] 5.4 Cohort tab, teacher filter, and hide-merged persist after create/edit/delete/merge
- [ ] 5.5 A bookmarked/shared filtered `/courses?…` URL opens with that filter state applied
- [ ] 5.6 Unknown ids in the URL fall back to defaults without error
