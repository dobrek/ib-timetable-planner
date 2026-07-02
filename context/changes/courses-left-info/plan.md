# Courses Left Info — Hours-Based Placement Breakdown Implementation Plan

## Overview

The board top bar shows a course count ("N courses left to place"). We are turning it into an **hours-based** signal — `N hours left to place · M over` — whose text is a **Popover trigger** revealing *which* courses those hours belong to, split into a **Missing** section (`placed < required`) and an **Over-placed** section (`placed > required`), grouped by cohort and sorted largest-gap-first.

The user's goal, in their words: *"how many hours are still missing to be placed on the board"* and *"which courses"* those hours belong to — regardless of whether a missing hour is off the board because it's parked on the shelf or was never dragged from the palette. Both are simply "not on the board yet."

This is a pure projection over the `deriveHours` map that already runs on every render. No schema, API, Astro Action, or constraint-core change. Well under the <200 ms drag budget (one extra linear pass over a `Map` of tens of entries).

## Current State Analysis

- **The number today counts courses, not hours.** `deriveHours(placements, catalog)` (`src/_pages/plan-detail/model/hours.ts:14`) returns `Map<courseId, { placed, required }>`; `countIncompleteCourses` (`hours.ts:32`) counts courses with `placed < required`; `useHours` memoizes both (`use-board-derivations.ts:68`); `toCohortState` exposes per-cohort `incompleteCount` (`use-cohort-board-state.ts:226`); `PlannerBoard` sums it across active cohorts (`PlannerBoard.tsx:183`) and passes it to `PlanSummaryBar` (`PlannerBoard.tsx:194`), which renders the "N courses left to place" / "All course hours placed" text (`PlanSummaryBar.tsx:51-60`).
- **`placed` is board rows only.** One placement row = one placed course-hour (`hours.ts:15-18`); `required = course.hours`. Parking a cell *removes* its board rows (`shelf-writes.ts:62-67`), so a parked hour is naturally *not* counted as `placed` — exactly what we want (a parked hour reads as missing).
- **`incompleteCount` / `countIncompleteCourses` have no other consumer.** Verified by grep: within `src/` they flow only through the top-bar chain (`useHours` → `toCohortState` → `PlannerBoard` → `PlanSummaryBar`) plus the `useHours` unit test. The plans-list "complete" metric does not import them. So the bar's switch to hours makes both dead code, safe to replace.
- **The Popover path is paved.** `BoardSettingsMenu.tsx` is a live precedent for a Popover in this exact top bar; the parked badge (`PlanSummaryBar.tsx:38-50`) is a click-to-open `<button>` precedent. `Popover*` parts, `Badge`, `Button`, `subjectChipClass`, and the `--color-warning`/`--color-warning-foreground` theme tokens all exist. `HoursCounter` (`ui/palette/HoursCounter.tsx`) renders `placed/required`; `MemberRow` (`ui/palette/GroupingBox.tsx:84-95`) is the chip + name + counter row pattern to mirror.
- **`resolveCourseDisplay(map, id) → { name, color }`** (`model/course-display.ts:12`) is the render-edge resolver; there is no subject *string* — subject is the `color` token rendered via `subjectChipClass(color)` (`shared/config/subject-colors.ts:42`).
- **No e2e spec asserts on the counter** (`grep` of `e2e/specs/` for `courses left`/`plan-summary`/`data-incomplete` is empty). The only unit tests touching it are `hours.test.ts` and `use-board-derivations.test.tsx`.

## Desired End State

The top bar reads **`N hours left to place`**, appending **`· M over`** (warning-toned) when any course is over-placed. Clicking it opens a Popover titled "Course placement" containing:

- a **Missing** section — courses with `placed < required`, grouped by cohort, each row a subject-color chip + course name + `placed/required` counter, sorted by hours-left descending (ties alphabetical), with a per-section subtotal "N courses · M hours left";
- an **Over-placed** section (warning-toned header) — courses with `placed > required`, same row shape, sorted by hours-over descending, subtotal "N courses · M hours over".

