# Companion-course Reset Implementation Plan

## Overview

Change the palette's companion-course selector so it **always resets to "Any companion"** when the leading course changes, and clears entirely (leading + companion) when the cohort is switched. Today the companion is *kept* whenever it still co-occurs with the new leading course — a validity guard masquerading as a reset — which the user has flagged as surprising. This plan replaces that with an explicit reset-on-change, and corrects the docstrings whose "reset-on-leading-change" claim drifted from the implemented "keep-if-still-valid" behavior in the first place.

## Current State Analysis

The entire filter is one thin orchestrator hook, `usePaletteFilter`, in `src/_pages/plan-detail/ui/palette/PaletteBody.tsx:107-129`:

```ts
const [leadingCourseId, setLeadingCourseId] = useState<string | null>(null);
const [companionCourseId, setCompanionCourseId] = useState<string | null>(null);
const companionOptions = sortByName(companionCourseOptions(groupings, courseDisplay, leadingCourseId));
const validCompanion = reconcileCompanion(companionCourseId, companionOptions);   // :116
if (validCompanion !== companionCourseId) setCompanionCourseId(validCompanion);   // :117
const visibleGroupings = filterGroupings(groupings, leadingCourseId, validCompanion);
```

- The only reset mechanism is `reconcileCompanion` (`src/_pages/plan-detail/model/grouping/reconcile-companion.ts:10-11`), a **validity guard**: it keeps the companion iff it is still among `companionOptions`, otherwise drops it to `null`. It cannot express "reset on change" because it only ever sees the current option list, never that the leading course changed.
- The leading course is set in **exactly one production place** — `onChange={setLeadingCourseId}` at `PaletteBody.tsx:50`, wired from `GroupingFilter`'s leading `<Select onValueChange>` (`GroupingFilter.tsx:86-90`). No effect, no external caller, no cohort logic touches it. This single-writer fact makes a change-handler reset complete.
- `PaletteBody` is rendered by `CombinedPalettePanel` only in the `view === "ready"` branch, with **no `key`** (`CombinedPalettePanel.tsx:95`). The cohort switch (`Tabs onValueChange` → `onActiveCohortChange`, `CombinedPalettePanel.tsx:77-79`) changes `active` (the cohort slice) but reconciles the *same* `PaletteBody` instance — so the filter state persists across a cohort switch. `active.cohort` is the cohort identity (`PaletteCohortData.cohort`, `CombinedPalettePanel.tsx:19,55`).
- The two other pure helpers are unaffected: `companionCourseOptions` (`companion-course-options.ts:17-25`) builds the cascading option list; `filterGroupings` (`filter-groupings.ts:9-18`) applies the two membership predicates.

### Key Discoveries:

- The reset lives entirely in `usePaletteFilter` (`PaletteBody.tsx:107-129`); the change point is the leading setter + the `key` on the `PaletteBody` render.
- The original plan *intended* this behavior — `context/archive/2026-06-24-companion-course/plan.md` Desired End State says "resets to 'Any companion' whenever the leading course changes" — but shipped a validity guard instead. This is a doc/impl drift, not a missing feature.
- The two existing "stale reset" tests (`CombinedPalettePanel.test.tsx:68-83` and `:148-179`) **pass under both the old and the new behavior** because the shared fixture (`:25-27`, `g1:a+b, g2:a+c, g3:c+d`) can't express "companion still co-occurs with the new leading." A discriminating fixture must be added or the fix is not actually proven.
- Precedent for `key`-based remount reset: the slice keys list items but has no cohort-scoped key today; a plain full-document `refreshPage()` already remounts the whole board island on recompute, so a per-cohort remount of just `PaletteBody` is consistent with existing lifecycle behavior.

## Desired End State

- Selecting a different leading course (or clearing it to "All groupings") always returns the companion select to "Any companion", **even when the previous companion still co-occurs** with the new leading course.
- Switching cohort (dp1↔dp2 in combined mode) returns **both** the leading and companion selects to their cleared state — no stale leading course carried across cohorts.
- `reconcileCompanion` remains as a residual data-validity guard (it still drops a companion that a data change made invalid), but it is no longer the mechanism that expresses "reset on leading change."
- Docstrings accurately describe the new behavior, closing the drift that caused the feedback.

