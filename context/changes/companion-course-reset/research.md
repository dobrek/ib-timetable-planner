---
date: 2026-07-02T19:36:53+0200
researcher: Dobromir Kropielnicki
git_commit: 59094cd970b7c3c9de5cc042b5a7804fe136a827
branch: main
repository: ib-timetable-planner
topic: "Reset the companion-course selector when the leading course changes (feasibility + effort)"
tags: [research, codebase, plan-detail, palette, grouping-filter, companion-course, ui-state]
status: complete
last_updated: 2026-07-02
last_updated_by: Dobromir Kropielnicki
---

# Research: Reset the companion selector when the leading course changes

**Date**: 2026-07-02T19:36:53+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: `59094cd970b7c3c9de5cc042b5a7804fe136a827`
**Branch**: main
**Repository**: ib-timetable-planner

## Research Question

When we built the companion-course selector for the planner-board palette, we decided to **keep** the companion selection when the leading course changes, provided the new grouping set still contains at least one grouping where the companion co-occurs. User feedback: they dislike this — they expect that **changing the leading course always resets the companion selector** back to "Any companion". Check the feasibility and the effort needed to make this change.

## Summary

**Feasible, low-risk, and very small — well under one session.** The change is confined to a single hook (`usePaletteFilter` in `PaletteBody.tsx`) plus a handful of co-located tests. Zero impact on schema, data, load path, Astro Actions, or the <200ms drag-drop validation budget (the palette filter is a render-time concern, not on the placement path).

The key finding is a **doc/implementation mismatch that is the root of the feedback**:

