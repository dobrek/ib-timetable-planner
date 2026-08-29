# Review follow-ups — drift-decided-delivery

Queued from `reviews/impl-review.md` (2026-08-29). Not part of the S-306 PR.

## F6 — Extract a shared polling-store factory

- **Where**: `src/_pages/plan-detail/model/generation/use-pending-proposal.ts:59-147` duplicates
  `src/_pages/plans-list/model/job-progress-store.ts:61-145` (listeners, `inFlight`, `syncTimer`,
  visibility listen/unlisten, `dispose`); the two already differ in visibility gating.
- **Do**: add `src/shared/lib/polling-store.ts` — a factory taking `{ shouldRun, tick, initial }` that
  owns the timer/visibility lifecycle and exposes `subscribe`/`getSnapshot`/`refresh`/`dispose` — with
  its own unit tests; rebase both stores on it. Keep the store-specific parts (indicator merge, the
  `delivered` navigation latch) in the slices.
- **Guard**: both existing test suites (`job-progress-store.test.ts`, `use-pending-proposal.test.ts`)
  must stay green unchanged.
