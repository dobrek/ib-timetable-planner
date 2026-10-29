<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Current-Plan Marker (S-404)

- **Plan**: context/changes/current-plan-marker/plan.md
- **Mode**: Deep
- **Date**: 2026-10-29
- **Verdict**: REVISE → SOUND after triage (all six fixed in the plan)
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding

25/25 paths ✓, 14/14 symbols ✓, brief↔plan ✓, Progress↔Phase ✓ (all 29 rows match). Confirmed: a viewer's `select … for update` passes UPDATE USING (`can_read`) and fails WITH CHECK (42501 → FORBIDDEN); only `markPending` sets `pending_proposal = true`, and only on a fresh clone; the hub never re-sorts its rows; `action-capabilities.test.ts` covers new actions automatically.

## Findings

### F1 — Marker tests race each other across test files

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Blind Spots
- **Location**: Phase 1 §1 (matrix probe), Critical Implementation Details, Phase 2 §7
- **Detail**: The plan's isolation rule (plan.md:66) forbids reading the table afterwards to see which plan is current, but the role-matrix probe does exactly that: it calls the RPC, then reads `is_current` back with the service role. With `--maxWorkers=2`, `current-plan.integration.test.ts` moves the marker at the same time, so a move between the call and the read-back makes an allowed cell read "denied". Second path: when two `set_current_plan` calls overlap, the loser gets 23505. `probeWrite` then throws "not an access denial", and `markCurrentPlan` throws CONFLICT. "unmarkCurrentPlan clears the marker on the plan that holds it" and a `true` assertion in the loader case also assume the marker stays put between two calls. The integration lane is already red about 1 run in 5, and it gates deploy.
- **Fix A ⭐ Recommended**: The RPC takes `pg_advisory_xact_lock` first; the probe counts the returned row as proof the write landed; loader and unmark cases made race-free
  - Strength: Removes both causes at the source; "last write wins" holds with no exception.
  - Tradeoff: Drops the decided "a true race gets CONFLICT"; a move made in the same few ms as another wins silently.
  - Confidence: HIGH — in read-committed mode each statement takes a new snapshot after the lock wait.
  - Blind spot: Unmark (a plain update) doesn't take the lock; it can't make a second plan current.
- **Fix B**: Keep CONFLICT; the probe uses the returned row, and the tests retry on 23505
  - Strength: The RPC stays as decided.
  - Tradeoff: Retry logic in tests; any test that forgets it is still flaky.
  - Confidence: MEDIUM.
  - Blind spot: A local e2e run against the same stack can still collide.
- **Decision**: FIXED (Fix A)

### F2 — Re-marking the current plan bumps "Last updated"

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §2 (RPC + trigger), Phase 1 §4 tests
- **Detail**: `WHEN (old.is_current is not distinct from new.is_current)` still fires when an update writes `true` over `true`. If the RPC always sets the target, marking a plan that is already current (from an out-of-date hub) bumps `updated_at`, which breaks the end-state promise.
- **Fix**: The RPC sets the target only `where … and not is_current`, then `return query select …`; add a test that re-marking leaves updated_at unchanged.
- **Decision**: FIXED

### F3 — Nothing automated proves anon can't execute the RPC

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §2 grants; Manual 1.8
- **Detail**: The `anon: denied` cell can't catch a missing revoke. If anon could execute the RPC, it would match no `to authenticated` policy and return empty, which still reads "denied". `roleFunctionExecutors` (role-matrix.integration.test.ts:260-267, 493-504) already makes this check for `own_app_role`.
- **Fix**: Add `public.set_current_plan(uuid)` → `["authenticated"]` to that catalog test; make 1.8 an automated criterion.
- **Decision**: FIXED

### F4 — Phase 3 misses some affected files and one side effect

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 3
- **Detail**: (a) The `load-plan-summary.test.ts:8-14` fixture needs `is_current`, or `pnpm check` fails. (b) `PlannerBoard`'s `Props` (`PlannerBoard.tsx:41-58`) and its destructure gain `isCurrent`. (c) The board branch builds `plan` from `result.value` (`index.astro:125`). (d) The current plan becomes the first compare column whenever ticked (`compareHref` follows row order), which looks like a baseline position.
- **Fix**: List (a)–(c) in Phase 3; either state (d) as accepted or order compareHref by name.
- **Decision**: FIXED ((d) recorded as an accepted side effect in Phase 2 §6)

### F5 — The migration doesn't copy its model's lock_timeout

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 1 §2
- **Detail**: The model migration `20261028200630` caps lock waits at 5s. This one takes an exclusive lock on `plans` (ADD COLUMN, ADD CHECK) during the deploy on merge.
- **Fix**: Add `set local lock_timeout = '5s'` to the migration contract.
- **Decision**: FIXED

### F6 — UI details left for the implementer to guess

- **Severity**: ℹ️ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §5–6, Phase 3 §2, Phase 4 §1
- **Detail**: (a) `useConfirmAction` fits: call it in `PlanRowActions` with `onDone` as a no-op. (b) An `aria-label` on a plain span isn't reliably announced; use `sr-only` text. (c) The sidebar label `<p>` is `truncate uppercase`, so the badge must sit outside it. (d) "Unmark as current" contains "Mark as current", so e2e locators need `exact: true`.
- **Fix**: Write (a)–(d) into the Phase 2, 3 and 4 contracts.
- **Decision**: FIXED
