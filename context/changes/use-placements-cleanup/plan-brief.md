# use-placements.ts Cleanup — Plan Brief

> Full plan: `context/changes/use-placements-cleanup/plan.md`

## What & Why

`use-placements.ts` (737 lines, the island-local optimistic write path for the two-cohort timetable) is well-factored but carries avoidable repetition, a verbatim-duplicated key function (a real reconciliation-drift hazard), and a misleading premise: the slice enforces React-Compiler-safe discipline but the compiler is **lint-only** — no auto-memoization is actually happening. This change pays down the repetition, fixes two small behavior warts, splits out the undo/redo executor, and turns the compiler on for real.

## Starting Point

The hook is pure orchestration over tested transition modules (`placement-transitions.ts`, `shelf-transitions.ts`, `history/reconcile-apply.ts`). It owns five responsibilities (board store, shelf store, snapshotting, edit recording, the reconcile executor) and is consumed via `use-cohort-board-state.ts`, feeding `history/use-history.ts`. The compiler is wired as an ESLint rule (`eslint.config.js:68`) but `babel-plugin-react-compiler` is absent from the build.

## Desired End State

A shorter hook that reads as the forward write path: the reconcile/undo machinery lives in `useReconcileExecutor`, RPC calls go through one bound `rpcs` object, repeated fragments are pure tested helpers, and the duplicated key fn is gone. Duplicates label correctly on undo, a successful edit clears a stale error banner, and the React Compiler runs in the build — so the discipline the slice already enforces yields its memoization payoff. Full CI gate clean; <200ms drag-drop budget intact.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| React Compiler | Enable the babel plugin in this change | The discipline cost is already paid (lint passes), so enabling it unlocks the memoization payoff | Plan |
| Executor split | Extract `useReconcileExecutor` as the final refactor phase | Clean fracture line aligned to the existing `CohortHistoryApi` projection; sequenced after `rpcs` shrinks the seam | Plan |
| Duplicate label | Add a `"duplicate"` `EditKind` | Undo currently mislabels a duplicate as "Place group" | Plan |
| Error slot | Clear on successful edit + document the rest | Fixes a stale banner lingering over a now-good board; racing-capture/last-writer-wins are hard and low-impact | Plan |
| Generic write wrapper | Rejected | Batch variants diverge enough that one wrapper reads worse than targeted extractions | Plan |
| Store split | Rejected | Two-store-atomic ops need synchronous access to both stores | Plan |

## Scope

**In scope:** dedup `businessKey`; extract `groupFailureError` / `outcomesByCourse`+`MemberOutcome` / `occupantsAt`; `useLatest` comment; `makeRpcs` factory; `"duplicate"` label; clear-error-on-success; concurrency-limit docs; `useReconcileExecutor`; enable React Compiler app-wide.

**Out of scope:** RPC/action or schema changes; splitting the two stores; a generic `runOptimistic` wrapper; changing undo/redo semantics; serializing the forward path; hand-written `useMemo`/`useCallback`.

## Architecture / Approach

Land the safe, test-covered mechanical work first (Phases 1–2), then the small behavior changes (Phase 3), then the one architectural refactor (Phase 4 — `useReconcileExecutor`, with `snapshot` injected and `resolveCardId` kept local), and finally the isolated app-wide build change (Phase 5) so the hook is compiled in its final shape and the riskiest change reverts alone. The full CI gate stays green between phases.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Mechanical extractions & dedup | Shared key + 3 pure helpers + ref-lag comment | Low — behavior-preserving, test-covered |
| 2. `makeRpcs` factory | One bound RPC object across persist + reconcile | Test mocks target the underlying clients — keep that working |
| 3. Small behavior changes | `"duplicate"` label; clear-error-on-success; risk docs | Clear-error ordering must precede the groupFailure set |
| 4. Executor split | `useReconcileExecutor` extracted from the hook | Wide injected-deps seam (refs + setters) |
| 5. Enable React Compiler | Compiler runs in the workerd build | App-wide; perf budget + React-dedup/SSR must hold |

**Prerequisites:** none beyond a clean working tree; local Supabase only for integration/e2e (the unit suites cover this work).
**Estimated effort:** ~2–3 sessions across 5 phases; Phases 1–4 are mechanical/architectural, Phase 5 is config + broad verification.

## Open Risks & Assumptions

- Enabling the compiler is app-wide; it should help re-renders but must not regress the <200ms drag budget or the `ssrPrebundleDeps()` single-React-instance fix.
- `babel-plugin-react-compiler` must resolve to a version compatible with React 19 and the installed `eslint-plugin-react-compiler ^19.1.0-rc.2`.
- The racing-`before`-capture and last-writer-wins error behaviors are documented, not eliminated — accepted as low-impact given gesture timing.

## Success Criteria (Summary)

- The board behaves identically through Phases 1–4 (add/move/remove/group/shelf/duplicate/undo-redo), with the new `"duplicate"` undo label and stale-banner clearing as the only visible changes.
- `use-placements.ts` no longer contains the reconcile executor or the duplicated key fn, and routes RPCs through `rpcs`.
- The React Compiler runs in the build with `pnpm check`/`lint`/`test`/`steiger`/`build` all green and drag-drop within budget.
