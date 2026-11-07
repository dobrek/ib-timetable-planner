---
change_id: created-by-and-job-ownership
title: Created by and job ownership
status: impl_reviewed
created: 2026-11-06
updated: 2026-11-07
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- **2026-11-06, Phase 2 review: the board header's creator is a tooltip, not a line.** The plan said the
  board header *shows* "Created by <credit>". The reviewer found the heading row too crowded, so the
  creator folds into a `UserRound` icon button after the plan name. Hover or keyboard focus shows a
  shadcn Tooltip with "Created by", then the name with the email beneath (FR-413). The button's
  `aria-label` is "Created by <name> (<email>)", so Phase 4's e2e can still match the author's email
  without hovering. Touch opens nothing; the hub's "Created by" column names every creator.
  - New primitive: `src/shared/ui/tooltip.tsx` (new-york-v4, `radix-ui`; already token-only). Its
    `Tooltip` brings its own provider, because each Astro island is its own React root.
  - `UserCredit` gained an `inverse` variant for the tooltip's inverted surface, and `entities/user`
    a `creditText` helper ("Name (email)" / email / "Unknown"), which Phase 3's stopper copy reuses.
  - The hub column is unchanged: still the stacked credit, always visible.
- **2026-11-07, smaller deviations from the plan, recorded at impl review.** Each one is commented
  in code; this collects them so the plan stays an accurate record.
  - `loadCreditedUsers` checks its query errors inline, raising the same `DomainError`, instead of
    calling `assertNoQueryErrors`. The islands-safe `entities/user` barrel may value-import nothing
    from `@/shared/api`, which re-exports `createClient`. It also accepts `(string | null)[]` and drops
    the nulls.
  - Two helper modules the plan didn't list: `api/load-credit.ts` (one id → `Credit`, used by the route
    and `withStopper`) and `model/credited-users.ts` (the pure directory and profiles join).
  - `StoppedBy`'s `user` variant carries `text` (from `creditText`) for the copy.
  - The migration sets each `default auth.uid()` in a separate `ALTER` after `ADD COLUMN`, so no
    existing row is credited, and a post-condition asserts it.
  - The guard uses `private.can_stop_any_job() is not true` where the plan wrote `not …`, so a caller
    with no role fails closed rather than passing on a null.
- **2026-11-07, impl review fixes** (`reviews/impl-review.md`):
  - **F1:** "Stopping…" shows to everyone watching the run once a stop is pending, viewers included.
    Only the control is gated. `stopAffordance` in `model/generation/can-stop-job.ts` decides the
    slot, and `StoppingIndicator` is a named export of `StopAndKeep.tsx`.
  - **F2:** the migration header and the role-matrix docblocks now give the real refusal order. A
    viewer reaches the guard, because WITH CHECK runs after BEFORE triggers; this was confirmed live.
    The residual-gap note now names every terminal status.
  - **F3:** `sameView` compares `requestedBy`, `stopRequestedBy` and `stoppedBy` (structurally).
  - **F4:** the guard refuses withdrawing a stop (clearing `stop_requested_at`) for every signed-in
    caller, with an attribution-suite case. The migration was edited in place: it has not reached
    hosted.
  - **F5:** `withStopper` skips the lookup while the board waits for delivery.
  - **F6:** the route loads the creator in parallel with the board.
  - **F7:** `GenerationJobView.stopRequestedBy` carries the stopper's id, so "You stopped" no longer
    depends on the name lookup.
- **2026-11-07, success-criteria evidence.** Phase 1's row 1.1 asked that the red run's failing
  cells be recorded. That run happened, but its cell list was not kept. Rows 4.1–4.3 (the full
  E2E suite and the full integration lane, both needing the solver) were not re-run at impl
  review: the solver was down and the branch had no CI run yet. The PR's CI `integration` and `e2e`
  jobs are their confirmation.
