# Board View-State Convention Rewrite — Implementation Plan

## Overview

Rewrite the state-management convention (`ui-conventions.md` §"State management") on the evidence gathered in `frame.md`: correct three stale factual claims, separate Context from selector stores by their actual re-render semantics, and replace the categorical ban with an explicit adoption-trigger checklist plus a lane-choice rule for new board flags. Propagate the correction to the two downstream artifacts that carry the same stale claims (the `PlannerGrid.tsx` docblock and the lens research's §4 "trap" note), and capture the doc-drift failure class in `lessons.md`.

This is a **convention rewrite, not a store introduction** — zero runtime behavior change.

## Current State Analysis

Settled by `context/changes/board-view-state-store/frame.md` (Confidence: HIGH — lift its Hypothesis Investigation table for full evidence):

- `ui-conventions.md:219-235` bans "global store library (Zustand, Context)" in one breath, conflating broadcast Context with granular selector stores.
- Three factual claims in that section are contradicted by code: `useCellWiring` + its stabilizing `useMemo` (hook deleted in unify-views — `9c41cba`/`fec7b18`; wiring rebuilt fresh per render in `buildColumn`, `PlannerBoard.tsx:150-166`), `PairedPlannerGrid` (component gone), and "`dropHints`/`hintMode` change on every drag tick" (`dropHints` is set once per drag start/clear, `use-board-derivations.ts:52-65`; hover reactivity is per-cell `useDroppable`, `SlotCell.tsx:174`; `hintMode` changes on user toggle).
- The same per-tick claim lives in the `PlannerGrid.tsx:17-25` docblock (which cross-references the convention section), and a softened variant of the rationale lives in the lens research's §4 trap note (`context/changes/planner-board-search-discovery/research.md:129`).
- One adjacent stale reference outside the target section: `ui-conventions.md:24` cites a `groupByCell` bottom-of-file constant in `PlannerGrid` — the code uses `groupCellOccupants` imported from `model/collision/cell-occupants.ts`, computed mid-function (`PlannerGrid.tsx:8,83-85`).
- The frame refuted the store framing at its own scope (~1 of ~8 chain edit sites saved; one island on the page, `PlanDetailPage.astro:29`) and located the real per-flag cost (~15 sites) in persistence-module cloning (5× ~50-line `lib/` micro-stores), control-surface widening (`BoardSettingsMenu` value/setter pairs + bespoke control files), and transport-independent derivation plumbing (`use-board-derivations.ts` → `useCohortDerivations` → `toCohortState` → `useCombinedBoardState`).

## Desired End State

Every artifact that states the board's state-management rule is factually accurate against current code and cites verifiable file:line evidence. The convention answers the next "should this be a store?" challenge by checklist, not debate: explicit adoption triggers, a lane-choice rule for new flags, the current board evaluated as a worked example, and the measured cost centers named as the real improvement surface. `lessons.md` carries the drift class so future amendments don't outlive their mechanisms silently.

Verify by: the grep-based success criteria below pass; a reader can trace every claim in the rewritten section to a live symbol.

### Key Discoveries:

- The docblock and the convention section cite each other (`PlannerGrid.tsx:24` → §"State management") — they must change together.
- The research doc's trap-note claim is subtly different from the convention's: "a shared Context re-renders every cell on change" is TRUE (broadcast semantics); only the per-tick frequency premise tied to the <200ms budget is false. The addendum corrects the rationale, not the directive (thread via spread stays correct).
- `lessons.md` entries follow a fixed format: Context / Problem / Rule / Applies-to, class-level not incident-level.
- Research docs are dated snapshots with `last_updated` frontmatter — corrections go in as dated addenda, not silent rewrites.

## What We're NOT Doing

- **Not introducing a selector store, Jotai, or Context** — the frame refuted that remedy at its own scope.
- **Not refactoring the measured cost centers** (persistence micro-module cloning, control-slot widening, derivation seams) — they are named in the convention and recorded as a follow-up recommendation in `change.md`, nothing more.
- **Not opening a follow-up change folder** — the lens change may reshape what's worth consolidating.
- **Not touching the lens feature plan** — the lens threads the spread regardless (per `change.md`); only the research doc's *rationale* note gets an addendum.
- **Not auditing conventions outside §"State management"** — except the single flagged in-passing fix at `ui-conventions.md:24`.

## Implementation Approach

Two phases: first fix the normative sources (the convention section and its in-code copy, atomically), then propagate to downstream artifacts and capture the lesson. All edits are prose/comments; verification is grep-based plus the standard type/lint gates to prove the comment-only code edit is inert.

## Critical Implementation Details

**Timing & lifecycle** — the `PlannerGrid.tsx` docblock and `ui-conventions.md` §"State management" cite each other; land both in the same commit so no intermediate state has one contradicting the other.

**Research-doc integrity** — `planner-board-search-discovery/research.md` is a dated snapshot: append a dated update note under §4 and bump the `last_updated` frontmatter; do not rewrite the original §4 text in place.

## Phase 1: Rewrite the Normative Sources

### Overview

Replace the stale State-management section and its in-code docblock copy with evidence-based text; fix the adjacent stale symbol reference in passing.

### Changes Required:

#### 1. State-management section rewrite

**File**: `context/foundation/ui-conventions.md` (§"State management", lines 219-235)

**Intent**: Replace the categorical no-store rule and the drifted `plan-detail-refactor` amendment with an accurate, checklist-shaped rule that closes the "should this be a store?" debate by evidence rather than fiat.

**Contract**: The rewritten section must contain, with file:line citations that resolve against current code:

- **Semantics split**: Context (broadcast — every consumer re-renders on value change; React Compiler memoization does not shrink the fan-out) vs. selector store (`useSyncExternalStore` — only components whose selected slice changed re-render). The rule treats them as distinct tools; the old text banned both in one breath.
- **Corrected facts**: no `useCellWiring`/`PairedPlannerGrid` references; wiring is built per column in `buildColumn` (`PlannerBoard.tsx:150-166`, unmemoized); `dropHints` changes at drag start/clear (`use-board-derivations.ts:52-65`), `hintMode` on user toggle; per-hover reactivity is per-cell `useDroppable` (`SlotCell.tsx:174`).
- **Adoption-trigger checklist** — a store (or Context carrying a stable store ref) becomes warranted when at least one holds: (1) state must cross multiple React islands on one page; (2) a cross-cutting selection is consumed at many leaves while intermediate layers neither consume nor transform it; (3) per-flag persistence micro-modules have accumulated to where consolidating them into one store pays (today: five ~50-line clones under `lib/`); (4) optimistic mutation flows outgrow hooks. Each trigger evaluated against the current board (none met today — one island, `PlanDetailPage.astro:29`; the chain payload is per-cohort derived data; a selection-only store saves ~1 of ~8 chain sites).
- **Lane-choice rule** for a new board flag: consumed at grid level → direct `PlannerGrid` prop (`zoom` precedent); consumed per-cell/per-chip → `CellWiring` field + per-cell resolution in the grid (`hintMode` precedent); persisted device preference → `lib/` micro-store + chrome hook (`drag-hint-mode.ts` precedent); per-cohort derived data → derivation pipeline via `toCohortState`.
- **Named cost centers**: the measured per-flag cost (~15 edit sites) sits in persistence-module cloning, control-surface widening, and derivation-seam plumbing — pointer to `context/changes/board-view-state-store/frame.md` for the evidence.
- **Worked example**: the highlight lens evaluated against the checklist, concluding spread (kept as the amendment's replacement).

#### 2. Docblock correction

**File**: `src/_pages/plan-detail/ui/grid/PlannerGrid.tsx` (docblock, lines 17-25)

**Intent**: Correct the false frequency claim in the in-code copy of the rule while preserving the still-valid Context rejection (which stands on broadcast fan-out and the bundle solving per-hop re-listing, not on per-tick changes).

**Contract**: Comment-only edit — no code tokens change; `pnpm check` and `pnpm lint` must stay green. Keep the cross-reference to §"State management". State the actual cadence: `dropHints` set at drag start/clear, `hintMode` on toggle; hover reactivity is per-cell `useDroppable`.

#### 3. In-passing stale-symbol fix

**File**: `context/foundation/ui-conventions.md` (line 24)

**Intent**: The trailing-constants example cites `groupByCell` (`PlannerGrid`), which no longer exists — replace with a live example or drop the `PlannerGrid` mention (the `HINT_CLASS`/`toneClass` and `PLUGINS` examples still hold).

**Contract**: One line; same drift class as the main fix, explicitly in-passing.

### Success Criteria:

#### Automated Verification:

- No stale symbols remain: `grep -nE "useCellWiring|PairedPlannerGrid|groupByCell" context/foundation/ui-conventions.md` returns nothing
- False frequency claim gone from code: `grep -n "every drag tick" src/_pages/plan-detail/ui/grid/PlannerGrid.tsx` returns nothing
- Type gate green (comment-only code edit is inert): `pnpm check`
- Lint green: `pnpm lint`

#### Manual Verification:

- Every factual claim in the rewritten section resolves to a live symbol at the cited file:line
- The trigger checklist, applied to the highlight-lens case, yields the spread verdict (worked example is self-consistent)
- The docblock and the convention section tell the same story with no contradiction

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation that the manual review was done before proceeding to Phase 2.

---

## Phase 2: Propagate Downstream & Capture the Lesson

### Overview

Carry the corrected rationale into the lens research's trap note, add the drift-class lesson, and record the follow-up recommendation.

### Changes Required:

#### 1. Trap-note addendum

**File**: `context/changes/planner-board-search-discovery/research.md` (§4 "The one hard trap", line 129 region + frontmatter)

**Intent**: The directive (thread via `{...wiring}` spread, no Context, no inline `if`) remains correct — update its *rationale* to cite the rewritten convention and the frame verdict instead of the budget-tied per-tick premise.

**Contract**: Dated addendum appended under §4 (do not rewrite the original text); reference `board-view-state-store/frame.md` and the rewritten §"State management"; bump `last_updated` / `last_updated_by` frontmatter.

#### 2. Lessons entry

**File**: `context/foundation/lessons.md` (append)

**Intent**: Capture the class: convention amendments that cite specific mechanisms (hooks, components, frequency claims) go stale silently when refactors delete those mechanisms, and the stale text then propagates false premises into new research and change notes — as happened here (`change.md` inherited three false claims).

**Contract**: Standard format — Context / Problem / Rule / Applies-to. Rule shape: when writing or consuming a convention amendment that cites concrete code mechanisms, verify each cited symbol still exists (grep, not memory) before relying on it; when a refactor deletes a mechanism a convention cites, updating the convention is part of that refactor's definition of done. Applies-to: research, frame, plan, plan-review, impl-review. Class-level wording; the incident is the example, not the rule.

#### 3. Follow-up recommendation

**File**: `context/changes/board-view-state-store/change.md` (Notes)

**Intent**: Record the deferred decision so the cost-center evidence isn't lost: a future consolidation change (persistence micro-store genericization, `BoardSettingsMenu` control slot, derivation-seam plumbing) is worth considering **after** the lens lands and reshapes the surface.

**Contract**: Short note appended to Notes citing `frame.md`'s Narrowing Signals; no new change folder.

### Success Criteria:

#### Automated Verification:

- Addendum present and linked: `grep -n "frame.md" context/changes/planner-board-search-discovery/research.md` matches in §4's addendum
- Lesson landed: `grep -n "convention" context/foundation/lessons.md` shows the new entry heading
- Follow-up recorded: `grep -in "follow-up" context/changes/board-view-state-store/change.md` matches
- Full local gate unaffected: `pnpm check` and `pnpm lint`

#### Manual Verification:

- The lesson reads as a class rule (would have prevented this incident, applies beyond it)
- All cross-links resolve: frame ↔ plan ↔ research addendum ↔ convention

---

## Testing Strategy

Docs-and-comments change — no unit or integration tests apply. Verification is the grep assertions above plus `pnpm check` / `pnpm lint` to prove the single code-file edit (comment-only) is inert. Run `/verify` before commit to mirror the CI gate.

### Manual Testing Steps:

1. Read the rewritten §"State management" end-to-end, checking each file:line citation against the code.
2. Apply the trigger checklist to the highlight-lens case; confirm it concludes spread.
3. Confirm `git diff src/` shows only comment lines changed in `PlannerGrid.tsx`.

## Performance Considerations

None — no runtime change.

## Migration Notes

None — no schema, data, or API change.

## References

- Frame brief (authoritative problem statement): `context/changes/board-view-state-store/frame.md`
- Sibling research (trap note target): `context/changes/planner-board-search-discovery/research.md` §4
- Convention under rewrite: `context/foundation/ui-conventions.md:219-235` (+ line 24 in-passing)
- In-code copy: `src/_pages/plan-detail/ui/grid/PlannerGrid.tsx:17-25`
- Key commits: `bc794a0`, `bd0a1fa`, `9c41cba`, `fec7b18`, `6b32973`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Rewrite the Normative Sources

#### Automated

- [x] 1.1 No stale symbols remain in ui-conventions.md (grep useCellWiring|PairedPlannerGrid|groupByCell empty)
- [x] 1.2 "every drag tick" gone from PlannerGrid.tsx (grep empty)
- [x] 1.3 `pnpm check` passes
- [x] 1.4 `pnpm lint` passes

#### Manual

- [x] 1.5 Every factual claim in the rewritten section resolves at the cited file:line
- [x] 1.6 Trigger checklist applied to the lens case yields the spread verdict
- [x] 1.7 Docblock and convention section are contradiction-free

### Phase 2: Propagate Downstream & Capture the Lesson

#### Automated

- [ ] 2.1 Research §4 addendum present and links frame.md (grep matches)
- [ ] 2.2 New lesson entry present in lessons.md (grep matches)
- [ ] 2.3 Follow-up recommendation recorded in change.md (grep matches)
- [ ] 2.4 `pnpm check` and `pnpm lint` pass

#### Manual

- [ ] 2.5 Lesson reads as a class rule, not an incident report
- [ ] 2.6 All cross-links resolve (frame ↔ plan ↔ research addendum ↔ convention)