Hours-left and hours-over are **computed per course, clamped at zero, and summed independently** — never netted against each other. In focus mode the popover shows the focused cohort only; in combined mode it shows DP1 and DP2 as grouped subsections, matching the counter's existing focus/combined rule.

**Verification:** with the seed loaded, the bar shows an hours figure; opening the popover lists the correct courses under each section with correct counters and subtotals; over-placing one course while under-placing another (the Math+English case) shows both a non-zero "left" and a non-zero "over" that do not cancel.

### Key Discoveries

- `deriveHours` already computes the exact per-course diff (`hours.ts:14-25`); the lists are `filter().map()` over its output.
- Parking removes board rows (`shelf-writes.ts:62-67`), so **no parked-awareness is needed** — a parked hour is already excluded from `placed`.
- `PlannerBoard.tsx:179` (`const states = combined ? [dp1, dp2] : [resolveState(focus)]`) is the single place that resolves which cohorts are active — reuse it for both totals and the popover, don't re-derive.
- `incompleteCount`/`countIncompleteCourses` are consumed only by the bar → replaceable.
- `--color-warning` / `--color-warning-foreground` exist (`app/styles/global.css:145-146`), enabling `text-warning` / `border-warning` utilities.

## What We're NOT Doing

- **No click-to-highlight / interactivity.** Rows are static; the `deriveDropHints` valid-slot machinery stays available for a future iteration but is out of scope.
- **No parked-awareness or parked exclusion.** Reverses the earlier research decision #4: parked hours count as missing (they're off the board). The "N parked" badge is a separate, untouched durability cue.
- **No side panel / tray, no HoverCard/Tooltip primitive.** Popover only.
- **No schema, migration, Astro Action, API, or constraint-core change.**
- **No aggregate over-placement in the top bar beyond the `· M over` suffix** (the full per-course over list lives in the popover).
- **No change to `HoursCounter` semantics** (it mutes at `placed === required`); reused as-is.

## Implementation Approach

Two phases. **Phase 1** adds the pure model derivations (identity + hours only) and the two clamped hour sums, then threads the per-cohort `unplaced`/`overplaced` lists and `hoursLeft`/`hoursOver` totals through the existing hook chain, replacing `incompleteCount`. Fully unit-testable in isolation. **Phase 2** assembles the display-resolved, sorted, cohort-tagged view rows and combined totals at the UI edge in `PlannerBoard`, swaps `PlanSummaryBar`'s counter to the hours-based Popover trigger with the four edge-state strings, and adds the presentational `CoursesLeftPopover` plus a Playwright spec.

## Critical Implementation Details

- **Never net over-placement against under-placement.** `hoursLeft = Σ max(0, required − placed)` and `hoursOver = Σ max(0, placed − required)`, each summed **per course**. A global "total placed vs total required" would let one course's excess cancel another's deficit (Math placed 4/required 2 and English 0/2 nets to zero but must read "2 left · 2 over"). This invariant gets an explicit unit test.
- **`placed` is board-only by construction; do not add parked members back in.** Parking already removed the rows from `placements`, so `deriveHours` reflects "on the board right now" — which is precisely the metric. Parked and never-placed hours are indistinguishable here, by design.
- **0-hour merge-children are never "over-placed" — guard `deriveOverplaced` on `required > 0`.** A merge-child stays in the catalog as a placeable course with `hours: 0`, so if it is dropped on the board `deriveHours` yields `{ placed: ≥1, required: 0 }`. The naive `placed > required` predicate would flag it and spuriously inflate `hoursOver` / the `· M over` suffix. Exclude `required === 0` from the over-placed list and the `hoursOver` sum (the unplaced side needs no guard — `placed < 0` is impossible).
- **Sort key needs the resolved display name for tie-breaking**, so sorting happens *after* display resolution at the UI edge, not in the model derivation.

## Phase 1: Model — derivations + hook threading

### Overview

Add `deriveUnplaced`, `deriveOverplaced`, and `summarizeHours` to `hours.ts`; return them from `useHours`; expose per-cohort `unplaced`/`overplaced`/`hoursLeft`/`hoursOver` from `toCohortState`, removing `incompleteCount`. Remove the now-dead `countIncompleteCourses`.

