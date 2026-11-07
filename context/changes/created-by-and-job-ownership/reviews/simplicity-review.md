<!-- SIMPLICITY-REVIEW-REPORT -->
# Simplicity and readability review: Created-by and Job Ownership (S-407)

- **Scope**: the whole branch diff against `main` (source, tests, migration); the plan-adherence pass is `impl-review.md`
- **Date**: 2026-11-07
- **Verdict**: GOOD SHAPE, with leftovers from the impl-review fixes worth tidying before the PR
- **Findings**: 4 worth doing, 5 optional, 3 noted and left alone

## Triage (2026-11-07)

S1 to S9 all applied, same day, in the worktree. S3 unified the strip's kept-checkpoint copy under
the one template (see change.md). S7 made `loadCredit` best-effort and gave it a `context` label for
the log line, with a unit case for the failing lookup. After the fixes: `pnpm check` 0 errors, lint and
steiger clean, `pnpm test` 263 files / 2664 tests, `pnpm build` clean. Integration and E2E lanes not
re-run: nothing below touches a query, a policy or an accessible name the specs match on.

The slice reads well. The split between `entities/user` (how a person is named and credited), the
`model/generation` deciders (`canStopJob`, `stopAffordance`, `stoppedBy`) and the UI that renders
them follows the repo's "decide in model, render in ui" rule, the migration explains every
non-obvious choice once, and the tests say what they check in plain sentences. The findings below
are mostly seams left by F1, F7 and F9 of the impl review: each fix was right, and each left a
small piece of the old shape behind.

## Worth doing

### S1 — `StopAndKeep` still owns a "Stopping…" branch the page now decides

