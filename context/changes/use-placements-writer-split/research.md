---
date: 2026-06-29T15:42:09+02:00
researcher: Dobromir Kropielnicki
git_commit: f14612a
branch: main
repository: 10xdev3
topic: "Feasibility check of the usePlacements writer-split proposal (report.md)"
tags: [research, codebase, plan-detail, use-placements, refactor-feasibility]
status: complete
last_updated: 2026-06-29
last_updated_by: Dobromir Kropielnicki
last_updated_note: "CORRECTED — original verdict was based on a stale local main; after pulling the merged use-placements-cleanup work, the report's premises all hold. Verdict flipped from 'premises false' to 'report accurate, proposal feasible as written'."
---

# Research: Feasibility check of the `usePlacements` writer-split proposal

**Date**: 2026-06-29 (corrected same day after `git pull`)
**Researcher**: Dobromir Kropielnicki
**Git Commit**: f14612a (`fix(use-placements-cleanup): read history via useSyncExternalStore …`)
**Branch**: main
**Repository**: 10xdev3

## Research Question

Read `report.md` (the proposal to split `usePlacements` into a `WriteContext` + `board-writes`/`shelf-writes` factories) and **check its feasibility** against the actual codebase.

## ⚠️ Correction note (read first)

The **first pass of this research checked a stale local `main`** that was 11 commits behind `origin/main`. On that stale tree the report's §1 "already shipped" premises looked false. After `git pull` brought in the merged **`use-placements-cleanup`** work (commits `d7fdb95`…`f14612a`: mechanical extractions, `makeRpcs` p2, `useReconcileExecutor` p4, React Compiler p5), **every §1 premise holds**. The verdict below is the corrected one. The lesson — *verify the baseline (fetch/pull) before declaring a report's premises false* — is worth keeping.

## Summary

**Verdict: the report is accurate against current `main`, and the writer-split is feasible essentially as written.** The `use-placements-cleanup` change already shipped the foundation the report assumes, so the writer-split is a clean next increment rather than a re-baselining job.

| Report §1 premise | Status on `main` (f14612a) | Evidence |
|---|---|---|
| RPCs bound once via `api/rpcs.ts` `makeRpcs(planId, cohort)`, shared by forward path + executor | ✅ TRUE | [`rpcs.ts:13-35`](src/_pages/plan-detail/api/rpcs.ts); `const rpcs = useMemo(() => makeRpcs(planId, cohort), …)` [`use-placements.ts:155`](src/_pages/plan-detail/model/use-placements.ts); persisters call `rpcs.placeCourse(…)` etc. |
| Reconcile executor extracted to a hook with stores injected by ref + setter | ✅ TRUE | [`use-reconcile-executor.ts`](src/_pages/plan-detail/model/history/use-reconcile-executor.ts); consumed at [`use-placements.ts:159-167`](src/_pages/plan-detail/model/use-placements.ts) |
| Its param type is a **structural subset** of the proposed `WriteContext` (§6) | ✅ TRUE | `ReconcileExecutorDeps` = `{ snapshot, placementsRef, parkedBundlesRef, setPlacements, setParkedBundles, setError, rpcs }` ([`use-reconcile-executor.ts:23-32`](src/_pages/plan-detail/model/history/use-reconcile-executor.ts)) — all 7 fields ⊂ the 9-field `WriteContext` |
| `placementBusinessKey` shared from `history/affected-slice.ts` | ✅ TRUE | `import { memberSetKey, placementBusinessKey } from "./affected-slice"` [`use-reconcile-executor.ts:7`](src/_pages/plan-detail/model/history/use-reconcile-executor.ts) |
| React Compiler enabled (`babel-plugin-react-compiler` in `astro.config.mjs`) | ✅ TRUE | [`astro.config.mjs:41-43`](astro.config.mjs) (`target: "19"`); dep `babel-plugin-react-compiler: 1.0.0` ([`package.json:64`](package.json)) |
| Two known limits documented in-code (single error slot; `useLatest` ref-lag) | ✅ TRUE | error slot [`use-placements.ts:145-147`](src/_pages/plan-detail/model/use-placements.ts); `useLatest` footgun [`use-placements.ts:653-657`](src/_pages/plan-detail/model/use-placements.ts) |