### Changes Required:

#### 1. Hours derivations + clamped sums

**File**: `src/_pages/plan-detail/model/hours.ts`

**Intent**: Add the two list projections (courses still needing board hours; courses with too many) and the two independent clamped hour totals the bar headline needs. Remove `countIncompleteCourses` (no remaining consumer once the bar is hours-based).

**Contract**:
- `export type CourseHours = { courseId: string; placed: number; required: number }` (identity + hours only — no display).
- `deriveUnplaced(stats: Map<string, HoursStat>): CourseHours[]` — entries where `placed < required`, as `filter().map()` (declarative, no accumulator loop).
- `deriveOverplaced(stats: Map<string, HoursStat>): CourseHours[]` — entries where `placed > required && required > 0`. The `required > 0` guard is load-bearing: 0-hour merge-children stay in the catalog as placeable courses (`shared/api/load-cohort-courses.ts:60-68`) and, once dropped, carry their own placement rows, so a placed 0-hour child reads as `{ placed: 1, required: 0 }`; without the guard `placed > required` (1 > 0) would flag it as over-placed. A required-0 course is never "over-placed" by design.
- `summarizeHours(stats: Map<string, HoursStat>): { hoursLeft: number; hoursOver: number }` — `hoursLeft = Σ (required − placed)` over unplaced; `hoursOver = Σ (placed − required)` over the **guarded** overplaced set (`required > 0`). Computed per course; the two sums are independent.
- Delete `countIncompleteCourses` and its export.

#### 2. Hours derivations tests

**File**: `src/_pages/plan-detail/model/hours.test.ts`

**Intent**: Cover the new derivations and lock the non-netting invariant. Remove the `countIncompleteCourses` describe block.

**Contract**: New cases — `deriveUnplaced`/`deriveOverplaced` return the right course ids; a **placed** 0-hour merge-child (`{ placed: 1, required: 0 }`) appears in **neither** list and contributes 0 to both `summarizeHours` sums (this is the case the `required > 0` guard exists for — testing only the placed-0 child passes trivially and misses the bug); exactly-placed courses appear in neither; **the Math+English case**: catalog `[Math(2), English(2)]` with 4 Math placements + 0 English → `summarizeHours` = `{ hoursLeft: 2, hoursOver: 2 }` (proves no netting); empty catalog → `{ hoursLeft: 0, hoursOver: 0 }` and empty lists.

#### 3. `useHours` return shape

**File**: `src/_pages/plan-detail/model/use-board-derivations.ts`

**Intent**: Return the memoized lists and totals instead of `incompleteCount`. Drop the `countIncompleteCourses` import.

**Contract**: `useHours(placements, catalog)` returns `{ hours, unplaced, overplaced, hoursLeft, hoursOver }` — `unplaced`/`overplaced` memoized from `hours` via `deriveUnplaced`/`deriveOverplaced`; `hoursLeft`/`hoursOver` memoized via `summarizeHours`. Each derived value referentially stable across a re-render with the same `hours`.

#### 4. `useHours` test update

**File**: `src/_pages/plan-detail/model/use-board-derivations.test.tsx`

**Intent**: Update the `useHours` describe block to the new return shape.

**Contract**: Assert `hoursLeft`/`hoursOver` are numbers reflecting the fixture and that `unplaced`/`overplaced`/`hoursLeft`/`hoursOver` stay referentially stable across a re-render with the same inputs. Replace the `incompleteCount > 0` assertion.

#### 5. Thread through per-cohort state

**File**: `src/_pages/plan-detail/model/use-cohort-board-state.ts`

**Intent**: Carry the new hours fields on each cohort's derivations and public state; drop `incompleteCount`.

**Contract**: `useCohortDerivations` destructures `{ hours, unplaced, overplaced, hoursLeft, hoursOver }` from `useHours` and returns them; `toCohortState` exposes `hours`, `unplaced`, `overplaced`, `hoursLeft`, `hoursOver` (removing `incompleteCount`). `CohortBoardState` type updates automatically.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm check` (`astro check`, run after `astro sync` — the only valid type gate; `pnpm lint`/`pnpm build` are not type-checks)
- Unit tests pass: `pnpm test`
- Linting passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`

