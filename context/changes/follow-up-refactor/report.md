# Follow-up review report — optional-subject-in-bundle

- **Date:** 2026-07-07
- **Branch reviewed:** `feat/optional-subject-bundle` (`main...HEAD`, 80 files, ~2.6k insertions)
- **Method:** 8 independent finder angles (line-by-line, removed-behavior, cross-file tracing, reuse, simplification, efficiency, altitude, conventions) → dedup → adversarial verification per candidate. 15 candidates verified; 10 survived, 5 refuted.
- **Headline:** the feature is correct on the happy path, but two confirmed bugs let the author's pending `is_optional` decisions be lost on the merge and undo paths. The recurring quality theme is **missing single homes** — this change paid the copy-tax in five separate places, and each copy is a drift risk.

---

## A. Correctness — fix before merge

### A1. Unshelve-merge clobbers a board chip's optional flag; client never reconciles it — **CONFIRMED**

`supabase/migrations/20260707120001_place_course_optional.sql:63` + `src/_pages/plan-detail/model/placement/shelf-writes.ts:104-146`

`place_course`'s on-conflict clause was a documented no-op (`do update set bundle_id` only, per `20260624120004`); it now also sets `is_optional = excluded.is_optional`, with `p_is_optional` defaulting to `false`. Two consequences compound:

1. **Server:** the merge case (parked card contains a course already placed at the target cell) has `unshelve_bundle` call `place_course` with the shelf twin's flag — the conflict update overwrites the board row's flag. The migration's own comment documents the trap ("a caller that omits p_is_optional … RESETS a pending optional decision") instead of encoding it.
2. **Client:** `persistPlaceBack` excludes the already-present member from `entries` (`eligibleMembers`), and `outcomesByCourse` maps only over `entries` — the returned server row for that member is discarded. The board keeps rendering the stale flag; UI and DB diverge until reload.

**Failure scenario:** course A placed and marked optional → drop a parked card also containing A (flag `false`) onto A's cell → DB row resets to non-optional, chip keeps showing "optional", the cue silently vanishes on reload.

**Action points** — **DONE** in `4de588d` (resolution below)
- [x] Merge semantics decided: `is_optional` now matches `week`'s protection exactly — a single-writer column (`update_placement_optional`), applied to fresh inserts only. Migration `20260707140000` (re-created from the latest live definition per `lessons.md`) restores the conflict clause to the pure bundle_id no-op — stricter than the coalesce option: a re-place can *never* clobber the flag, passed or not.
- [x] Client reconcile change unnecessary under preserve-always semantics: the merge case no longer mutates the row, so the discarded returned row equals the row the client already renders. (The existing `shelf-writes.ts` comment "idempotent on the present one" is accurate again.)
- [x] Integration tests: the replay test now pins preservation (was pinning the clobber), and a new merge-case test asserts the board twin's flag and id survive place-back.

### A2. Undo of a flag flip is a non-atomic delete+insert — **CONFIRMED**

`src/_pages/plan-detail/model/history/reconcile-exec.ts:72-73` (+ `affected-slice.ts:48-49`, `rpcs.ts:33`)

`isOptional` is now part of `placementBusinessKey`, so undoing a mark/accept diffs as `toRemove=[A@old]` + `toPlace=[A@new]` for the **same cell**. None of the atomic fast-paths apply (`asPureRelocation` rejects same-cell, `asLift`/`asPlaceBack` need card changes), so it falls to `executeDecomposed`: `removeBundleMembers` then `placeCourse` as two awaited RPCs. `ReconcileDeps` has no update op even though `rpcs.updatePlacementOptional` exists.

**Failure scenario:** undo a mark-optional while the connection degrades → remove commits (server row gone), place rejects → local rollback re-shows the chip, but a reload loses the course-hour entirely — from a flag-only revert.

**Action points** — **DONE** in `2a10108` (resolution below)
- [x] `asOptionalFlips` recognizer in `reconcile-exec.ts` (mirrors `asPlaceBack`): every remove pairs 1:1 with a place at the same (course, cell, week) differing only in the flag → one in-place `update_placement_optional` per member. Row ids resolve from the executor's pre-mutation capture (`resolvePlacementId`, mirroring `resolveCardId`); unresolvable ids fall back to the decomposed sequence.
- [x] `ReconcileDeps` extended (`setOptional` + `resolvePlacementId`); unit tests cover pure flip, multi-member flip, unresolved-id fallback, and mixed-plan rejection; a hook-level test drives the flip through `usePlacements.applyReconcile`.
- [x] Failure-injection made structurally unnecessary for flips (no remove+place window exists); instead the integration round-trip pins **id preservation** across the undo, proving the in-place path.