**Net:** the proposal's Phases 0–4 are all feasible. Phase 4 ("point `useReconcileExecutor` at `ctx`") is now **nearly free**: because `ReconcileExecutorDeps` is a structural subset of `WriteContext`, passing `ctx` where the executor expects its narrower deps **typechecks by structural subtyping with no change to the executor** (excess-property checks fire only on fresh object literals, not on a `ctx` variable). The only genuinely new artifacts are `write-context.ts`, `board-writes.ts`, `shelf-writes.ts` — none have ever existed (`git log -S WriteContext` empty).

## Detailed Findings

### A. The motivation (§2) still holds — the hook is function-dense

`usePlacements` ([`use-placements.ts:128-651`](src/_pages/plan-detail/model/use-placements.ts), ~520-line body) declares **12 public handlers + 10 `persist*` orchestrators + helpers** (`weekModeOf` 169, `recordEdit` 176, `courseIdsAt` 267, `cellScope` 617, `snapshot` 623). `applyReconcile` is no longer inline (it moved into `useReconcileExecutor` during the cleanup), so the hook is already leaner than the pre-cleanup version — but the forward write path is still the long "list of inner functions" the report targets. ~9 of the 12 handlers are near-pure `void persist*` forwarders; `movePlacement`, `removePlacement`, `duplicateBundle` carry real logic.

### B. `WriteContext` maps cleanly to what the hook already closes over

| `WriteContext` field (§3.1) | Source in the hook |
|---|---|
| `rpcs` | `useMemo(() => makeRpcs(planId, cohort), …)` (155) |
| `placementsRef`, `parkedBundlesRef` | `useLatest(...)` (150–151) |
| `setPlacements`, `setParkedBundles`, `setError` | `useState` (143–148) |
| `recordEdit`, `snapshot`, `weekModeOf` | inner fns (176, 623, 169) |
| `cellScope` (helper alongside) | inner fn (617) |

Because `rpcs` is pre-bound, `WriteContext` does **not** need `planId`/`cohort` (the earlier-feared gap is already solved by `makeRpcs`). The board factory additionally needs the duplicate-search oracle inputs (`catalogById`, `availabilityIndex`, `crossCohortIndex`, `days`, `periods`) + `setLastDuplicated` — the report's `boardDeps` — which match `findDuplicateTarget`'s inputs ([`use-placements.ts:241-250`](src/_pages/plan-detail/model/use-placements.ts)).

### C. Phase 4 is a near-no-op given the current executor

`useReconcileExecutor` already takes exactly the subset of `WriteContext` it needs ([`use-reconcile-executor.ts:23-57`](src/_pages/plan-detail/model/history/use-reconcile-executor.ts)). Phase 4 reduces to passing the assembled `ctx` instead of the inline object literal at [`use-placements.ts:159-167`](src/_pages/plan-detail/model/use-placements.ts). Optionally retype its param to `WriteContext` for intent — but not required for compilation.

### D. Tests stay green (the primary regression guard)

`use-placements.test.tsx` drives only the public hook surface (`renderHook` + returned handlers) and mocks `../api/placement-client` / `../api/shelf-client` **by module path**. `makeRpcs` re-binds those same module exports ([`rpcs.ts:3-4,8-9`](src/_pages/plan-detail/api/rpcs.ts) — "suites that mock those modules keep working unchanged"), and the writer-split keeps the public return surface identical. So moving persisters into factories does not touch the test's interception path. New factory unit tests (the §10 "payoff") would follow the framework-free `*-transitions.test.ts` style.

### E. steiger / FSD — clean

