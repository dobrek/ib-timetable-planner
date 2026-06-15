---
change_id: test-plan-refresh-2026-06-15
title: Refresh test-plan guide after FSD refactor and rollout drift
status: implementing
created: 2026-06-15
updated: 2026-06-15
archived_at: null
---

## Notes

Refresh change for `context/foundation/test-plan.md`. The guide is stale: the FSD
architecture refactor landed and the rollout drifted. This change **updates the
guide** — it does not write tests. Explicit user direction (via `/10x-test-plan
--refresh`) authorizes editing §1/§2, not just §3/§6.

### What's stale (fix)

- **§1 principle #4**: premised on "refactor not yet done" — it LANDED (archive
  `2026-06-08-architecture-refactor`). Rewrite to past tense: the behavioral net
  held through the refactor (tests grew 15 → 55 unit + 9 integration, green).
  Keep "assert behavior at stable boundaries"; drop the "refactor pending" sequencing.
- **§2 Source column**: re-anchor stale dirs (`src/lib/placements`,
  `src/components/planner`, `src/components/auth`, `src/lib/grouping` — moved/gone)
  to FSD evidence dirs: `src/_pages/plan-detail/{model,ui,api}`,
  `src/_pages/sign-in/ui` + `src/pages/auth`, `src/shared/lib`, `src/actions`.
  Evidence only — no `file:line`.
- **§3**: remove the phantom `testing-validator-trust-core` folder (never existed);
  reconcile + re-sequence (target below).
- **§4 stack**: "15 files in `src/lib`" → 55 unit + 9 integration, live CI
  integration lane, factory harness in `src/test/factories/`; e2e still none
  (Playwright candidate-only).
- **§6.1 location**: `src/lib/placements/__tests__/` → co-located `*.test.ts` under
  slices (e.g. `src/_pages/plan-detail/model/collision.test.ts`). §6.2 already
  current (factory pattern). §6.3/6.4/6.5 stay TBD.
- **§7 don't-test**: `src/components/ui/*` → `src/shared/ui`; grouping core path
  moved. Substance unchanged (shadcn, marketing, generated types, grouping parity).
- **§8**: bump review dates to 2026-06-15; log the refactor trigger as resolved.

### What to add

- **Reconcile the shipped harness change** (`context/changes/data-for-e2e-and-integration-tests`,
  closed 2026-06-15) into §3 as a completed enabler step covering Risk #1 (validator
  oracle — confirmed independent), Risk #3 (Action-wrapper + API-route halves),
  Risk #4 (DB-write persistence).
- **New §2 risk — cross-cohort teacher collision (S-09)**: validator marks a Y2
  placement valid that reuses a teacher already occupied in Y1 (false-positive, new
  constraint class). Impact High / Likelihood Medium. Evidence: roadmap S-09
  (L226–238), PRD no-wrong-positive (L56). **Not testable until S-09 ships** (constraint
  class not built) — response is the §3 Phase 4 parity-harness gate; no code anchor.

### User direction (locked)

- **Next active rollout phase = Risk #5 (auth/RLS/PII)** — full gap (no auth-user
  factory, no unauthenticated/cross-author tests). Promote ahead of the drag-loop phase.
- **Promote S-09** into §2; fold its response into Phase 4.
- **Defer S-05 (silent overwrite) and S-08 (validator perf)** — revisit when those
  slices start.

### Target §3 (re-sequenced)

| # | Phase | Risks | Status |
|---|-------|-------|--------|
| 0 | Integration harness + CI lane (`data-for-e2e-and-integration-tests`) | enabler; #1/#3/#4 partial | complete |
| 1 | Validator trust core + API hot-path | #1, #3 (route) | complete |
| 2 | Auth + Astro Actions boundary + RLS/PII | #5, #3 (Actions) | NEXT — not started |
| 3 | Drag→feedback island/e2e + persistence reload | #2, #4 (reload-restore) | not started |
| 4 | Parity harness for new validator classes (owns S-09) | #1-class, S-09 | not started |

### Process

Refresh chain is research → plan → implement; the implement step rewrites the guide.
A later `/10x-test-plan` run against the refreshed guide then tees up the auth/RLS
rollout phase (Risk #5). Source: `/10x-test-plan --refresh` (2026-06-15).
