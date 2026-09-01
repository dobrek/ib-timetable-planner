# Hub-badge eviction + shared polling-store factory (F6) — Implementation Plan

## Overview

Two phases, one PR, two phase-ordered commits:

1. **Eviction** — fix the hub badge's eviction gap (the residual defect from `generation-deletion-integrity`): `job-progress-store.ts`'s union-biased `merge` keeps a remembered indicator forever after its job row is deleted (source-cascade) or dropped at the mapping edge (delivered-then-deleted). The fix is **replace semantics**: the tick queries *all* remembered jobIds (not just active ones) and the deduped response becomes the whole next snapshot.
2. **F6** — extract the shared polling-store factory to `src/shared/lib/polling-store/` and rebase both `job-progress-store.ts` and `use-pending-proposal.ts` on it, with phase 1's replace semantics as the factory's `read` contract and post-rebase readability as the abandon gate.

The provenance note (acknowledgement, FR-308 re-grounding) is **parked** into its own future change — see `research.md` "Decisions 2026-09-01".

## Current State Analysis

- `src/_pages/plans-list/model/job-progress-store.ts` (193 lines) — the hub's poll store. `tick` fetches `{ jobIds: activeJobIds(snapshot), planIds }` and publishes `merge(snapshot, fetched)`, a union keyed by planId where "a plan the fetch did not mention keeps what it had" (rule-4 terminal memory).
- `src/_pages/plan-detail/model/generation/use-pending-proposal.ts` — the pending page's poll store. Same lifecycle skeleton (38 byte-identical lines), 9 divergent sites (D1–D9 in `research.md` §1.1), replace-not-merge publish, an `announced` once-only latch.
- **The defect** (research follow-up §5): both server read paths now filter out delivered-then-deleted rows (`surfacedJobsFor` at `generation-status.ts:98`, `toGenerationIndicator` at `plan-indicators.ts:161`), and a deleted *source* cascades the job row away entirely — so the response simply omits the row, and `merge` keeps the remembered entry forever. Two orderings: a stale **"Ready — open"** badge whose `href` points at a deleted plan, or a frozen **"Generating"** badge that keeps `shouldRun()` true and polls every 5 s forever. Needs a second surface to trigger (delete from plan-detail, or a second hub tab) — a delete on the hub itself remounts the island.
- **Sharpened during planning:** eviction alone cannot fix the "Ready — open" ordering, because `activeJobIds` filters the refresh to *active* remembered jobs — a terminal remembered entry is never queried, so its absence from a response proves nothing. The refresh must widen to **all** remembered jobIds. `refreshKnown` (`generation-status.ts:52-60`) is deliberately unfiltered by status, so every row that still exists always comes back — which is what makes replace semantics safe for terminal memory.
- Both slice test suites drive only the public `subscribe`/`getSnapshot`/`getServerSnapshot`/`dispose` surface; nothing reaches internals. The hub suite (15 tests, jsdom via docblock) pins the **ungated** visibility tick at `job-progress-store.test.ts:167` and `:266`. The pending suite (8 tests) runs in **node with no `document`** — its entire visibility path is untested.
- `src/shared/lib/` holds 14 entries, all folder-with-barrel; `fsd/shared-lib-grouping` fires above 15 children, so `polling-store/` lands on the last free slot.

## Desired End State