### A3. New e2e chip-menu helpers: wrong-menu short-circuit + missing cohort param — **PLAUSIBLE (latent)**

`e2e/support/board.ts:195` (short-circuit), `:208` (chipMenuSelect)

- `openChipMenu`'s retry short-circuit checks page-wide `page.getByRole("menu").count() > 0` — any open menu satisfies it, and `chipMenuSelect` clicks a page-wide `menuitem`. Radix's dismiss-on-pointerdown makes current call sites safe, but the generic item names ("Mark as optional", "Accept") are exposed to wrong-menu selection.
- `chipMenuSelect`/`removeViaMenu` never forward a cohort though `openChipMenu` accepts `cohort: "DP1" | "DP2" = "DP1"`. No DP2 call site exists yet; the first one fails loudly (locator timeout) — an API asymmetry waiting for the next spec.

**Action points**
- [ ] Scope the already-open check and the menuitem click to the target chip's menu (e.g. via `aria-controls`/`aria-expanded` on the trigger, or scope the menu lookup to the triggering cell).
- [ ] Thread `cohort` through `chipMenuSelect` and `removeViaMenu`.

---

## B. Refactor — the "single home" sweep

Every item below was verified as genuine duplication this change either created or had to pay for. Order roughly by drift risk.

### B1. Placement row→domain mapper triplicated — **CONFIRMED**

`src/_pages/plan-detail/api/placements.ts:71`, `src/_pages/student-plan-view/api/loader.ts:206`, `src/_pages/teacher-plan-view/api/loader.ts:174`

Three field-identical `toPlannerPlacement` mappers (each with its own inline row type) over the single shared select in `src/shared/api/load-placements.ts`. This PR hand-edited all three to thread `is_optional`. FSD forbids cross-page imports — which is exactly why it keeps being re-declared.

**Action points**
- [ ] Hoist the mapper (and a canonical `PlacementRow` type) to `src/entities/timetable` next to `PlannerPlacement` — the FSD-legal home all three slices already import from. (**Not** `shared/api`: shared cannot import upward from entities.)
- [ ] Delete the three private copies; a future optional domain field then can't silently drop out of one perspective.

### B2. Optional visual axis duplicated across four components / two layers — **CONFIRMED**

`PlacedChip.tsx:82`, `GroupDragOverlay.tsx:96`, `ParkedBundleCard.tsx:86`, `widgets/timetable-board/ui/ScheduleGrid.tsx:173`

`border-dashed saturate-75` spelled verbatim four times; the italic `optional` tag span (`data-slot="optional-tag"`) three times (once as a private `OptionalTag`). The dim strategy is load-bearing (saturate, not opacity, so a dimmed blocking chip still reads red) — that rationale lives in one copy's comment only.

**Action points**
- [ ] Export `optionalChipClass` beside `subjectChipClass` in `src/shared/config/subject-colors.ts` (all four files already import from there); move the saturate-vs-opacity rationale into its doc comment.
- [ ] Add one shared tag component (e.g. `src/shared/ui/optional-tag.tsx`) and use it in all three tag sites.

### B3. Single-field write machinery cloned instead of parameterized — **CONFIRMED**

`board-writes.ts:363` (`persistSetOptional` vs `persistSetWeek:339`), `placement-transitions.ts:220-225` (`setOptional*` trio vs `setWeek*` trio; the reconcile halves are byte-identical)

The ~20-line guard/snapshot/optimistic/RPC/reconcile/recordEdit/rollback skeleton now exists twice ("Mirrors persistSetWeek", says the comment). The only real divergence — constant `"setWeek"` vs `isOptional ? "markOptional" : "acceptOptional"` — parameterizes trivially.

**Action points**
- [ ] Extract one parameterized single-field persist helper (field patch + rpc + edit-kind picker); rewrite both verbs on top of it.
- [ ] Collapse the transition trios to a shared `replaceRow(prev, id, updated)` + per-field patch.

### B4. `persistAddGroup` parallel-map positional params — **CONFIRMED**

`board-writes.ts:179-186` (signature), `:207` (`?? false` re-zip), `duplicateBundle:137-138`; the same re-zip pattern independently duplicated in `shelf-writes.ts:118-129`

Sixth optional positional param `optionalByMember?: Map<string, boolean>` parallel to `weekByMember`; call sites build parallel maps from the same member rows only to re-zip by courseId. The public `addGroup` wrapper already omits the trailing map and typechecks — the exact silent-flag-reset shape.

**Action points**
- [ ] Change `persistAddGroup` to accept per-member specs (`{courseId, week, isOptional}[]`) — `duplicateBundle` maps `placeable` straight to specs; kill both parallel maps.
- [ ] Apply the same member-spec shape to `persistPlaceBack`'s entry building.

### B5. Tests re-spell `placementBusinessKey` — **CONFIRMED**

