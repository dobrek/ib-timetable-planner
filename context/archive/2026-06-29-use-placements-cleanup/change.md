---
change_id: use-placements-cleanup
title: Review findings and cleanup backlog for use-placements.ts
status: archived
created: 2026-06-29
updated: 2026-06-29
archived_at: 2026-06-29T12:19:33Z
---

## Notes

Backlog from a critical review of `src/_pages/plan-detail/model/use-placements.ts`
(reconciled across two independent reviews). The hook is well-architected — pure
state logic is already extracted into tested transition modules and the hook is
purely orchestration — so this is sharpening, not surgery. Items are ordered by ROI.

### Merged priority order

1. **Dedup `businessKey` (correctness-drift risk — do first).**
   `placementBusinessKey` (use-placements.ts:711) is byte-for-byte identical to
   `businessKey` in `history/reconcile-apply.ts:92` (`${courseId}|${day}|${period}|${week}`).
   Two copies that *must* agree for reconciliation matching to work. Promote one to
   `history/affected-slice.ts` (next to `memberSetKey`) and import in both.

2. **Decide the React Compiler question (then correct the comments).**
   The compiler is **lint-only**: `eslint-plugin-react-compiler` is wired as a rule
   (`eslint.config.js:68` → `"react-compiler/react-compiler": "error"`), but
   `babel-plugin-react-compiler` is absent from `package.json`/`node_modules` and
   `astro.config.mjs` calls `react()` with no compiler babel option — so there is **no
   auto-memoization**. Slice comments saying "the React Compiler forbids both" are
   accurate as lint-discipline statements but imply a memoization payoff that isn't
   happening. Every handler (`addCourse`, `movePlacement`, …) is a fresh identity each
   render with no `useCallback`. Perf is almost certainly fine today (the <200ms budget
   is the constraint core in `model/`, not React reconciliation; the board is small).
   The code is already compiler-clean (lint passes), so **enabling** the babel plugin is
   near-free upside — but it's a build change; verify config against current Astro docs
   first. Either enable it or correct the comments. Conscious decision, not an implicit
   assumption. (Separate decision — confirm before acting.)

3. **Bind `planId`/`cohort` once via a memoized `rpcs` object.**
   `placeCourse`/`moveBundleMembers`/`removeBundleMembers`/`shelveBundleRpc`/
   `unshelveBundle` re-spell `{ planId, cohort, ... }` at every call site, then again
   inside the `deps` object in `applyReconcile` (use-placements.ts:634-655). A
   `const rpcs = useMemo(() => makeRpcs(planId, cohort), [planId, cohort])` dedups both
   the persist path and the reconcile `deps` (which shrink to mostly identity wrappers).
   Composes with item 6.

4. **Extract the verbatim repeated fragments.**
   - Group-failure reporting is identical in `persistAddGroup:318-319`,
     `persistMoveMembers:397-398`, `persistPlaceBack:560-561` → one
     `reportGroupFailures(outcomes, attempted)`.
   - Reconcile-by-course outcome building is duplicated in `persistMoveMembers:387-392`
     and `persistPlaceBack:550-555` → one `outcomesByCourse(entries, serverRows)`.
   - Name the inline composite type `BatchOutcome & { courseId: string }` (appears at
     :334, :388, :551) → `type MemberOutcome`.
   - Occupants-at-cell filter `filter(p => p.day === X && p.period === Y)` is open-coded
     at `duplicateBundle:209`, `courseIdsAt:247`, `persistShelve:462`, and (with an added
     `courseSet.has`) at `persistMoveMembers:354` / `persistRemoveMembers:410`. No existing
     lightweight helper (`groupCellOccupants` is a view-model builder). Add a pure
     `occupantsAt(placements, cell)`.

5. **Comment the `useLatest` footgun at its definition (use-placements.ts:698).**
   Refs update in `useEffect`, so they lag one commit; the code dodges this by capturing
   refs up front and using functional updaters, but a future contributor adding a
   "read ref after setState" line would introduce a subtle bug with no type error. It's
   the sharpest footgun in the file and is only documented up at `useCombinedBoardState`.

6. **(Optional / judgment) Extract `useReconcileExecutor`.**
   `applyReconcile` + `snapshot` (use-placements.ts:611-670, plus reconcile-only helpers
   `placementBusinessKey`/`matchCardsByMemberSet` at :711-737) pull in the reconcile/
   reconcile-exec/reconcile-apply/affected-slice imports that serve only undo/redo
   (~80 lines, ~⅓ of imports). The fracture line is clean: the stores stay unified in the
   parent (passed by ref), and the extracted surface `{ snapshot, applyReconcile }` maps
   onto the existing `CohortHistoryApi` projection in `history/use-history.ts:13`. Cost:
   it injects a wide bundle of refs/setters (`placementsRef`, `parkedBundlesRef`,
   `setPlacements`, `setParkedBundles`, `setError`, `setReconciling`, `rpcs`) — readability
   win bought with interface width. `busy` can't fully move out (it's `reconciling` **plus**
   the stores' `pending` rows), so it stays composed in the parent. Cheaper after item 3.

7. **(Optional) Add a `"duplicate"` `EditKind`.**
   `duplicateBundle` routes through `addGroup` → records as `"addGroup"`, so the undo
   tooltip reads "Place group" not "Duplicate" (`history/history-label.ts` has no
   `"duplicate"` kind). Either add the kind or add a one-line "recorded as addGroup
   deliberately" comment.

### Risks / open questions (not necessarily code changes)

- **Single `error` slot, last-writer-wins.** The forward write path is *not* serialized
  (only undo/redo is, via `inFlightRef` in `use-history.ts`). Two near-simultaneous
  failures → the later `setError` clobbers the earlier; a later success never clears a
  stale banner. Probably acceptable for a one-banner UX — make it intentional (a comment,
  or clear-on-next-success).
- **Back-to-back edits to the same cell aren't busy-gated.** Each gesture captures
  `before = snapshot(scope)` from refs that may not yet reflect the prior edit's optimistic
  update. Gestures are slow relative to commits so likely unobservable, but the recorded
  `before` is the thing that would be subtly wrong if it ever raced.

### Decisions to confirm before implementing

- Item 2 (enable React Compiler vs. correct comments) — build change; confirm.
- Item 6 (executor split) — judgment call on interface width vs. readability; confirm.

### Considered and rejected

- A single generic `runOptimistic()` wrapper over all ~10 persist functions: the batch
  variants (per-member outcomes, partial-failure `groupFailure`, two-store rollback)
  diverge enough that one helper with many optional callbacks reads worse than the
  explicit versions. Prefer the targeted fragment extractions in item 4.
- Splitting the placement store from the shelf store: the two-store-atomic ops
  (`persistShelve`, `persistPlaceBack`, `applyReconcile`) need synchronous access to both
  refs + both setters; splitting would push that coordination upward and make it worse.
  (The *executor* split in item 6 is a different, cleaner cut.)
- The `duplicateBundle` "No empty slot available" string bypassing `errorOf`: correct as
  written — `errorOf` wraps a caught exception; this is a domain message with no error
  object to wrap.