- An open hub tab whose remembered job disappears server-side (deleted source, or delivered-then-deleted proposal) drops the badge on its next tick and stops polling if nothing else is active. No stale link, no forever-poll.
- One shared, domain-free `createPollingStore<T>` in `src/shared/lib/polling-store/` owns the timer/visibility/inFlight/listener lifecycle, with its own test suite covering that machinery (including the pending store's previously untested visibility path). Both slice stores are thin wirings over it; both slice suites are green **unchanged from their post-phase-1 state**.
- Verify: `pnpm test`, `pnpm lint`, `pnpm steiger`, `pnpm check`, `pnpm build` all green; manual two-tab check of the eviction; the readability gate on `job-progress-store.ts` passes (or phase 2 closes WONTFIX and commit 2 is dropped — phase 1 stands alone).

### Key Discoveries:

- `refreshKnown` returns queried rows "whatever state they are in — a terminal one is the answer, not a miss" (`generation-status.ts:51-60`) — so under query-all, replace semantics *preserve* every badge whose row still exists. Eviction falls out for free: gone from the response ⇔ gone from the world.
- 14 of the 15 hub tests survive replace semantics as-is: the rule-4 test (`job-progress-store.test.ts:138`) only ever fires one tick (the timer stops on terminal), and the request-shape test (`:149`) uses an *active* initial indicator, so `jobIds: [JOB_A]` holds under both old and new predicates. Only titles/comments may need honesty edits. **The one expected red** (plan-review F1): "keeps the snapshot's identity stable when nothing changed" (`:107`) fires 3 ticks but scripts 2 responses, and `scriptedFetcher`'s `queue.shift() ?? []` answers the third with an empty array — a no-op under merge, but "everything deleted" under replace, so the eviction publishes and both assertions fail. The honest edit is a third scripted `[indicator()]` response (the test's subject is "nothing changed", so the fetcher must keep saying so).
- The D6 difference ("merge vs replace") dissolves once phase 1 lands: the research's proposed `read: (current: T) => Promise<T>` seam already returns the next snapshot, so the factory needs no merge/evict option. Surface stays 4 required + 3 optional (research §1.1).
- The D4 bail (`planIds.length === 0 && activeJobIds(snapshot).length === 0`, `job-progress-store.ts:80`) is untested today and must be re-derived for query-all: the honest predicate becomes "nothing to ask" — empty planIds *and* empty snapshot.
- `readGenerationJobStatuses`' zod input caps `jobIds` at 200 (`plans-list/model/schemas.ts:39`); the remembered set is bounded by plans on the page plus discoveries, so query-all cannot breach it in practice.
- FSD forbids `shared` → `entities` imports, so `isActiveJobStatus` reaches the factory only inside the `isActive` closure — the constraint forces the right seam.

## What We're NOT Doing