#### Manual Verification:

- N/A for this phase (no user-visible change yet); confirm the app still builds and the board renders via `pnpm dev`.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding to Phase 2. Phase blocks use plain bullets — the `- [ ]` checkboxes live in `## Progress`.

---

## Phase 2: UI — bar assembly + Popover + a11y + e2e

### Overview

Assemble display-resolved, sorted, cohort-tagged view rows and combined totals in `PlannerBoard`; swap `PlanSummaryBar`'s counter to the hours-based Popover trigger with the four edge states; add the presentational `CoursesLeftPopover`; add a Playwright spec.

### Changes Required:

#### 1. View-row assembler (pure, tested)

**File**: `src/_pages/plan-detail/ui/chrome/courses-left-summary.ts`

**Intent**: Turn the per-cohort model arrays into the sorted, display-resolved structure the popover renders, plus the combined totals for the bar. Pure and unit-testable; lives at the UI edge because sorting needs the resolved name.

**Contract**:
- `type CoursesLeftRow = { courseId: string; name: string; color: SubjectColor | null; placed: number; required: number }`
- `type CoursesLeftCohort = { cohort: Cohort; missing: CoursesLeftRow[]; over: CoursesLeftRow[] }`
- `type CoursesLeftSummary = { hoursLeft: number; hoursOver: number; cohorts: CoursesLeftCohort[] }`
- `buildCoursesLeftSummary(inputs: { cohort: Cohort; courseDisplay: Record<string, CourseDisplay>; unplaced: CourseHours[]; overplaced: CourseHours[]; hoursLeft: number; hoursOver: number }[]): CoursesLeftSummary` — resolves each row via `resolveCourseDisplay`, sorts `missing` by `(required − placed)` desc then `name` asc, sorts `over` by `(placed − required)` desc then `name` asc, and sums `hoursLeft`/`hoursOver` across inputs.
- **Imports** follow the established conventions: `SubjectColor` from the `@/shared/config` barrel (not the deep `@/shared/config/subject-colors` path — every existing site uses the barrel); `CourseHours`/`resolveCourseDisplay`/`CourseDisplay` from the slice `model/` (`../../model/hours`, `../../model/course-display`) — the same ui→model intra-slice pattern as `ui/chrome/board-inspection.ts`.

#### 2. Assembler test

**File**: `src/_pages/plan-detail/ui/chrome/courses-left-summary.test.ts`

**Intent**: Lock sort order, tie-breaking, display fallback, and combined totals.

**Contract**: Rows sort largest-gap-first with alphabetical tie-break; a courseId missing from `courseDisplay` falls back to `{ name: id, color: null }`; two cohorts' totals add; the Math+English fixture yields `hoursLeft`/`hoursOver` that do not net.

#### 3. Popover content component

**File**: `src/_pages/plan-detail/ui/chrome/CoursesLeftPopover.tsx`

**Intent**: Presentational Popover content: the two grouped sections. Mirrors the palette `MemberRow` row (subject chip + truncated name + `HoursCounter`). No state, no data fetching.

**Contract**: Props `{ summary: CoursesLeftSummary; combined: boolean }`. Renders `PopoverContent` with `PopoverHeader`/`PopoverTitle` "Course placement"; a **Missing** section (subtitle "N courses · M hours left") and, when `hoursOver > 0`, an **Over-placed** section whose header uses `text-warning`/`border-warning` tokens (subtitle "N courses · M hours over"). Within each section, rows are grouped under a small DP1/DP2 subheader **only when `combined`** (single-cohort focus mode omits the subheader). Each row reuses the `subjectChipClass(color)` chip + name + `HoursCounter` (`{ placed, required }`) pattern. List wrapped in `max-h-[…] overflow-y-auto` (no `ScrollArea` primitive — same plain-overflow pattern as `PaletteBody.tsx:56`). All colors via semantic tokens. `data-slot="courses-left-popover"`.