## What We're NOT Doing

- Not changing `companionCourseOptions` or `filterGroupings` (the option list and the two-predicate filter are correct and stay).
- Not removing `reconcileCompanion` — it is demoted to a residual validity guard, not deleted (Option A keeps its unit tests green).
- Not adding persistence (URL/DB/localStorage) for the filter selection — it stays ephemeral React state, reset by remount on recompute exactly as today.
- Not touching the cohort *selection* persistence (the `palette-cohort.ts` cookie from commit `59094cd`) — that persists which cohort is shown, which is orthogonal to the filter reset.
- Not adding an E2E spec — this is a pure ephemeral client filter; unit + RTL/hook tests cover it (the leading filter has no E2E either).
- Not changing the leading-course filter behavior itself, its sort toggle, the promoted chip, or any presentational component.

## Implementation Approach

Two small, independent triggers, each matched to the natural mechanism:

1. **Leading change → handler reset.** Because `setLeadingCourseId` has a single production caller, wrap it inside `usePaletteFilter` so it also clears the companion. Radix `Select` fires `onValueChange` only on an actual change, so this resets on every real leading change (including clear) and never spuriously.
2. **Cohort switch → remount reset.** Add `key={activeCohort}` to the `PaletteBody` render in `CombinedPalettePanel`. A cohort switch then remounts `PaletteBody`, re-initializing both `useState`s to `null`. In focus mode `activeCohort` is fixed, so no spurious remounts occur.

`reconcileCompanion` stays in place as the render-phase safety net for any data-driven invalidation that doesn't go through either trigger.

## Phase 1: Reset companion on leading-course change

### Overview

Make a leading-course change unconditionally reset the companion, and align the docstrings with the new behavior. Add a discriminating test that proves the reset fires even when the companion would still be a valid option.

### Changes Required:

#### 1. Wrap the leading setter in `usePaletteFilter`

**File**: `src/_pages/plan-detail/ui/palette/PaletteBody.tsx`

**Intent**: When the leading course changes, always clear the companion — not just when it becomes invalid. Keep `reconcileCompanion` for residual data-validity.