`steiger.config.ts` is `...fsd.configs.recommended`, no overrides. Three new `.ts` files under `src/_pages/plan-detail/model/placement/` are files within an existing segment (not new slices), repeating the pattern of the peer modules already there; model→api imports are already on `main`. (Confirm with an actual `pnpm steiger` run per phase.)

### F. Memoization decision is well-grounded

React Compiler is genuinely enabled (Finding §Summary), and `toCohortState` already rebuilds its `actions` object every render unmemoized ([`use-cohort-board-state.ts`](src/_pages/plan-detail/model/use-cohort-board-state.ts)) on `main` with green CI. So §7's "leave factories unmemoized" stands on both legs.

## Code References

- `src/_pages/plan-detail/model/use-placements.ts:155` — `rpcs = useMemo(makeRpcs…)`
- `src/_pages/plan-detail/model/use-placements.ts:159-167` — `useReconcileExecutor({ … })` call (Phase-4 target)
- `src/_pages/plan-detail/model/use-placements.ts:180-284` — 12 public handlers (≈9 forwarders)
- `src/_pages/plan-detail/model/use-placements.ts:286-614` — 10 `persist*` orchestrators
- `src/_pages/plan-detail/model/history/use-reconcile-executor.ts:23-32` — `ReconcileExecutorDeps` (⊂ `WriteContext`)
- `src/_pages/plan-detail/api/rpcs.ts:13-35` — `makeRpcs` / `Rpcs` (8 pre-bound methods)
- `astro.config.mjs:41-43` — React Compiler babel plugin
- `context/archive/2026-06-29-use-placements-cleanup/` — the merged predecessor change

## Architecture Insights

- The writer-split is the **third** application of one fracture pattern in this slice: pure transitions (`*-transitions.ts`) → reconcile executor (`useReconcileExecutor`, ref+setter injection) → forward writers (`board-writes`/`shelf-writes`, `WriteContext` injection). Strong consistency argument.
- The cleanest `WriteContext` is a **superset of `ReconcileExecutorDeps`** (adds `recordEdit`, `weekModeOf`). Define it that way so the executor consumes it unchanged.
- `lessons.md` priors that apply: "Green build/test/lint ≠ type-safe — `pnpm check` is the mandatory type gate" (the `ctx`-threading change is exactly where esbuild passes while `astro check` catches assignability breaks); "Astro Actions are the single transport" (the `rpcs` path already honors this).

## Historical Context (from prior changes)

- `context/archive/2026-06-29-use-placements-cleanup/plan.md` + `plan-brief.md` — the predecessor that shipped `makeRpcs`, `useReconcileExecutor`, and the React Compiler. Its brief explicitly left "a generic `runOptimistic` wrapper" and further decomposition **out of scope** — i.e., the writer-split was a deliberate stopping point, now picked up here.
- `reviews/impl-review.md` in that folder — worth a skim for any compiler-related caveats (the tip commit fixed a history-label issue under the compiler).

## Open Questions

(Original #1 — "is there an unmerged branch with these artifacts?" — is now **resolved**: yes, it was `use-placements-cleanup`, since merged to `main`.)

1. **Scope:** full split (Phases 0–4) vs. "Move 1 only" vs. stop-at-Phase-3. Given Phase 4 is now nearly free, the full split is cheap — but the user owns the call.
2. **Split axis / naming:** board/shelf (report's choice) vs. single-store/cross-store.
3. **Testing deliverable:** add new factory unit tests now (the §10 payoff), or rely on the existing hook test staying green.

## Recommendation

Proceed with the writer-split **as the report describes** — the baseline it assumes is real on `main`. Define `WriteContext` as a superset of `ReconcileExecutorDeps`, keep RPCs flowing through the existing `rpcs` object (no new indirection), and treat Phase 4 as a trivial "pass `ctx`" step. The remaining decisions (full vs. partial scope, axis naming, whether to add factory unit tests) are for planning to settle with the user.
