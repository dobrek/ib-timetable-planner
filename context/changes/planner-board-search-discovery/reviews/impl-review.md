<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Planner Board Highlight/Discovery Lens

- **Plan**: context/changes/planner-board-search-discovery/plan.md
- **Scope**: Full plan (Phases 1–4)
- **Date**: 2026-07-04
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Verification summary

- All automated criteria re-run live and green: 923 unit tests, `pnpm check` (0 errors), `pnpm lint`, `pnpm steiger`, `pnpm build`, and `e2e/specs/lens-highlight.spec.ts` against local Supabase.
- Drift check: 14/14 planned items MATCH, 0 DRIFT of consequence, 0 MISSING. All "What We're NOT Doing" boundaries hold (no URL sync/CohortSwitcher change, no chip-anchored entry, no shelf highlighting, no AND mode, no per-criterion colors, no localStorage/micro-store, no store/Context consolidation, no schema changes).
- Unplanned files all justified supporting work: `lib/editable-target.ts` (guard extracted instead of copy-pasted; undo-keymap diff is import-swap only), `ui/lens/LensAnnouncer.tsx` (plan-mandated live region extracted so PlannerBoard stays an orchestrator), `ui-conventions.md` (one-line archived-path link fix), commit `469fc1a` (lens-scoped trigger-width layout fix, post-close).
- All Critical Implementation Details verified in code: hook ordering, post-mount hydration + write-through-before-hydration guard, four-layer Esc veto, cmdk `criterionId` identity + `keywords`, additive ring/dim composition, guarded sessionStorage (`planner-lens:<planId>`), plan-wide pruning universe, commit-only announcer.

## Findings

### F1 — Live region drops announcements when the message text repeats

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/plan-detail/ui/lens/LensAnnouncer.tsx:33
- **Detail**: The announcer only updates the DOM when the message string changes. Adding a second criterion that matches the same placements produces the identical string ("2 placements highlighted") → no DOM change → screen readers announce nothing, even though committed criteria changed — the exact event the plan's a11y contract says to announce.
- **Fix**: Include the criteria count in the message (e.g. "2 criteria — 2 placements highlighted") so the string changes whenever committed criteria do.
- **Decision**: FIXED — criteria-count prefix added to all non-clear announcements (incl. the zero-match case).

### F2 — `use-lens.ts` has no unit test despite carrying the trickiest state logic

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/_pages/plan-detail/ui/lens/use-lens.ts
- **Detail**: The hook holds hydrated-ref gating, write-through-skips-before-hydration ordering, preview-cleared-on-close, and prune-on-restore — the subtlest behavior in the change — covered only indirectly by one e2e happy path. Every comparable sibling (use-lens-keymap, lens-session, LensBar) is directly tested. Not a plan violation (Testing Strategy never listed a use-lens test), but the hydration-ordering guard is exactly the kind of invariant a future refactor silently breaks.
- **Fix**: Add a renderHook test pinning: (a) mount rehydration does not overwrite stored criteria, (b) setOpen(false) clears preview, (c) toggle add/remove round-trip with write-through, (d) restore prunes against the universe.
  - Strength: Locks the two ordering invariants that only comments protect today; all plumbing exists in sibling tests.
  - Tradeoff: ~an hour of test-writing for logic that currently works and is e2e-touched.
  - Confidence: HIGH — same pattern as use-lens-keymap.test.tsx.
  - Blind spot: None significant.
- **Decision**: FIXED — `ui/lens/use-lens.test.tsx` added (7 tests: rehydration non-clobbering, prune-on-restore write-back, no-op on empty storage, toggle/remove/clearAll write-through, preview-only-while-open, preview-drop-on-close).

### F3 — ⌘K opens the picker underneath an open modal

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/plan-detail/ui/lens/use-lens-keymap.ts:33
- **Detail**: Esc-clear is guarded four ways, but the ⌘K open chord fires unconditionally — pressing it while the collision-inspection dialog is open opens the picker beneath a focus-locked overlay.
- **Fix**: Early-return the open chord when inspectionOpen || hasOpenRadixLayer(), reusing the existing guards.
- **Decision**: FIXED — chord gated on the existing overlay guards; two mirror tests added (13 keymap tests green).

### F4 — Opening the picker immediately previews (dims against) the first item

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/plan-detail/ui/lens/LensPicker.tsx:53
- **Detail**: cmdk auto-highlights the first item on open, firing onValueChange — so merely pressing ⌘K dims the whole board against the first course before the user types or arrows. Consistent with "preview follows highlight", but worth confirming it's the intended feel.
- **Fix**: If unintended, ignore the initial auto-highlight (only preview after the first user navigation/filter); otherwise keep as-is.
- **Decision**: FIXED — preview gated behind first user interaction (capture-phase key/pointer arming, reset per open); e2e re-verified green.

### F5 — Restored session payload has no dedupe or size cap

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/_pages/plan-detail/lib/lens-session.ts:19
- **Detail**: A hand-edited same-origin payload of thousands of duplicate valid criteria would render that many bar chips. Self-inflicted only (own-origin sessionStorage), so low risk.
- **Fix**: Dedupe by criterionId and cap the list on read.
- **Decision**: FIXED — read path dedupes by criterionId and caps at 50; two test cases added (8 lens-session tests green).

### F6 — Intra-slice segment placement inconsistencies (twin keymaps; lib→model type import)

- **Severity**: 💬 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/_pages/plan-detail/ui/lens/use-lens-keymap.ts / src/_pages/plan-detail/lib/lens-session.ts:1
- **Detail**: The two DOM-keymap twins live in different segments (model/history/use-undo-keymap.ts vs ui/lens/use-lens-keymap.ts) — the new ui/ home is arguably right, but they disagree. Separately, lens-session.ts (lib) imports LensCriterion type-only from model/, inverting the slice's otherwise lib→model-free flow. Both benign; steiger doesn't police intra-slice direction.
- **Fix**: Note as a follow-up: relocate use-undo-keymap to ui/ (or accept the split) when next touching history code.
- **Decision**: FIXED (keymap half) — use-undo-keymap.ts + test moved to ui/history/, import + citing doc comments updated. ACCEPTED (lib→model half) — lens-session's import from model/lens (type + criterionId) stays; moving the criterion types out of model/lens.ts would ripple through the slice for a benign edge.

## Triage outcome (2026-07-04)

- Fixed: F1 (announcer criteria-count prefix), F2 (use-lens.test.tsx, 7 tests), F3 (⌘K overlay gating + 2 tests), F4 (preview gated behind first interaction), F5 (session read dedupe + cap at 50, + 2 tests), F6 keymap relocation.
- Accepted: F6 lib→model type import.
- Post-triage verification: full gate green — `pnpm check` 0 errors, 934 unit tests, lint, steiger, build, and `lens-highlight.spec.ts` e2e all pass.