- **Location**: `src/_pages/plan-detail/ui/StopAndKeep.tsx:73`; `src/_pages/plan-detail/ui/PendingProposalPage.tsx:191-193`
- **What**: After F1, `stopAffordance` returns `"stopping"` whenever an active job has a pending stop,
  and the page then renders `StoppingIndicator` instead of `StopAndKeep`. So `StopAndKeep` is never
  mounted with a non-null `stopRequestedAt` in the app; its own `if (job.stopRequestedAt !== null)`
  branch is reachable only from its unit test ("replaces the button with a Stopping… indicator once
  the request is durable"). One decision, two owners.
- **Fix**: Delete the branch and that test. `StoppingIndicator` stays a named export and the page
  stays the one place that picks between the two. If the branch is kept on purpose as a belt and
  braces, say so in a one-line comment, because today it reads as the pre-F1 design.

### S2 — `user-rows.ts` keeps `Person` and a guard that can never be false

- **Location**: `src/_pages/users/model/user-rows.ts:48-52, 68-71`
- **What**: After F9, `buildCreditedUsers` yields exactly one `CreditedUser` per directory entry, and
  that type already carries `id`, `label` and `isServiceAccount`. The `flatMap` with
  `user ? [...] : []` exists only to carry `entry` beside `label`, and the comment above it admits the
  guard is always true. `Person`, `DirectoryEntry` and the `entry.email ?? ""` sort key survive only
  for that.
- **Fix**: Build the rows from `[...credited.values()]`, sort on the label alone, and drop `Person`.
  `profileLabel`'s contract is that the email is always shown, as `secondary` when there is a name
  and as `primary` otherwise, so the email tiebreak is `label.secondary ?? label.primary`. That turns
  `byLabelThenEmail` into a function of `ProfileLabel`, which is what it was always comparing.

### S3 — The three "who stopped it" sentences are built twice

- **Location**: `src/_pages/plan-detail/ui/PendingProposalPage.tsx:288-294`;
  `src/_pages/plan-detail/ui/chrome/GenerationStatusStrip.tsx:244-264`
- **What**: `stoppedBeforeStart` and `haltedSummary` each branch on `by.kind` three ways and produce
  the same subjects ("You stopped this generation", "Stopped by <text>", "This generation was
  stopped") with a different tail. The strip's kept-checkpoint form is the one divergence ("Stopped
  early by <text>" rather than "Stopped by <text> early"). The subject is copy, and copy that two
  surfaces must keep in step belongs in `model/`, next to `stoppedBy`, which already exists for this.
- **Fix**: Add `stoppedSentence(by: StoppedBy, tail: string): string` to
  `model/generation/stopped-by.ts` (or let `stoppedBy` return the subject), and have both UI helpers
  call it with their tail. Decide whether the kept form becomes "Stopped by <text> early — kept…"
  so it fits the same template; if the current wording is preferred, keep that one string in the
  strip and route the other five through the helper. The strip tests pin every sentence, so the
  refactor is safe either way.

### S4 — `StoppedBy.user` is carried but never read

- **Location**: `src/_pages/plan-detail/model/generation/stopped-by.ts:8`
- **What**: The `user` variant holds both `user: CreditedUser` and `text`. Both consumers read
  `by.text` only. The test file also builds the `user` field, so it is asserted but unused.
- **Fix**: `{ kind: "user"; text: string }`. If S3 is done, `text` may go too, since the sentence
  helper can call `creditText` itself and the UI never touches the credit.

## Optional

### S5 — `stopAffordance` is called twice in the same JSX, and `canEdit` arrives twice

- **Location**: `src/_pages/plan-detail/ui/PendingProposalPage.tsx:124-127, 191-193`
- **What**: The `progress` case evaluates `stopAffordance(job, stop)` for the wrapper and again for
  the child. `PanelFor` also takes `canEdit` and `stop`, where `stop.canEdit` is the same value.
- **Fix**: Bind `const affordance = stopAffordance(job, stop)` once (the case needs a block), and
  pass either `stop` alone or `canEdit` plus `{ viewerId, canStopAnyJob }`.

### S6 — The pending page's `requestedBy` prop is fed the plan's `createdBy`

- **Location**: `src/pages/plans/[id]/index.astro:168`; `src/_pages/plan-detail/ui/PendingProposalPage.tsx:22-24`
- **What**: The route argues, correctly, that the session that pressed Generate wrote both the
  clone and the job, so the plan's creator is the job's requester. But the reader of the page sees
  `requestedBy: Credit | null` and must find that argument in the route. The job row carries
  `requested_by` of its own, which the view exposes as an id, so the name invites "why not that?".
- **Fix**: Either name the prop `createdBy` on the page and let the page's docblock (next to the
  "Requested by" copy) own the one-sentence equivalence, or leave it and move the argument into the
  prop's docblock so it is read where the name is. Resolving from `job.requestedBy` is not worth a
  second lookup.

### S7 — Two identical "best-effort credit" wrappers

- **Location**: `src/pages/plans/[id]/index.astro:121-125`; `src/_pages/plan-detail/api/generation-read.ts:232-236`
- **What**: Both sites call `loadCredit(...).catch(log, null)` with the same eslint-disable and the
  same reason. `loadCredit` has no other caller.
- **Fix**: Make `loadCredit` best-effort by design: return `Credit | null`, log inside, and say in its
  docblock that a credit is a label so a failed lookup is logged and shows nothing. The two call
  sites become one line each and the eslint-disable lives once, in `entities/user`.

### S8 — `STOP_FORBIDDEN_MESSAGE` is a verbatim copy of the guard's exception text

- **Location**: `src/_pages/plan-detail/api/generation-stop.ts:62`; migration line 203
- **What**: The constant is deliberate (the 42501 may also come from WITH CHECK, whose message is not
  user-facing), but nothing says the two sentences are meant to match, so they will drift silently.
- **Fix**: One comment line pointing at the migration, or accept the drift explicitly. No code change.

### S9 — `creditedTo` accepts mismatched brackets

- **Location**: `e2e/support/credit.ts:7`
- **What**: `^Created by (.+ \()?EMAIL\)?$` also matches "Created by EMAIL)" and "Created by Name
  (EMAIL". Harmless in a test, but the regex is harder to read than the two cases it stands for.
- **Fix**: `^Created by (?:.+ \(EMAIL\)|EMAIL)$`.

## Noted and left alone

- **`loadCreditedUsers` checks its own query errors** rather than calling `assertNoQueryErrors`.
  The ten-line docblock is long, but the constraint is real: the `entities/user` barrel is imported
  by islands, `@/shared/api`'s barrel value-exports `createClient`, and a by-path import of
  `@/shared/api/postgrest` is a steiger sidestep (the same reason `generation-actions.ts` gives for
  `solver-config`). Two inline lines are the right trade. The docblock could lose its last sentence
  without losing the reason.
- **`UserCredit`'s `inverse` variant** is "stacked layout plus inverted ink". Two orthogonal props
  would be purer, but with three real uses and one `Ink` table the enum is the simpler read.
- **The migration's header** runs to a hundred lines. That is this repo's convention for an
  access-control migration, and every paragraph answers a question a later reader will ask. Nothing
  to cut.

## What was not re-run

This pass read code only. The impl review's command table (`pnpm check`, lint, steiger, unit
suite, build, the attribution and role-matrix integration suites) stands as the evidence; none of
the findings above changes behaviour, so a re-run is due after whichever of S1 to S4 are applied.