**Contract**: In `usePaletteFilter` (`:107-129`), introduce a leading-change handler that calls both `setLeadingCourseId(next)` and `setCompanionCourseId(null)`, and return it in place of the raw `setLeadingCourseId` (under the same key the consumer + tests use, so `PaletteBody.tsx:50`'s `onChange` and `result.current.setLeadingCourseId(...)` in the hook test keep working). The returned `companionCourseId` still passes through `reconcileCompanion` for the data-validity case. No signature change to the hook's parameters or to `GroupingFilter`'s props.

Add a one-line comment at the hook's return site noting the exposed `setLeadingCourseId` is this reset-wrapping handler — not the raw `useState` setter — so a future reader doesn't miss the companion reset (the slice's other resets are render-phase adjust-state; this is the first change-handler reset here, so flag it explicitly).

#### 2. Correct the drifted docstrings

**File**: `src/_pages/plan-detail/ui/palette/PaletteBody.tsx` (hook doc `:100-106` + inline comment `:113-115`) and `src/_pages/plan-detail/model/grouping/reconcile-companion.ts` (header `:3-8`)

**Intent**: Stop the docs from claiming `reconcileCompanion` embodies the reset-on-leading-change rule — that claim is exactly what drifted from the shipped behavior and produced the feedback.

**Contract**: Reword the `usePaletteFilter` doc and inline comment to state that a leading change resets the companion in the change handler, and that `reconcileCompanion` is the residual validity guard for data-driven invalidation. Reword the `reconcile-companion.ts` header from "the pure core of the reset-on-leading-change rule" to "residual validity guard: drop a companion that a data change left invalid." Pure prose edits — no logic change.

#### 3. Discriminating + updated tests

**File**: `src/_pages/plan-detail/ui/palette/CombinedPalettePanel.test.tsx`

**Intent**: Prove the new behavior (reset even when the companion would still co-occur), which the current fixture cannot express, and re-align the two now-misleading "stale reset" tests and their comments.

**Contract**: Do **not** mutate the shared `GROUPINGS` fixture (`:25-27`). Its "3 groupings / `g1,g2,g3`" shape is hard-coded across four describe blocks — visible-list assertions (`:43`, `:98`) and collapse-panel grouping counts (`:213`, `:227`, `:233`) — so adding a fourth grouping there silently breaks ~5 assertions unrelated to this change. Instead, add a **dedicated local fixture** for the discriminating case, e.g.:

```ts
// c-b co-occurs with BOTH c-a and c-d, so a c-a→c-d leading change leaves c-b a valid
// companion option — the only shape that proves reset-on-change vs. reset-on-invalidation.
const CO_OCCURRING = [grouping("g1", ["c-a", "c-b"]), grouping("g2", ["c-d", "c-b"])];
```

used only by the new hook test. Add that hook test: set leading `c-a`, select companion `c-b`, switch leading to `c-d` (where `c-b` is **still** a valid option), assert `companionCourseId` is `null` and the companion Select reads "Any companion". For the two existing tests at `:68-83` and `:148-179`, update **names + comments only** so they read as reset-on-change rather than reset-on-invalidation — they keep the shared `GROUPINGS`, and since the reset still fires there (now via the handler rather than the validity guard) their assertions stay valid, so no assertion or count edits ripple out. Follow the existing RTL/hook-test idiom already in this file (Radix `Select` driven via keyboard, `renderHook`/`act` for the hook).

**Note**: `src/_pages/plan-detail/model/grouping/reconcile-companion.test.ts` is intentionally left unchanged — under Option A, `reconcileCompanion` keeps its keep-if-valid semantics for the data path, so its "keeps the companion" assertion (`:8-10`) stays correct.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm check`
- Unit + hook/RTL tests pass: `pnpm test`
- Linting passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Production build stays clean: `pnpm build`

#### Manual Verification:

- Pick a leading course, pick a companion, then change to a different leading course where the old companion still co-occurs → companion returns to "Any companion".
- Clear the leading course ("All groupings") → companion resets and disables.
- No regression to the leading filter, its sort toggle, the promoted chip, or palette drag-and-drop.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2. Phase blocks use plain bullets — the `- [ ]` checkboxes live in the `## Progress` section.

---

## Phase 2: Reset the whole filter on cohort switch

### Overview

Make a cohort switch clear both the leading and companion selects by remounting `PaletteBody`, and lock the behavior with a test.

### Changes Required:

#### 1. Key `PaletteBody` by cohort

**File**: `src/_pages/plan-detail/ui/palette/CombinedPalettePanel.tsx`

**Intent**: Reset the palette filter to a clean slate whenever the author switches cohort, so a leading/companion selection from one cohort never lingers (possibly stale) in the other.

**Contract**: Add `key={activeCohort}` (equivalently `key={active.cohort}`) to the `<PaletteBody>` element at `:95`. On cohort switch, React remounts `PaletteBody`, re-initializing `usePaletteFilter`'s `leadingCourseId`/`companionCourseId` to `null`. No prop or type changes; focus mode (single, fixed `activeCohort`) is unaffected.

#### 2. Cohort-switch reset test

**File**: `src/_pages/plan-detail/ui/palette/CombinedPalettePanel.test.tsx`

**Intent**: Assert that switching cohort clears both selects.

**Contract**: `activeCohort` is a **controlled prop**, and the cohort tab's `onValueChange` only calls `onActiveCohortChange` (`CombinedPalettePanel.tsx:77-79`) — it does not mutate `activeCohort` itself. So the test must render `CombinedPalettePanel` inside a **stateful wrapper** that lifts the active cohort into React state and feeds it back:

```tsx
function Harness() {
  const [cohort, setCohort] = useState<Cohort>("dp1");
  return <CombinedPalettePanel {...twoReadyCohorts} activeCohort={cohort} onActiveCohortChange={setCohort} ... />;
}
```

Without this, `key={activeCohort}` never changes, `PaletteBody` never remounts, and the assertion would falsely fail. **There is no two-cohort switcher setup to reuse** — the only existing `CombinedPalettePanel` helper (`:185`) is single-cohort ("no toolbar"); build a new two-"ready"-cohort fixture (both `stale: false`), wrapped in `DragDropProvider` exactly as that helper is. Then: select a leading course (and a companion) in dp1, click the dp2 tab (`role="tab"`, label from `COHORTS`), and assert both the leading and companion Selects read their cleared labels ("All groupings" / "Any companion"); optionally switch back to dp1 and assert it is still cleared (fresh mount, not the old selection).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm check`
- Unit + hook/RTL tests pass: `pnpm test`
- Linting passes: `pnpm lint`
- FSD structure check passes: `pnpm steiger`
- Production build stays clean: `pnpm build`

#### Manual Verification:

- In combined mode, select a leading course + companion in dp1, switch to dp2 → both selects are cleared; switch back to dp1 → still cleared (fresh mount, not the old selection).
- Focus mode (single cohort) shows no change in behavior and no spurious remounts.
- Cohort *selection* still persists across a recompute refresh (the `palette-cohort` cookie behavior is untouched).

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation that the UI behaves as specified.

---

## Testing Strategy

### Unit / Hook Tests:

- `usePaletteFilter` (via `CombinedPalettePanel.test.tsx`): changing the leading course to another course where the companion **still co-occurs** resets the companion to `null` (the discriminating case); clearing the leading course resets and disables the companion.
- `reconcileCompanion` unit tests unchanged — still assert keep-if-valid for the data path.

### Component (RTL) Tests:

- The rendered companion Select returns to "Any companion" after a leading change (updated existing test).
- `CombinedPalettePanel`: switching the cohort tab clears both the leading and companion Selects.

### Manual Testing Steps:

1. Open a plan, pick a leading course, pick a companion.
2. Change the leading course to another course that shares the companion → companion resets to "Any companion".
3. Clear the leading course → companion resets and disables.
4. In combined mode, select leading + companion in dp1, switch to dp2 → both cleared; switch back → still cleared.
5. Confirm drag-and-drop from the palette and the leading sort toggle still work.

## Performance Considerations

None. The filter is render-time `.filter()`/`Map` work, explicitly off the <200ms drag-drop validation path. The per-cohort remount only re-runs the same render the cohort switch already triggers.

## Migration Notes

None — no schema, data, or persisted-state changes.

## References

- Research: `context/changes/companion-course-reset/research.md`
- Change point (hook): `src/_pages/plan-detail/ui/palette/PaletteBody.tsx:107-129` (reset at `:116-117`, leading wired at `:50`)
- Residual guard: `src/_pages/plan-detail/model/grouping/reconcile-companion.ts:10-11`
- Cohort-switch wiring: `src/_pages/plan-detail/ui/palette/CombinedPalettePanel.tsx:77-79,95`
- Tests to update: `src/_pages/plan-detail/ui/palette/CombinedPalettePanel.test.tsx:68-83,148-179` (names + comments) — plus a new local fixture + discriminating hook test; the shared fixture `:25-27` stays untouched (see Phase 1 §3)
- Original (drifted) intent: `context/archive/2026-06-24-companion-course/plan.md` (Desired End State), `plan-brief.md` (Success Criteria)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Reset companion on leading-course change

#### Automated

- [x] 1.1 Type checking passes: `pnpm check`
- [x] 1.2 Unit + hook/RTL tests pass: `pnpm test`
- [x] 1.3 Linting passes: `pnpm lint`
- [x] 1.4 FSD structure check passes: `pnpm steiger`
- [x] 1.5 Production build stays clean: `pnpm build`

#### Manual

- [x] 1.6 Changing to a leading course where the old companion still co-occurs resets the companion to "Any companion"
- [x] 1.7 Clearing the leading course resets and disables the companion
- [x] 1.8 No regression to the leading filter, sort toggle, promoted chip, or palette drag-and-drop

### Phase 2: Reset the whole filter on cohort switch

#### Automated

- [ ] 2.1 Type checking passes: `pnpm check`
- [ ] 2.2 Unit + hook/RTL tests pass: `pnpm test`
- [ ] 2.3 Linting passes: `pnpm lint`
- [ ] 2.4 FSD structure check passes: `pnpm steiger`
- [ ] 2.5 Production build stays clean: `pnpm build`

#### Manual

- [ ] 2.6 Switching cohort clears both leading and companion; switching back stays cleared
- [ ] 2.7 Focus mode shows no behavior change and no spurious remounts
- [ ] 2.8 Cohort selection still persists across a recompute refresh (cookie untouched)