`api/reconcile.integration.test.ts:40` (`keysOf`), `model/history/reconcile.test.ts:26` (`keyOf`)

Both hand-roll `${courseId}|${day}|${period}|${week}|${isOptional}` despite the exported helper's docstring ("the one home for the reconcile-matching key … rather than re-spelling it"). `PlannerPlacement` structurally satisfies `PlacementKey` — reuse is a one-identifier change; the integration test already imports from that module.

**Action points**
- [ ] Replace both hand-rolled keys with `placementBusinessKey`; the next key component then can't silently narrow the round-trip assertions.

### B6. Optional tally derived in the ui segment — **CONFIRMED (altitude only; perf negligible)**

`courses-left-summary.ts:66` + `PlannerBoard.tsx:213`

Every sibling input (unplaced/overplaced/hoursLeft) arrives pre-derived from model (`use-cohort-board-state` → `useHours`); the Optional tally alone is derived in ui from raw `state.placements`. `optionalCount` is also a second, independent derivation that must equal the sum of the rows' counts. (Perf is fine — React Compiler memoizes, N ≤ 2000, off the drag hot path.)

**Action points**
- [ ] Move the optional filter/group derivation into `use-cohort-board-state` next to `hoursLeft`; keep only sort/name resolution in `courses-left-summary.ts` (its header already justifies exactly that split).
- [ ] Derive the headline count from the rows (single source) instead of a second filter pass.

### B7. `data-optional` as state channel and test contract — **CONFIRMED (deliberate deviation)**

`PlacedChip.tsx:72`, `ParkedBundleCard.tsx:80`, `ScheduleGrid.tsx:167`; asserted in `e2e/specs/optional-subject.spec.ts:50-57, 62, 68-72, 80`

Violates `context/foundation/ui-conventions.md` ("User-perceivable state is expressed via ARIA"; "`data-*` is for component identity only — never the test contract") and `e2e/CLAUDE.md` ("Never CSS selectors"). The spec's comment names `data-optional` "the durable cue", so it was a conscious choice — and it follows the pre-existing `data-hours-left` precedent, which deviates the same way. The visible `optional` span is already part of the chip's accessible name, so a conformant assertion exists.

**Action points**
- [ ] Decide once: either re-assert on accessible names (chip name contains "optional"; popover rows via `getByRole("listitem")`/`getByText`) and drop `data-optional`, **or** amend ui-conventions.md to bless a narrow "durable state cue" exception — the rule and the code should stop disagreeing.
- [ ] If keeping the convention: also migrate the `data-hours-left` precedent in `courses-left-popover.spec.ts` in the same pass.

### B8. Minor (fold into adjacent work, not worth standalone commits)

- **`shelve_courses` parallel arrays** (`20260707120003:25`) — third position-aligned array; a short array silently coalesces trailing members to `false`. Currently unreachable (single caller zips all three from `input.members`) and it extends a pre-existing pattern — but if a fourth per-member attribute ever lands, switch the signature to a jsonb/composite member-record payload instead of a fourth array. **PLAUSIBLE**
- **ChipMenu inline `stopPropagation`** (`ChipMenu.tsx:45`) — the trigger inlines the pointer-down half of the drag-inert recipe because `stopDrag`'s click half doesn't fit a Radix-owned trigger. Export a pointer-down-only variant from `lib/drag-inert.ts` and document why `stopDrag` doesn't apply. **PLAUSIBLE**

---

## C. Verified non-issues (refuted — do not "fix")

| Candidate | Why refuted |
| --- | --- |
| Shelved optional members missing from the popover's Optional section | Documented board-only scope (`plan.md:28, :335`); the shelf has its own review surface (`ParkedBundleCard` tag), siblings are equally board-only. |
| Pending optimistic temps counted in the Optional section | Consistent with existing optimistic-UI contract — Missing/Over derive from the same optimistic array and roll back identically. |
| Per-chip Radix `DropdownMenu` render cost on the drag budget | Content portals mount only while open; closed roots are cheap; no `React.memo` regressed; drag-move touches only hovered/dragged cells. |
| SQL function re-creates dropped guards | fe42230 restored them; all four re-creates now diff clean against the latest live definitions; `lessons.md` carries the rule. |

---

## Suggested sequencing

1. **A1 + A2** (correctness, small blast radius each) — one commit per bug, with the new tests. A1's migration first; A2 is pure client.
2. **B1 + B5** (mechanical, test-protected) — one commit.
3. **B3 + B4** (board-writes internals; touch the same file, do together) — one commit.
4. **B2 + B6** (UI single-homes) — one commit.
5. **B7** — decide the convention question first, then a small alignment commit either way.
6. **A3** — alongside whichever commit next touches the e2e helpers.