#### 4. Bar trigger + edge-state copy

**File**: `src/_pages/plan-detail/ui/chrome/PlanSummaryBar.tsx`

**Intent**: Replace the `incompleteCount` count text with the hours-based Popover trigger. Presentational — receives the assembled summary as a prop.

**Contract**: Prop changes from `incompleteCount: number` to `summary: CoursesLeftSummary` (+ a `combined: boolean` for cohort subheaders). Render logic by state (`hoursLeft = summary.hoursLeft`, `hoursOver = summary.hoursOver`):
- `hoursLeft > 0, hoursOver === 0` → trigger button "**N hours left to place**" (pluralize hour/hours).
- `hoursLeft > 0, hoursOver > 0` → "**N hours left to place** · **M over**" with the "· M over" span in `text-warning`.
- `hoursLeft === 0, hoursOver > 0` → "**All hours placed** · **M over**" (still an interactive trigger, warning-toned suffix).
- `hoursLeft === 0, hoursOver === 0` → plain non-interactive `<span>` "**All course hours placed**" (no Popover, no button).

When interactive, wrap in `Popover` + `PopoverTrigger asChild` around a `<button>` with an `aria-label` (e.g. "N hours left to place — show breakdown") and a subtle interactive cue (dotted underline / chevron), and render `CoursesLeftPopover`. Keep test hooks: `data-slot="plan-summary"`, `data-hours-left={hoursLeft}`, `data-hours-over={hoursOver}` (replacing `data-incomplete`).

#### 5. Assemble in the board

**File**: `src/_pages/plan-detail/ui/PlannerBoard.tsx`

**Intent**: Build the summary from the same `states` array that already resolves active cohorts, and pass it down. Replace the `incompleteCount` sum.

**Contract**: Replace `const incompleteCount = states.reduce(...)` with a memoized `const summary = buildCoursesLeftSummary(states.map(s => ({ cohort: s.cohort, courseDisplay: s.courseDisplay, unplaced: s.unplaced, overplaced: s.overplaced, hoursLeft: s.hoursLeft, hoursOver: s.hoursOver })))`. Pass `summary={summary}` and `combined={combined}` to `PlanSummaryBar` (drop `incompleteCount`).

#### 6. E2E spec

**File**: `e2e/specs/courses-left-popover.spec.ts`

**Intent**: Guard the end-to-end wiring: the bar shows hours, the popover opens and lists courses.

**Contract**: With the seeded plan (which has unplaced courses), assert the `data-slot="plan-summary"` element exposes a `data-hours-left` > 0; click it; assert `data-slot="courses-left-popover"` is visible, the Missing subtitle text is present, and at least one course row renders with a `data-slot="hours-counter"`. Follow existing spec conventions in `e2e/specs/` and `e2e/support/`.

### Success Criteria:

#### Automated Verification:

- Type checking + lint pass: `pnpm check` (`astro check`, after `astro sync`) and `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Unit tests pass: `pnpm test`
- Production build stays clean: `pnpm build`
- E2E suite passes: `pnpm test:e2e`

#### Manual Verification:

- Bar reads "N hours left to place"; over-placing a course adds "· M over" in warning color; the Math+English case shows both non-zero and non-cancelling.
- Clicking the counter opens the popover; Missing and Over-placed sections list the correct courses with correct `placed/required` counters and subtotals; rows are largest-gap-first.
- Combined mode shows DP1/DP2 subheaders; focus mode shows the focused cohort only, no subheader.
- The "All course hours placed" state renders as plain, non-clickable text; the "All hours placed · M over" state stays clickable and opens straight to the Over-placed section.
- Popover surface and chips use semantic tokens (verify light/dark); the slim bar layout isn't broken by the longer copy.
- Keyboard: the trigger is focusable and operable; the popover closes on Escape / outside click.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation.

---

## Testing Strategy

### Unit Tests:

- `hours.test.ts` — `deriveUnplaced`/`deriveOverplaced` course selection; a **placed** 0-hour merge-child (`{placed:1, required:0}`) excluded from **both** lists and contributes 0 to both sums (the `required > 0` guard); exactly-placed excluded from both; `summarizeHours` non-netting (Math+English → `{2,2}`); empty catalog → zeros.
- `use-board-derivations.test.tsx` — `useHours` returns the new fields and keeps them referentially stable.
- `courses-left-summary.test.ts` — sort order + alphabetical tie-break; display fallback for unknown courseId; combined totals add; non-netting preserved through assembly.

### Integration Tests:

- None required — no Supabase/Action surface is touched.

### Manual Testing Steps:

1. Load the seeded plan in combined mode; confirm the bar shows "N hours left to place".
2. Over-place one course and leave another under-placed; confirm "· M over" appears and the two figures don't cancel.
3. Open the popover; confirm Missing/Over-placed sections, cohort subheaders (combined), row counters, subtotals, and largest-gap-first order.
4. Switch to focus mode; confirm only the focused cohort shows and no cohort subheader.
5. Fully place everything; confirm plain "All course hours placed" (non-clickable). Then over-place one; confirm "All hours placed · M over" stays clickable and opens the Over-placed section.

## Performance Considerations

Negligible. `deriveUnplaced`/`deriveOverplaced`/`summarizeHours` are single linear passes over the in-memory `hours` `Map` (tens of entries), memoized on `hours`; the assembler runs once per render behind a `useMemo`. No placement/collision re-validation, no new indices. Far inside the <200 ms drag budget.

## Migration Notes

No data migration. Pure display change. The `data-incomplete` test hook is replaced by `data-hours-left`/`data-hours-over` (no external consumer). `countIncompleteCourses` is removed as dead code (grep-verified single consumer).

## References

- Research: `context/changes/courses-left-info/research.md`
- Counter chain: `src/_pages/plan-detail/model/hours.ts:14-38`, `use-board-derivations.ts:68-72`, `use-cohort-board-state.ts:191,216-253`, `ui/PlannerBoard.tsx:179-194`, `ui/chrome/PlanSummaryBar.tsx:51-60`
- Popover precedent (same bar): `src/_pages/plan-detail/ui/chrome/BoardSettingsMenu.tsx`
- Row pattern to mirror: `src/_pages/plan-detail/ui/palette/GroupingBox.tsx:84-95`, `ui/palette/HoursCounter.tsx`
- Display resolver: `src/_pages/plan-detail/model/course-display.ts:12`; chip tokens: `src/shared/config/subject-colors.ts:42`; warning tokens: `src/app/styles/global.css:145-146`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Model — derivations + hook threading

#### Automated

- [x] 1.1 Type checking passes (`pnpm check` — `astro check` after `astro sync`) — ef33bf4
- [x] 1.2 Unit tests pass (`pnpm test`) — ef33bf4
- [x] 1.3 Linting passes (`pnpm lint`) — ef33bf4
- [x] 1.4 FSD structure check passes (`pnpm steiger`) — ef33bf4

#### Manual

- [x] 1.5 App still builds and the board renders (`pnpm dev`) — ef33bf4

### Phase 2: UI — bar assembly + Popover + a11y + e2e

#### Automated

- [x] 2.1 Type checking + lint pass (`pnpm check` + `pnpm lint`)
- [x] 2.2 FSD structure check passes (`pnpm steiger`)
- [x] 2.3 Unit tests pass (`pnpm test`)
- [x] 2.4 Production build stays clean (`pnpm build`)
- [x] 2.5 E2E suite passes (`pnpm test:e2e`)

#### Manual

- [x] 2.6 Bar reads "N hours left to place"; over-placing adds "· M over" (warning); Math+English case is non-cancelling
- [x] 2.7 Popover lists correct Missing/Over-placed courses with counters, subtotals, largest-gap-first
- [x] 2.8 Combined shows DP1/DP2 subheaders; focus shows one cohort, no subheader
- [x] 2.9 "All course hours placed" is plain/non-clickable; "All hours placed · M over" stays clickable to the Over section
- [x] 2.10 Semantic tokens verified light/dark; slim-bar layout intact
- [x] 2.11 Keyboard: trigger focusable + operable; popover closes on Escape / outside click