- **The provenance note** — no `provenance_acked_at` migration, no dismiss Action, no FR-308 re-grounding, no strip changes. Parked as its own change (Q2 already decided there: acknowledged hides the strip entirely).
- No changes to `notified_at`, `pickJob`, `surfacedJobsFor`'s filter, or any server read path — the server halves shipped in `generation-deletion-integrity` and are correct.
- No denormalising the source name onto `plans` (research Q1: NO).
- No `refresh` export on the factory — neither store has one today; it would ship unused.
- Not touching the five localStorage store clones (research Q7: unrelated — that's `ui-conventions.md` adoption-trigger 3, a different refactor).
- Not changing the poll's externally observable shape: 5 s interval, timer only while something active, visibility-aware, idle hub issues nothing. The parked push-based-progress decision rests on this shape (`roadmap.md:297`).
- No E2E or integration additions for phase 1 (decided: unit-only; the two-surface repro's server halves are already integration-tested in the archived change). `e2e/specs/generation.spec.ts` untouched.
- No migration, no schema change, no `wrangler.jsonc` change.

## Implementation Approach

Phase 1 changes semantics in place, inside today's file, with its existing suite as the regression harness — deliberately *before* any extraction so the shipped regression's fix is not hostage to the readability gate. Phase 2 then extracts a factory whose `read` contract is exactly what phase 1 made the hub's tick body do (return the next snapshot), so the eviction semantics carry into the shared code by construction rather than by re-implementation.

Packaging: **one PR, two commits** (`fix(plans-list): …` then the `refactor: …`). If phase 2 fails its readability gate, it closes WONTFIX: drop commit 2, the PR ships phase 1 alone, and a cross-reference comment at each store notes the considered-and-declined extraction.

## Critical Implementation Details

- **D9 ordering (the one correctness trap).** The pending store fires `onDelivered()` *after* `publish`, and *outside* the `listeners.size > 0` guard (`use-pending-proposal.ts:97-101`). Both suites stay green if you get this wrong (fire before publish), so the factory's `afterTick(next)` contract must state and its suite must pin: called after the publish attempt, on every successful read, regardless of listener count.
- **D8 is pinned ungated.** `job-progress-store.test.ts:167` and `:266` both fail if the visibility tick is gated on `shouldRun()`. The factory's default must be an unconditional tick-on-visible; the pending store's `!announced` gate arrives via the optional `tickOnVisible` override.
- **Vitest environments.** The factory test needs `// @vitest-environment jsdom` as a file docblock — the `unit` project is node-only and the `dom` project matches `*.test.tsx` only (`vitest.config.ts:16-43`). The pending suite stays node (no `document`), which is precisely why the factory suite is non-optional: it is the only coverage of the centralised visibility machinery for that consumer.
- **Steiger ceiling.** `polling-store/` is child 15 of 15 in `src/shared/lib/` — the rule fires *above* 15, so this should pass silently, but run `pnpm steiger` before committing rather than trusting the arithmetic (a prior follow-up hit this exact wall). If it fires anyway, stop and surface it — regrouping `shared/lib` is its own decision, not a drive-by.

## Phase 1: Eviction — replace semantics in the hub store

### Overview

Make the hub poll's response authoritative: query all remembered jobs, replace the snapshot with the deduped response, delete `merge`. A job the server no longer returns — cascaded away with its source, or dropped at the mapping edge as delivered-then-deleted — loses its badge on the next tick, and a snapshot with nothing active left stops the timer.

Blast radius (plan-review F2): the only other consumer of snapshot transitions is `announcementsFor` (`generation-toasts.ts`, fed by `PlansHub.tsx`'s previous-snapshot ref). It iterates `current`, so an evicted entry announces nothing — a job deleted mid-run goes active → absent with no "Generation failed" toast, which is the intended silence for something the author deleted. No change there.

### Changes Required:

#### 1. The store

**File**: `src/_pages/plans-list/model/job-progress-store.ts`

**Intent**: Replace union-merge with replace semantics and widen the refresh so eviction is possible at all. Three code moves: the tick's request carries every remembered jobId (a `rememberedJobIds` helper over the whole snapshot, replacing `activeJobIds` in the request — `shouldRun` keeps using `isActiveIndicator` directly); `publish(indexByPlan(fetched))` replaces `publish(merge(snapshot, fetched))` and `merge` is deleted; the tick's bail becomes "nothing to ask" (`planIds` empty and snapshot empty).

**Contract**: The exported surface (`JobProgressStore`, `IndicatorsByPlan`, `JobProgressFetcher`, `createJobProgressStore`, `DEFAULT_POLL_INTERVAL_MS`) is unchanged. `JobProgressFetcher` still receives `{ jobIds, planIds }` — only which jobIds ride it changes. Docblock work is part of the change, per house style: rule 4 is amended from RAM-memory to server-confirmed memory ("a badge survives because the row still exists and the refresh re-reads it; a row the server no longer returns is gone, and its badge goes with it"), and the `merge` docstring's "terminal memory" argument moves/dies with it.

#### 2. The tests

**File**: `src/_pages/plans-list/model/job-progress-store.test.ts`

**Intent**: Pin the new semantics without disturbing what still holds. 14 of the 15 existing tests stay green (see Key Discoveries); adjust only titles/comments that now state the wrong reason (the request-shape test's "active jobs it knows" wording, the rule-4 test's framing). The identity-stability test (`:107`) is the one expected red — give it a third scripted `[indicator()]` response, not a semantics workaround. Standing rule for this suite (existing and new cases alike): an exhausted `scriptedFetcher` queue now means "everything deleted", so every test's response queue must cover its tick count. Add cases for: (a) a queried-but-absent terminal entry is evicted — the stale "Ready — open" shape; (b) a queried-but-absent *active* entry is evicted and, with nothing else active, the timer stops — the polls-forever shape; (c) a terminal entry whose row still comes back keeps its badge — server-confirmed memory works; (d) terminal remembered jobIds are included in the request; (e) the "nothing to ask" bail — closing the D4 untested-branch warning before phase 2 folds it into `read`.

**Contract**: Same scripted-fetcher/fake-timers idiom as the existing suite; no internals reached.

### Success Criteria:

#### Automated Verification:

- Hub store suite green: `pnpm test src/_pages/plans-list/model/job-progress-store.test.ts`
- Full unit suite green: `pnpm test`
- Lint and types: `pnpm lint`, `pnpm check`
- `merge` is gone: `grep -c "const merge" src/_pages/plans-list/model/job-progress-store.ts` returns 0

#### Manual Verification:

- Two-surface repro via `pnpm build && pnpm preview`: hub tab open, delete a delivered proposal from its plan-detail page (or a second tab) — the hub badge disappears on the next tick/visibility tick instead of freezing, and the network panel shows polling stop when nothing else is active

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before starting phase 2. Commit as `fix(plans-list): evict deleted jobs from the hub poll snapshot` (message wording free; type+scope per convention).

---

## Phase 2: F6 — the shared polling-store factory

### Overview

Extract the byte-identical lifecycle machinery into `src/shared/lib/polling-store/`, give it the test suite that is the whole point of the extraction, and rebase both stores on it. Behavior-preserving by definition: both slice suites green, unchanged from their post-phase-1 state.

### Changes Required:

#### 1. The factory

**File**: `src/shared/lib/polling-store/polling-store.ts` (new), `src/shared/lib/polling-store/index.ts` (new, pure barrel)

**Intent**: One generic, domain-free store owning: the `timer`/`inFlight`/`listeners` trio, `publish`-with-equality, the tick skeleton (guards → read → publish → afterTick → finally re-sync), `syncTimer`, the visibility listener lifecycle (attach on first subscriber, detach on last), `subscribe`/`getSnapshot`/`getServerSnapshot`/`dispose`, and `isVisible`. Imports nothing from `entities` (FSD-enforced); options shape declared with `type` (ESLint rule).

**Contract**: This signature is what both rebases and the suite depend on — the one snippet this plan pre-decides:

```ts
type PollingStoreOptions<T> = {
  initial: T;                                  // also the server snapshot (D2: derive T at the call site)
  isEqual: (a: T, b: T) => boolean;            // D3
  read: (current: T) => Promise<T>;            // D5+D6: returns the NEXT snapshot; bails by returning current
  isActive: (snapshot: T) => boolean;          // D7: drives the timer via shouldRun
  afterTick?: (next: T) => void;               // D9: after the publish attempt, outside the listeners guard
  tickOnVisible?: (snapshot: T) => boolean;    // D8: default unconditional (the hub's pinned rule 5)
  intervalMs?: number;                         // default 5000
};
type PollingStore<T> = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => T;
  getServerSnapshot: () => T;
  dispose: () => void;
};
export const createPollingStore = <T>(options: PollingStoreOptions<T>): PollingStore<T> => …
```

Behavioral invariants (the roadmap-protected shape): timer runs only while subscribed ∧ visible ∧ `isActive(snapshot)`; one read in flight at a time; a failed read keeps the snapshot and retries next tick; a read that resolves after the last subscriber left publishes nothing (but `afterTick` still fires); dispose is re-armable.

#### 2. The factory's suite

**File**: `src/shared/lib/polling-store/polling-store.test.ts` (new)

**Intent**: The centralised machinery's only direct coverage (~150–200 lines): the timer rules, the ungated-default visibility tick and the gated override, `inFlight` under a slow read, listener attach/detach lifecycle, StrictMode-style re-arm after dispose, equality-gated publish identity, and — pinned explicitly because no slice suite can catch it — `afterTick` firing after the publish attempt and outside the listeners guard.

**Contract**: `// @vitest-environment jsdom` docblock; fake timers + redefined `document.visibilityState` + dispatched `visibilitychange`, same idiom as the hub suite.

#### 3. Rebase the hub store

**File**: `src/_pages/plans-list/model/job-progress-store.ts`

**Intent**: `createJobProgressStore` becomes a wiring over `createPollingStore<IndicatorsByPlan>`: `initial: indexByPlan(initial)` (D2 at the call site), `isEqual: sameIndicators`, `read` = the phase-1 tick body (bail-by-returning-current, fetch all remembered jobIds + planIds, index the response), `isActive` = some `isActiveIndicator`. No `afterTick`, default `tickOnVisible`. `sameIndicators`, `indexByPlan`, `rememberedJobIds` and the five-rules docblock stay in the slice (rules re-worded to point at the factory for the mechanics they no longer implement).

**Contract**: Exported surface unchanged; `job-progress-store.test.ts` green with zero edits from its post-phase-1 state.

#### 4. Rebase the pending store

**File**: `src/_pages/plan-detail/model/generation/use-pending-proposal.ts`

**Intent**: `createPendingProposalStore` becomes a wiring over `createPollingStore<GenerationJobView | null>`: the `announced` latch stays a slice-local closure; `read: () => check(planId)`; `isActive: (s) => !announced && s !== null && isActiveJobStatus(s.status)`; `afterTick` carries the delivered-announce (`next?.delivered && !announced` → latch + `onDelivered()`); `tickOnVisible: () => !announced`. `sameView`, `reloadIntoBoard`, `usePendingProposal` unchanged.

**Contract**: Exported surface unchanged; `use-pending-proposal.test.ts` green with zero edits.

### Success Criteria:

#### Automated Verification:

- Factory suite green: `pnpm test src/shared/lib/polling-store/polling-store.test.ts`
- Both slice suites green with zero edits from their post-phase-1 state: `pnpm test src/_pages/plans-list/model/job-progress-store.test.ts src/_pages/plan-detail/model/generation/use-pending-proposal.test.ts` and `git diff --stat` shows neither test file touched in commit 2
- Full gates: `pnpm test`, `pnpm lint`, `pnpm check`, `pnpm build`
- `pnpm steiger` clean at 15 `shared/lib` children
- No timer left behind: `setInterval` appears in exactly one non-test file under `src/` (`grep -rln "setInterval" src --include="*.ts" --include="*.tsx" | grep -v test`)

#### Manual Verification:

- **The readability gate (Q6, decided):** post-rebase `job-progress-store.ts` is obviously easier to read than its pre-rebase 193 lines. If not — close phase 2 as WONTFIX, drop commit 2, add a cross-reference comment at each store, and the PR ships phase 1 alone
- Preview smoke (`pnpm build && pnpm preview`): hub badge advances during a solve, pauses on hidden tab, refreshes immediately on return; pending page still navigates into the board on delivery

**Implementation Note**: After this phase, both commits go up as one PR (squash-merged with `(#NN)` per convention). Do not merge to `main` while a production solve is running (README deploy rule).

---

## Testing Strategy

### Unit Tests:

- Phase 1: five new eviction/request-shape/bail cases in the hub suite (enumerated in Phase 1 §2); existing 15 preserved.
- Phase 2: the factory suite is the deliverable — it is the first and only direct coverage of the visibility machinery the pending store consumes, and it pins the `afterTick` ordering no slice suite can catch.

### Integration Tests:

- None added (decided). `generation-proposal.integration.test.ts` and `solver-transport.integration.test.ts` remain the end-to-end proof that the polled reads still drive delivery; they should pass untouched.

### Manual Testing Steps:

1. `pnpm build && pnpm preview`, local stack + solver up. Generate on a plan, open `/plans` in a second tab.
2. Watch the badge advance; hide the tab (network goes quiet), return (immediate tick).
3. After delivery, open the proposal once, then delete it from its detail page. Back in the hub tab: the badge disappears on the next visibility tick; no request loop remains.
4. Judge the readability gate on `job-progress-store.ts` (phase 2 only).

## Performance Considerations

Query-all widens the tick's `jobIds` from active-only to all remembered — bounded by the page's plans plus discoveries, far under the zod cap of 200, riding a request that was being made anyway. The poll's shape (5 s, active-only timer, visibility-aware, idle issues nothing) is explicitly preserved; the factory must not change it.

## Migration Notes

None — no schema, no wire contract, no config. Rollback is `git revert` of either commit; commit 2 reverts cleanly to the phase-1 state by construction.

## References

- Related research: `context/changes/extract-share-polling-store/research.md` (D1–D9 table §1.1; residual defect §5 of the follow-up; decisions section)
- Origin follow-up: `context/archive/2026-08-25-drift-decided-delivery/follow-ups/review-fixes.md:5-15` (F6)
- The two stores: `src/_pages/plans-list/model/job-progress-store.ts:61-145`, `src/_pages/plan-detail/model/generation/use-pending-proposal.ts:59-147`
- D8 pins: `src/_pages/plans-list/model/job-progress-store.test.ts:167`, `:266`
- Unfiltered refresh: `src/_pages/plans-list/api/generation-status.ts:52-60`
- Mapping-edge drop: `src/_pages/plans-list/model/plan-indicators.ts:161-183`
- Shape constraint: `context/foundation/roadmap.md:297` (parked push-based progress)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Eviction — replace semantics in the hub store

#### Automated

- [x] 1.1 Hub store suite green (`pnpm test src/_pages/plans-list/model/job-progress-store.test.ts`) — 8686c1e
- [x] 1.2 Full unit suite green (`pnpm test`) — 8686c1e
- [x] 1.3 Lint and types green (`pnpm lint`, `pnpm check`) — 8686c1e
- [x] 1.4 `merge` deleted from `job-progress-store.ts` — 8686c1e

#### Manual

- [x] 1.5 Two-surface repro verified in preview: badge evicts, polling stops — 8686c1e

### Phase 2: F6 — the shared polling-store factory

#### Automated

- [x] 2.1 Factory suite green (`pnpm test src/shared/lib/polling-store/polling-store.test.ts`) — a0e164c
- [x] 2.2 Both slice suites green with zero test-file edits in commit 2 — a0e164c
- [x] 2.3 Full gates green (`pnpm test`, `pnpm lint`, `pnpm check`, `pnpm build`) — a0e164c
- [x] 2.4 `pnpm steiger` clean at 15 `shared/lib` children — a0e164c
- [x] 2.5 `setInterval` in exactly one non-test file under `src/` — a0e164c

#### Manual

- [x] 2.6 Readability gate passed (or phase 2 closed WONTFIX and commit 2 dropped) — a0e164c
- [x] 2.7 Preview smoke: badge lifecycle + pending-page delivery unchanged — a0e164c