- The original plan's prose and its top-risk mitigation both said the companion should *"reset to Any companion whenever the leading course changes"* ([plan.md desired-end-state](../../archive/2026-06-24-companion-course/plan.md), Challenge #1 in [research.md](../../archive/2026-06-24-companion-course/research.md)).
- But what was actually implemented is a **validity guard, not a change reset**: `reconcileCompanion(companionId, options)` keeps the companion *iff* it is still present in the recomputed option list ([`reconcile-companion.ts:10-11`](https://github.com/dobrek/ib-timetable-planner/blob/59094cd970b7c3c9de5cc042b5a7804fe136a827/src/_pages/plan-detail/model/grouping/reconcile-companion.ts#L10-L11)). It has no notion of "the leading course changed" — it only sees the current option list.

So when the leading course changes to another course where the old companion *still co-occurs*, the companion is silently carried over. That is exactly the behavior the user wants gone.

**The fix**: reset the companion to `null` on every leading-course change, regardless of whether it would still be valid. The leading course is set in exactly one production place ([`PaletteBody.tsx:50`](https://github.com/dobrek/ib-timetable-planner/blob/59094cd970b7c3c9de5cc042b5a7804fe136a827/src/_pages/plan-detail/ui/palette/PaletteBody.tsx#L50), `onChange={setLeadingCourseId}`), so this is a ~3–5 line change. Two implementation shapes fit (a change-handler reset, or a render-phase previous-value tracker — see below). The `reconcileCompanion` validity guard stays as a residual safety net for the cohort-switch/data path.

## Detailed Findings

### 1. Where the behavior lives — `usePaletteFilter` in `PaletteBody.tsx`

The palette filter is one thin orchestrator hook. The whole reset mechanism is these lines ([`PaletteBody.tsx:107-129`](https://github.com/dobrek/ib-timetable-planner/blob/59094cd970b7c3c9de5cc042b5a7804fe136a827/src/_pages/plan-detail/ui/palette/PaletteBody.tsx#L107-L129)):

```ts
export function usePaletteFilter(groupings, courseDisplay) {
  const [leadingCourseId, setLeadingCourseId] = useState<string | null>(null);
  const [companionCourseId, setCompanionCourseId] = useState<string | null>(null);

  const companionOptions = sortByName(companionCourseOptions(groupings, courseDisplay, leadingCourseId));

  // Adjust-state-during-render (not an effect, precedent PlannerBoard): if the companion is no longer
  // among the current options — because the leading course changed or cleared — drop it to null...
  const validCompanion = reconcileCompanion(companionCourseId, companionOptions);   // :116
  if (validCompanion !== companionCourseId) setCompanionCourseId(validCompanion);   // :117

  const visibleGroupings = filterGroupings(groupings, leadingCourseId, validCompanion);
  return { leadingCourseId, setLeadingCourseId, companionCourseId: validCompanion, ... };
}
```

- The reset happens *only* via `reconcileCompanion`, which is a validity guard — it keeps a companion that is still among `companionOptions`, drops one that isn't ([`reconcile-companion.ts:10-11`](https://github.com/dobrek/ib-timetable-planner/blob/59094cd970b7c3c9de5cc042b5a7804fe136a827/src/_pages/plan-detail/model/grouping/reconcile-companion.ts#L10-L11)):
  ```ts
  companionId !== null && options.some((o) => o.id === companionId) ? companionId : null;
  ```
- **This cannot express "reset on change".** A validity guard resets only when the state is *inconsistent* with derived data. "Reset even though the companion would still be valid" requires detecting the *change event*, which this function structurally can't see.
- The two other pure helpers are unaffected: `companionCourseOptions` computes the cascading option list ([`companion-course-options.ts:17-25`](https://github.com/dobrek/ib-timetable-planner/blob/59094cd970b7c3c9de5cc042b5a7804fe136a827/src/_pages/plan-detail/model/grouping/companion-course-options.ts#L17-L25)); `filterGroupings` applies the two membership predicates ([`filter-groupings.ts:9-18`](https://github.com/dobrek/ib-timetable-planner/blob/59094cd970b7c3c9de5cc042b5a7804fe136a827/src/_pages/plan-detail/model/grouping/filter-groupings.ts#L9-L18)).

### 2. Leading-change wiring — a single writer

- `GroupingFilter` leading `<Select onValueChange>` → `onChange(next === ALL ? null : next)` ([`GroupingFilter.tsx:86-90`](https://github.com/dobrek/ib-timetable-planner/blob/59094cd970b7c3c9de5cc042b5a7804fe136a827/src/_pages/plan-detail/ui/palette/GroupingFilter.tsx#L86-L90)).
- `onChange` is wired to `setLeadingCourseId` at [`PaletteBody.tsx:50`](https://github.com/dobrek/ib-timetable-planner/blob/59094cd970b7c3c9de5cc042b5a7804fe136a827/src/_pages/plan-detail/ui/palette/PaletteBody.tsx#L50).
- `setLeadingCourseId` is set in **exactly one production place** — that `onChange` wire. No effect, no external caller, no cohort logic touches it. (Confirmed by full-slice search; other references are test-only.) This is why a change-handler reset is safe and complete.

### 3. Lifecycle — when the filter state persists vs. resets

The companion/leading `useState` behaves as follows (no `key=` on `PaletteBody` or `CombinedPalettePanel`, so it is the same instance across in-mount changes):

| Event | Filter state | How companion is handled today |
| --- | --- | --- |
| **Leading-course change** (in-mount) | **persists** | kept if still co-occurs (the disliked behavior); reset only if invalid |
| **Cohort switch** (combined mode, both cohorts "ready") | **persists** (no key) | leading carried over verbatim; companion reconciled — kept if still valid in the new cohort |
| **Cohort switch** to a stale/empty cohort | **unmounts** `PaletteBody` (view ternary) → fresh on return | reset (remount) |
| **Recompute / stale refresh** | **resets to `null`** | full-document `refreshPage()` → `navigate()` remounts the `client:load` island |

Render tree: `pages/plans/[id]/index.astro` → `PlanDetailPage.astro` → `PlannerBoard` (island) → `BoardShell` `palette={<CombinedPalettePanel/>}` ([`PlannerBoard.tsx:222-229`](https://github.com/dobrek/ib-timetable-planner/blob/59094cd970b7c3c9de5cc042b5a7804fe136a827/src/_pages/plan-detail/ui/PlannerBoard.tsx#L222-L229)) → `PaletteBody` (rendered only in the `view === "ready"` branch, [`CombinedPalettePanel.tsx:94-100`](https://github.com/dobrek/ib-timetable-planner/blob/59094cd970b7c3c9de5cc042b5a7804fe136a827/src/_pages/plan-detail/ui/palette/CombinedPalettePanel.tsx#L94-L100)).

**Implication for scope:** the user's complaint is only reachable through the **leading-change (in-mount)** row. Recompute already resets everything (island remount); the recent commit `59094cd` persists only *which cohort's groupings are shown* (via a cookie in [`palette-cohort.ts`](https://github.com/dobrek/ib-timetable-planner/blob/59094cd970b7c3c9de5cc042b5a7804fe136a827/src/_pages/plan-detail/lib/palette-cohort.ts)), **not** the leading/companion selection. So the fix needs to target only the leading-change path; the cohort-switch behavior is a separate, pre-existing decision (see Open Questions).

### 4. Precedent for the reset pattern

The slice uses **adjust-state-during-render** for resets, but only in its *validity-guard* form (reset when current state is inconsistent with fresh data) — there is **no** previous-value change-detector anywhere in `src/_pages/plan-detail/` yet:

- Canonical precedent: `useCollisionInspection` ([`chrome/board-inspection.ts:21-24`](https://github.com/dobrek/ib-timetable-planner/blob/59094cd970b7c3c9de5cc042b5a7804fe136a827/src/_pages/plan-detail/ui/chrome/board-inspection.ts#L21-L24)) — `if (target && !collisions.has(...)) setTarget(null)`.
- Its combined-shell twin: [`PlannerBoard.tsx:101-106`](https://github.com/dobrek/ib-timetable-planner/blob/59094cd970b7c3c9de5cc042b5a7804fe136a827/src/_pages/plan-detail/ui/PlannerBoard.tsx#L101-L106).
- The companion reconcile itself is the third instance (`PaletteBody.tsx:116-117`).

A "reset on change" needs either a change-handler or a render-phase previous-value comparison — a new-but-analogous pattern.

## Implementation Options

Both are tiny and touch only `PaletteBody.tsx`. `reconcileCompanion` stays for the cohort-switch/data validity path in both.

### Option A — reset in the leading-change handler (recommended, minimal)

Wrap the leading setter so it also clears the companion, and return the wrapped function under the name the UI/tests already use:

```ts
const changeLeading = (next: string | null) => {
  setLeadingCourseId(next);
  setCompanionCourseId(null);   // always reset — the crux of the feedback
};
// return { leadingCourseId, setLeadingCourseId: changeLeading, ... }
```

- **Why it's complete:** `setLeadingCourseId` has exactly one production caller (`GroupingFilter` `onChange`), and Radix `Select` fires `onValueChange` only on an actual change — so this resets the companion on every real leading change (including clear-to-"All groupings") and never spuriously.
- **`reconcileCompanion` unchanged** → its unit tests stay green. It now only fires for the cohort-switch/data path (where leading is unchanged).
- Batched setters → the next render sees `leading = new, companion = null`; reconcile is a no-op that render.

### Option B — render-phase previous-value tracker (idiom-consistent alternative)

```ts
const [prevLeading, setPrevLeading] = useState(leadingCourseId);
if (leadingCourseId !== prevLeading) {
  setPrevLeading(leadingCourseId);
  setCompanionCourseId(null);
}
```

- Fires on any leading change regardless of source (more robust, but that robustness is theoretical here since leading is only ever handler-driven).
- Consistent with the slice's "reset stale state during render, not in a handler" preference — but it *adds* a second adjust-state block alongside reconcile, so it's slightly more code and subtlety.

**Recommendation:** Option A. It is the smaller, more obvious change; the "single writer" fact makes the handler approach fully sufficient, and it leaves `reconcile-companion.ts` (and its tests) untouched.

## Effort & Blast Radius

- **Production code:** ~3–5 lines in one file (`PaletteBody.tsx`). No new `model/` function needed (Option A). No schema/data/load/action/API changes.
- **Docstrings to correct** (to prevent the same prose/impl drift recurring):
  - `usePaletteFilter` comment ([`PaletteBody.tsx:100-106`](https://github.com/dobrek/ib-timetable-planner/blob/59094cd970b7c3c9de5cc042b5a7804fe136a827/src/_pages/plan-detail/ui/palette/PaletteBody.tsx#L100-L106)) and the inline reconcile comment (`:113-115`).
  - `reconcile-companion.ts` header ([`:3-8`](https://github.com/dobrek/ib-timetable-planner/blob/59094cd970b7c3c9de5cc042b5a7804fe136a827/src/_pages/plan-detail/model/grouping/reconcile-companion.ts#L3-L8)) still calls itself "the pure core of the reset-on-leading-change rule" — reword to "residual validity guard for the cohort-switch/data path".
- **Tests:**
  - **Must add a discriminating case.** The existing "stale reset" tests pass under *both* the old and new behavior because the shared fixture can't express "companion still co-occurs with the new leading" ([`CombinedPalettePanel.test.tsx:25-27`](https://github.com/dobrek/ib-timetable-planner/blob/59094cd970b7c3c9de5cc042b5a7804fe136a827/src/_pages/plan-detail/ui/palette/CombinedPalettePanel.test.tsx#L25-L27) — fixture `g1:a+b, g2:a+c, g3:c+d`, where `b` co-occurs only with `a`). Add a grouping such as `c-b + c-d`, then assert that switching leading `c-a → c-d` **still resets** the companion even though `b` remains a valid option for `d`. This is the assertion that actually proves the new behavior.
  - Update the two now-misleading tests + their comments: the hook test [`CombinedPalettePanel.test.tsx:68-83`](https://github.com/dobrek/ib-timetable-planner/blob/59094cd970b7c3c9de5cc042b5a7804fe136a827/src/_pages/plan-detail/ui/palette/CombinedPalettePanel.test.tsx#L68-L83) and the rendered-Select test [`:148-179`](https://github.com/dobrek/ib-timetable-planner/blob/59094cd970b7c3c9de5cc042b5a7804fe136a827/src/_pages/plan-detail/ui/palette/CombinedPalettePanel.test.tsx#L148-L179).
  - **Option A:** `reconcile-companion.test.ts` stays as-is (reconcile keeps its keep-if-valid semantics for the data path). **Option B:** if reconcile is refactored/removed, `reconcile-companion.test.ts` (esp. [`:8-10`](https://github.com/dobrek/ib-timetable-planner/blob/59094cd970b7c3c9de5cc042b5a7804fe136a827/src/_pages/plan-detail/model/grouping/reconcile-companion.test.ts#L8-L10), the "keeps the companion" assertion) changes with it.
  - **Unaffected:** all of `companion-course-options.test.ts` (5), all of `filter-groupings.test.ts` (6), and the rest of `CombinedPalettePanel.test.tsx`.
- **Verify gate:** standard `pnpm check` / `test` / `lint` / `steiger` / `build` (the `/verify` skill). No E2E needed (the leading filter has none; pure ephemeral client filter).

**Estimated effort:** ~1 short session — a few lines of code, two docstring edits, one fixture addition, and updating/adding ~2–3 test assertions.

## Risks & Gotchas (prioritized)

| # | Severity | Risk | Mitigation |
| --- | --- | --- | --- |
| 1 | MEDIUM | **Non-discriminating tests give false confidence.** The current "stale reset" tests go green under both behaviors, so a green suite would *not* prove the fix works. | Add the `c-b+c-d`-style grouping and assert reset-even-when-still-valid (see Effort). |
| 2 | LOW | **Prose/impl drift recurs.** The original mismatch (doc says "reset", code "keeps") is exactly what generated this feedback. | Correct the `usePaletteFilter` + `reconcile-companion.ts` docstrings as part of the change. |
| 3 | LOW | **Hook return API.** Tests drive `result.current.setLeadingCourseId(...)`; the wrapped setter must be exposed under that same key (or the tests updated to the new name). | Return `changeLeading` as `setLeadingCourseId` (Option A). |
| 4 | LOW | **Scope creep to cohort switch.** Deciding to also reset on cohort switch would widen the change. | Keep out of scope unless requested (Open Question). |

## Architecture Insights

- **Model owns decisions; the hook orchestrates.** The reset lives in the hook, not the presentational `GroupingFilter`. Option A keeps that seam; the reset-on-change is a UI-orchestration concern (resetting a dependent select), which is idiomatic to keep in the hook.
- **Validity guard ≠ change detector.** The whole bug is a category error: a validity guard was used where a change reset was intended. The lesson *"Orchestration over patching"* ([MEMORY.md]) and the slice's adjust-state-during-render precedents are about *validity* resets; this is the first *change* reset in the slice.
- **Performance:** irrelevant — the palette filter is render-time `.filter()`/`Map` work, explicitly off the <200ms drag-drop path (`useCollisions`/`deriveCellViolations`).

## Historical Context (from prior changes)

- [`context/archive/2026-06-24-companion-course/plan.md`](../../archive/2026-06-24-companion-course/plan.md) — the feature plan. Desired End State: *"resets to 'Any companion' whenever the leading course changes or clears (a dangling companion can never silently mis-filter)."* Progress items 2.8 ("Changing/clearing the leading course resets… the companion") were checked off — but the implemented `reconcileCompanion` only enforces the *clears/invalidates* half, not *changes*. This is the source of the feedback.
- [`context/archive/2026-06-24-companion-course/research.md`](../../archive/2026-06-24-companion-course/research.md) — Challenge #1 (HIGH): *"the companion selection must reset when the leading course changes/clears."* Correctly identified; the reconcile-during-render mitigation under-delivered on the "changes" case.
- [`context/archive/2026-06-24-companion-course/plan-brief.md`](../../archive/2026-06-24-companion-course/plan-brief.md) — Success Criteria: *"Changing/clearing the leading course (or switching cohort) always resets the companion."* Never actually achieved for the "still-valid on change" case.
- Commit `59094cd` (2026-07-02) — persists the combined-mode palette *cohort* across a recompute refresh (cookie-backed), but explicitly not the leading/companion filter selection; confirms recompute = full island remount.
- The slice was refactored since the archive: the hook moved `PlannerPalette.tsx` → `PaletteBody.tsx`, and `model/*` → `model/grouping/*` (files otherwise unchanged in behavior).

## Code References

- [`src/_pages/plan-detail/ui/palette/PaletteBody.tsx:107-129`](https://github.com/dobrek/ib-timetable-planner/blob/59094cd970b7c3c9de5cc042b5a7804fe136a827/src/_pages/plan-detail/ui/palette/PaletteBody.tsx#L107-L129) — `usePaletteFilter`; the reset lives at `:116-117`; leading wired at `:50`. **The change point.**
- [`src/_pages/plan-detail/model/grouping/reconcile-companion.ts:10-11`](https://github.com/dobrek/ib-timetable-planner/blob/59094cd970b7c3c9de5cc042b5a7804fe136a827/src/_pages/plan-detail/model/grouping/reconcile-companion.ts#L10-L11) — the validity guard (keeps a still-valid companion).
- [`src/_pages/plan-detail/ui/palette/GroupingFilter.tsx:86-123`](https://github.com/dobrek/ib-timetable-planner/blob/59094cd970b7c3c9de5cc042b5a7804fe136a827/src/_pages/plan-detail/ui/palette/GroupingFilter.tsx#L86-L123) — leading Select (`onChange`) + companion Select (disabled until leading set).
- [`src/_pages/plan-detail/model/grouping/companion-course-options.ts:17-25`](https://github.com/dobrek/ib-timetable-planner/blob/59094cd970b7c3c9de5cc042b5a7804fe136a827/src/_pages/plan-detail/model/grouping/companion-course-options.ts#L17-L25) — cascading option list (unaffected).
- [`src/_pages/plan-detail/model/grouping/filter-groupings.ts:9-18`](https://github.com/dobrek/ib-timetable-planner/blob/59094cd970b7c3c9de5cc042b5a7804fe136a827/src/_pages/plan-detail/model/grouping/filter-groupings.ts#L9-L18) — two-predicate filter (unaffected).
- [`src/_pages/plan-detail/ui/palette/CombinedPalettePanel.tsx:94-100`](https://github.com/dobrek/ib-timetable-planner/blob/59094cd970b7c3c9de5cc042b5a7804fe136a827/src/_pages/plan-detail/ui/palette/CombinedPalettePanel.tsx#L94-L100) — view ternary that mounts/unmounts `PaletteBody`.
- [`src/_pages/plan-detail/ui/chrome/board-inspection.ts:21-24`](https://github.com/dobrek/ib-timetable-planner/blob/59094cd970b7c3c9de5cc042b5a7804fe136a827/src/_pages/plan-detail/ui/chrome/board-inspection.ts#L21-L24) — canonical adjust-state-during-render precedent (validity-guard form).
- `src/_pages/plan-detail/ui/palette/CombinedPalettePanel.test.tsx:25-27, 68-83, 148-179` — fixture + the two tests to update.
- `src/_pages/plan-detail/model/grouping/reconcile-companion.test.ts:8-10` — the "keeps the companion" assertion (changes only under Option B).

## Related Research

- `context/archive/2026-06-24-companion-course/research.md` — original feasibility study for the companion filter (this change reverses one of its state-lifecycle decisions).

## Open Questions

1. **Cohort switch (combined mode):** should switching cohort also reset the companion? Today it keeps a still-valid companion via `reconcileCompanion`. The feedback is about *leading change* only; recommend leaving cohort-switch behavior as-is unless the user wants symmetry. **(default: out of scope)**
2. **Option A vs B:** confirm the handler-reset (A) is acceptable, or prefer the render-phase previous-value tracker (B) for strict consistency with the slice's adjust-state-during-render idiom. Recommendation: A.
3. **Does the leading course itself need any change?** No — leading behavior is unchanged; only the companion reset trigger changes.
