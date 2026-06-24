---
date: 2026-06-23T21:04:32+0200
researcher: Dobromir Kropielnicki
git_commit: dde0925872b75d9a88ea9b80239da6ab651e5cd5
branch: main
repository: dobrek/ib-timetable-planner
topic: "Feasibility of S-05 first-class bundle operations, designed to open the path to S-07/S-08 while preserving ungroup"
tags: [research, codebase, plan-detail, bundles, placements, constraints, S-05, S-07, S-08]
status: complete
last_updated: 2026-06-23
last_updated_by: Dobromir Kropielnicki
---

# Research: First-Class Bundle Operations (S-05)

**Date**: 2026-06-23T21:04:32+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: dde0925872b75d9a88ea9b80239da6ab651e5cd5
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

Check the feasibility of implementing **S-05 (first-class bundle operations)** from the roadmap. Implement it so it **opens the way to further development, especially S-07** (the bundle holding container), while **keeping the existing functionality of ungrouping and working with individual courses** (FR-010).

Scope (confirmed with author): recommend one approach for the load-bearing bundle-identity decision, reaching forward to S-07/S-08 — not just S-05 in isolation.

## Summary

**S-05 is feasible and low-risk on the two dimensions that usually break this codebase** — the constraint core and the <200 ms drag budget — because validation is a pure, grouping-agnostic, client-side derivation over the placement set that never round-trips and never gates. Move / remove / replace re-validate "for free" by reusing the existing `deriveCellViolations` recompute. The real work of S-05 is **persistence and identity**, not validation.

**The central decision — persistent bundle identity vs. reconstitute-from-placements — should be resolved in favour of a persistent identity, and this is forced by S-07, not merely convenient.** Today a "bundle" is *derived*: it is ≥2 placements that happen to share a `(day, period)` cell (`isBundled = occupantCount >= 2 && !overridden`). The cell coordinate **is** the identity. A parked bundle (S-07) holds **no slot** by definition (PRD: "off-board… holds no slot… not validated while parked"), so there are **no co-located placements to derive it from**. A purely derived model cannot represent an off-board unit. Therefore, to "open the way to S-07," S-05 must give a placed grouping an identity that survives having no slot.

**Recommendation:** introduce a first-class `bundles` entity (a `bundles` row carrying `plan_id` + `cohort` + a member course set) and let on-board placements reference it via an additive, nullable `placements.bundle_id`. While on-board a bundle is materialised as its member placements at one cell (as today); the bundle row carries the identity and membership that lets it (a) move/replace atomically as a unit, (b) be lifted off-board into a holding state with no placements (S-07), and (c) serve as a stable undo handle (S-08). **Ungroup (FR-010) is preserved** as "detach the placements from the bundle" — they remain individual placements at the same cell, behaving exactly as today. This subsumes the current inverted `slot_bundles` opt-out, which is migrated and dropped last (house "additive-first, destructive-drop-last" discipline).

A migrate-and-replace of `slot_bundles` is the one place this touches behaviour subtlety (auto-bundling of co-dropped singles, default-on vs. explicit) — flagged below as the key decision for `/10x-plan`.

## Detailed Findings

### 1. The bundle is derived, not stored — this is the core fact

There is **no `Bundle` type and no bundle row** anywhere. Bundled-ness is computed per cell:

- `src/_pages/plan-detail/model/slot-bundle.ts:23-25` — `isBundled(occupantCount, overridden) = occupantCount >= 2 && !overridden`. Consumed at exactly one render edge: `ui/PlannerGrid.tsx:146`.
- `slot_bundles` stores **inverted opt-out markers only**: a row present = "this cell is UNgrouped." It is keyed by `(plan_id, cohort, day, period)` and carries **no course membership and no FK to placements** (`api/slot-bundles.ts:7-13`, migration `supabase/migrations/20260613123404_slot_bundles.sql:11-26`). UI verbs invert against the DB op — "Ungroup" *inserts* a row, "Group" *deletes* it.
- A repo-wide grep for `bundle_id|group_id|bundleId|groupId` on `placements` returned nothing. Grouping is **purely emergent from co-location**; `groupCellOccupants` buckets placements by `cellKey(day, period)` (`model/cell-occupants.ts:26-40`).

> Note: `course_groupings` / `course_grouping_members` (minimal schema) are a **separate** concept — precomputed *palette suggestions* of which courses *could* group, keyed by `catalog_hash`. They are not the placed/bundled-on-the-board entity, but they are the closest existing precedent for a "first-class set of courses" table + an atomic `replace_cohort_groupings` RPC (`api/persist.ts:27`).

### 2. Whole-slot move today = delete + recreate, best-effort, no transaction

`moveBundle → persistMoveBundle` (`model/use-placements.ts:207-227`):

1. `occupantPlacementIds` collects every placement id at the source cell (`placement-transitions.ts:187-189`).
2. `partitionBundleMove` splits occupants into **movers** vs **mergers** (a merger = a course already present at the target) (`placement-transitions.ts:200-210`).
3. `moveManyOptimistic` applies the whole move in **one** `setPlacements` pass — deliberately, so the board never renders a transient mid-move duplicate flag (`placement-transitions.ts:218-231`). This single-update invariant is the one place the no-flicker/<200 ms property can be broken.
4. `Promise.all(movers.map(createPlacement))` (POST-new at target) → `settleMany` (temp→real ids) → `Promise.all(...deleteOld)` (DELETE source rows). **N parallel inserts + N parallel deletes, best-effort**; cleanup failures surface a `groupFailure` banner but do **not** roll back. `slot_bundles` is never touched (bundled-ness re-derives at the destination).

There is **no transactionality** and **no "can this bundle land here" pre-check** — only structural guards (same-cell no-op, empty, pending). This is the gap that first-class move/replace must close.

### 3. Ungroup / individual-course operations (FR-010) — must not regress

A bundle has no identity to operate on, so the model is: **ungroup first, then operate per chip.**

- Toggle "Ungroup slot" → `useSlotBundles.toggleBundle` → `unbundleSlot` → `insertOverride` (`model/use-slot-bundles.ts:41-72`, `api/slot-bundles.ts:35-60`). `isBundled` now returns false.
- Once unbundled, per-chip drag and per-chip remove become live (`ui/slot-cell/PlacedChip.tsx:45-49, 101-116`), gated on `!bundled`. While bundled they are deliberately inert; only the whole-slot drag, the group/ungroup toggle, and the bulk-remove trash are active (the A/B week toggle stays live even while bundled).

**Preservation requirement:** whatever identity S-05 introduces, "ungroup → operate on a single course at the same cell" must keep working byte-for-byte. With explicit identity this becomes "detach placements from the bundle" (clear `bundle_id`), which is a cleaner, FK-free expression of the same user behaviour.

### 4. Validation is pure, client-side, grouping-agnostic — and never gates

This is why S-05 is safe on the constraint/perf axis.

- Registry: `model/constraints/index.ts:10-16` — `CELL_CONSTRAINTS = [duplicateCourse, teacherConflict, studentConflict, teacherAvailability, crossCohortTeacher]`. Adding a constraint touches only this array. Contract `CellConstraint` (`constraints/types.ts:38-45`): mandatory `explain(occupants, ctx)` (enumerate all violations), optional `test?(course, others)` fast path (board-only constraints omit it so they stay off the hot path).
- Two entry points (`constraints/index.ts:19-27`): `explainCell` (enumerate, committed cells) and `violatesAny` (short-circuit boolean, drag hints).
- Orchestrators: `deriveCellViolations(placements, …)` re-derives the whole board after any state change (`model/collisions.ts:37-67`); `deriveDropHints` / `classifyCell` produce drag-time previews using a what-if `excludePlacementIds` mechanism (`model/drop-hints.ts:87-179`).
- **Drop is accept-and-flag, never rejected by validation** (`ui/PlannerBoard.tsx:87-211`): optimistic mutation, then `useCollisions` re-runs `deriveCellViolations` via `useMemo`. The current bundle move is flagged *after* it lands, exactly like a single placement.
- **<200 ms budget is met structurally, not measured** — no timer, benchmark, or perf test exists; only comments (`teacher-availability.ts:8`, `cross-cohort-teacher.ts:13`). It holds because validation is all in-memory over a tiny bounded set (≤84 cells/cohort), zero network. The full validation context (active + sibling-cohort placements, availability, catalog, names) is loaded **once** at SSR in `api/load.ts:30-158`; the island rebuilds indices once and memoizes (`PlannerBoard.tsx:192-199`).

**Gap for "replace":** the validator can already *compute* a verdict for any candidate occupant set (it's pure and grouping-agnostic), and the what-if exclusion machinery exists for previews — but there is (a) no pre-commit fit-check function callable from a write path, (b) no atomic replace transition (analogous to `moveManyOptimistic`), and (c) no transactional multi-row placement persistence. Replace would *reuse* `bucketByCell` + `explainCell` for the verdict; the new work is orchestration + atomic persistence, not new constraint logic. Note that "re-validated at the destination" (PRD) is satisfied by the existing accept-and-flag recompute — **no new gating is required**, though a pre-commit fit-check is an option.

### 5. Forward dependency on S-07 (holding container) — the forcing function

PRD FR-011 (`prd.md:325-331`) + US-02 (`prd.md:203-210`) + Business Logic (`prd.md:428-430`):

> A bundle lifted into the **holding container** is off-board: it holds no slot and is **not validated while parked**; collisions are evaluated only on drop-back. The shelf holds multiple parked bundles.

Reasoned dependency: on the board the `(day, period)` cell **is** the bundle's identity — placements are grouped because they are co-located. A parked bundle holds no slot, so **the join key that constitutes its identity does not exist while parked.** A derived-from-co-location model literally cannot represent an off-board unit. This forces a representation where a bundle's membership is held **independently of any cell** — i.e. a persistent bundle identity (or an equivalent unit-preserving holding record). The roadmap flags exactly this as S-05's load-bearing open question (`roadmap.md:142`) and S-07's persistence question (`roadmap.md:169`). Refresh-durability of a parked bundle is **nice-to-have** (`prd.md:157-158`); holding the unit intact *in-session* is **must-have** (FR-011/US-02). `placements.day`/`period` are `NOT NULL`, so parked members cannot be "placements without coordinates" without a heavier schema change — another reason to hold membership in the bundle entity, not in slot-less placements.

### 6. Forward dependency on S-08 (undo/redo)

FR-013 (`prd.md:347-354`, provisional, blocked on Open Q #1) lists: bundle move, remove, replace, ungroup, single-course move, lift-to-container, place-back. Today every move is delete+recreate, so placement **ids churn on every move** and remove/replace destroy rows outright — an undo stack would have to re-map regenerated ids and re-derive membership from coordinates after the fact. A **stable bundle id is a durable handle** an undo entry can point at across move/replace/park/place-back, making undo materially simpler. The same identity that unblocks S-07 unblocks simpler S-08. (Scope — single vs. multi-step, session vs. durable — remains unresolved, Open Q #1.)

## Recommendation: persistent bundle identity (`bundles` + nullable `placements.bundle_id`)

**Shape (for `/10x-plan` to detail, not a final design):**

- New table `bundles` — `id uuid pk`, `plan_id uuid not null → plans (cascade)`, `cohort cohort not null`, plus a status to support S-07 later (e.g. `placed` | `holding`, defaulting `placed`). Membership held as a course set the bundle owns, independent of any cell — mirror the `course_groupings` / `course_grouping_members` precedent so the off-board (S-07) case needs no further schema change.
- Additive, **nullable** `placements.bundle_id uuid` with a composite FK pinned to the plan (`(plan_id, bundle_id) → bundles(plan_id, id)`), matching the house "composite FK to both parents, fail loudly on cross-plan" convention (`course_teachers.sql`).
**Adopted refinement — "everything is a bundle; ungroup is presentation."** After challenging the model, the preferred framing makes `bundle_id` **`NOT NULL`**: every placement always belongs to exactly one bundle, and a cell with any courses *is* a bundle (including a bundle of one). This dominates the original nullable/derived framing on simplicity (see "Why this model" below). Concretely:

- **Every cell is a bundle.** The data concept "is this bundled?" disappears — it is always true. Grouped-vs-ungrouped is purely a **UI presentation/interaction state**, not persisted.
- **Ungroup (FR-010)** = a view toggle that expands the merged block into individual chips and unlocks per-course actions. **No data change, no persisted state.** It does *not* clear `bundle_id` or write anything.
- **One unified operation primitive:** *move member-set M from cell A to cell B; create B's bundle if absent; delete A's bundle if it is now empty.* "Move one course" (M = one member) and "move the whole bundle" (M = all members) are the same operation. Remove = drop members from a bundle. Place a single course on an empty cell = create a 1-member bundle.
- **Move** carries the bundle id only for whole-bundle moves (A relocates intact); a single-course move always changes that course's bundle membership (leaves A's bundle, joins/creates B's). All via a **transactional RPC** (template: `replace_course_teachers` / `replace_cohort_groupings`, `security invoker`) — closing the current best-effort/no-rollback gap.
- **Replace** = same slot, swap membership; reuse `explainCell` for the re-validation verdict (accept-and-flag, as today).
- **S-07 park** (next slice) = lift any cell's contents (incl. a single course) off-board: the bundle goes to a `holding` state, its placements are deleted, membership persists. Drop-back recreates placements and re-validates. No further schema change.

**Reload-safety confirmation (de-risks "ungroup is presentation").** Verified that no board database operation triggers a reload/refetch, so ephemeral ungroup state is safe for the whole editing session: the island mounts once (`PlanDetailPage.astro:14`, `client:load`); there is **no `ClientRouter`/ViewTransitions in the app** (so no SPA remounting); `usePlacements`/`useSlotBundles` take SSR props as `useState` *initializers* only with **no prop→state resync** (`use-placements.ts:63`, `use-slot-bundles.ts:37`; their only `useEffect` is a `useLatest` ref-keeper); all mutations are optimistic client state with no `reload()`/`navigate()`/refetch; no realtime/polling. The board reloads **only** on manual refresh, explicit navigation (full document load — no `ClientRouter`), or the one-time `ComputeGroupingsEmptyState.tsx:53` `location.reload()` after the *setup* "Compute groupings" action (pre-editing). The catalog/plan dialogs' `refreshPage()` helper is **not** used by the board. **Guardrail for `/10x-plan`:** keep board ops on the optimistic-state path — do **not** introduce `refreshPage()`/`reload()` into the editing loop (it would wipe ephemeral ungroup and is unnecessary).

**Tackling the bundle-aware-insert cost (find-or-create in one atomic RPC).** Absorb the cost server-side so the client stays at one round-trip and gets simpler: give `bundles` nullable `(day, period)` (null while parked) + a **partial unique index** `unique (plan_id, cohort, day, period) where day is not null` (exactly one placed bundle per cell, DB-enforced). A `place_course` RPC upserts the cell's bundle (`insert … on conflict … do update … returning id`) then inserts the placement with that `bundle_id`, idempotent on the placement unique — one `security invoker` transaction, single round-trip, same latency as today's insert. The unified move-member-set / remove / replace RPC creates the destination bundle and deletes a now-empty source bundle atomically. The client keeps its existing temp-id→real-id reconciliation (`settleMany`), extended to carry a temp `bundle_id`. Net: the cost is one-time RPC authoring, not per-op overhead — and it pays down existing debt (today's bundle move is N parallel inserts+deletes with no transaction, best-effort cleanup; the RPC makes move/remove/replace atomic).

**Bundle lifecycle — delete at zero membership (clean threshold):** a `bundles` row exists exactly while its membership ≥ 1. The cleanup rule is simply **delete a bundle when its membership reaches 0**, enforced inside the transactional op (not a background sweep). This is automatically correct for parked bundles: a parked bundle has ≥1 member by construction, so the `== 0` rule never sweeps it — the awkward "< 2 *except* parked" carve-out and the degenerate-bundle-of-one special case both vanish under this model. The count is still over **membership** (placed → its placements; parked → its stored set), so it stays correct once placements detach from a parked bundle. Undo-of-ungroup is a non-issue (ungroup writes nothing); whole-bundle move/replace/park keep a stable id for S-08.

**Why this model (vs. reconstitute-from-placements, and vs. the nullable/derived framing):** reconstitution cannot represent an off-board parked bundle (§5), so it would force a schema rework at S-07 anyway, against the roadmap's intent. Persistent identity avoids that. The "everything is a bundle" refinement then beats the nullable/derived alternative on simplicity: (a) it **eliminates the `slot_bundles` table and its entire action/client/`useSlotBundles`-transitions stack** (including the confusing inverted "row = ungrouped" semantics) rather than migrating-then-dropping it; (b) it **collapses the two parallel code paths** (single-placement `add`/`move`/`remove` vs. `addGroup`/`moveBundle`/`removeBundle`) into one member-set primitive, shrinking `placement-transitions.ts` + `use-placements.ts`; (c) it yields the clean `== 0` cleanup rule above with no carve-outs; (d) it makes S-07 parking uniform (any cell's contents) and S-08 undo simpler (fewer primitives). **Cost:** every placement op becomes bundle-aware — the trivial idempotent single-row insert (`api/placements.ts:48-78`) becomes a transactional find-or-create-bundle + insert, so even a single-course drop goes through the bundle-aware path (a wash, since it's one path instead of two). Constraint core and the <200 ms budget are untouched (validation is already per-cell over occupants).

**Migration sequencing (mirror S-02/S-03 archives):** schema-first, additive/defaulted, destructive drop last. Note there is **no production data** (README rollback note), so discarding the legacy `slot_bundles` opt-out state on migration is acceptable.
1. Add `bundles` table + `placements.bundle_id` (added nullable first for an additive step, then backfilled and tightened to `NOT NULL`). Explicit `revoke … from anon` per the grant lesson; RLS `for all to authenticated`.
2. Backfill: create one `bundles` row per non-empty `(plan_id, cohort, day, period)` cell and assign `bundle_id` to its placements; then set `bundle_id NOT NULL`. (The legacy `slot_bundles` ungrouped *view* state is intentionally not preserved — ungroup becomes presentation-only; confirm acceptable, see Key Decisions #1.)
3. Update `clone_plan` (`create or replace` off the **live** definition) to carry a `_bundle_map` UUID remap — mirror the `_grouping_map`/`course_grouping_members` double-remap pattern.
4. Add the transactional bundle-op RPC(s): the unified move-member-set, remove, replace, and a bundle-aware placement-create.
5. Constraint core: no new constraint, no `BoardContext` interface change — reuse `explainCell`/`bucketByCell`; relax-by-removing only.
6. UI + optimistic transitions: fold the two paths into one member-set primitive in the established 3-file split (transport `*-client.ts` → pure `*-transitions.ts` triad `Optimistic/Reconcile/Rollback` → `use-placements.ts` orchestrator). Keep the single-`setPlacements`-pass no-flicker invariant. Move grouped/ungrouped to ephemeral UI state (retire `useSlotBundles`).
7. **Drop `slot_bundles`** last, once `bundle_id` is the source of truth.

**Testing (three-layer, co-located, per house pattern):** unit for the new transitions + `isBundled`-via-`bundle_id` + replace fit verdict; integration for the bundle RPC round-trip + `clone_plan` bundle preservation (built through `src/test/factories/`); E2E only for move/remove/replace/ungroup if the existing board suite doesn't already cover the regression surface (S-02/S-03 added little/no new board E2E).

## Key decisions to resolve in `/10x-plan`

1. **Does persisted ungroup state matter, and where should it live? (the one real behaviour change.)** Under "ungroup is presentation," the ungrouped *view* no longer survives a reload — after refresh, cells render grouped again and the author re-expands to act on individuals. Today `slot_bundles` persists that view. FR-010 reads as requiring the *capability* (operate on individual courses), with persistence likely an incidental artifact of `slot_bundles` being the only available mechanism — but the roadmap says "preserves today's ungroup/opt-out behaviour," so confirm this trade explicitly (good `/10x-frame` input). Three options, in recommended order:
   - **(a) Ephemeral (recommended default).** Ungroup is pure UI state; resets on reload to the clean bundled default. Simplest; arguably the *better* UX (the bundled view is the point of the change), and reload-safe (verified above — no auto-reload wipes it mid-session).
   - **(b) Guarded `localStorage`** *(if reload-survival is wanted).* Ungroup is a per-device view preference, persisted exactly like `theme` / `sidebar-collapsed` / `drag-hint-mode` (try/catch + `useSyncExternalStore`, per `lessons.md`). Survives reload with **zero domain-model contamination, no server writes, no RPC/clone changes** — keeps the "everything is a bundle" simplification intact. The principled home, because merged-vs-exploded is *presentation*, not domain.
   - **(c) An `ungrouped` flag on the `bundles` row** *(considered and not recommended).* Works, and is the right place *if* persisting server-side — but it re-introduces the persisted toggle + write stack we deleted (slot_bundles reborn), and **conflates durable structural identity with a transient view preference**, producing awkward edge cases: a 1-member bundle can't be ungrouped (flag meaningful only sometimes); and it forces answers to "does ungroup-ness travel through move / park-and-place-back (S-07) / undo (S-08)?" — none satisfying, because the answer is "that's a property of the current view, not of the bundle." Reserve `bundles` for identity, membership, and `placed`/`holding` status only.

   Principle: *which courses sit in a cell* = domain (the table); *whether you're viewing them merged or exploded* = presentation (localStorage or ephemeral). Everything else in the model is strictly simpler if (a)/(b) is chosen over (c).
2. **Bundle granularity vs. the week dimension — RESOLVED: one bundle per cell.** A bundle = every placement in a `(day, period)` cell regardless of week; moving a bundle that holds week-A *and* week-B courses keeps them **in formation** (they move/park/replace together). Rationale: based on user feedback, and it preserves today's shipped behaviour (`isBundled` already counts all cell occupants regardless of week; `moveBundle` already relocates the whole cell). The partial unique index + find-or-create RPC stand unchanged. Consequences to specify in `/10x-plan` (behaviours, not blockers):
   - Dropping an opposite-week grouping onto an occupied slot **auto-joins** it into the formation (one bundle thereafter); the author separates later via ungroup. Make the merge legible in the UI.
   - Move into an *empty* cell preserves the `bundle_id` (clean relocation); move into an *occupied* cell **merges** (movers join the destination bundle, source bundle deleted) — so identity is not always preserved across a move. Note for S-08 undo (it may restore a deleted source bundle).
   - "Replace" on a mixed A+B formation **swaps the entire formation** for the one chosen grouping (see #3) — defensible, but pin it explicitly.
3. **Replace affordance + source + identity** (PRD/roadmap open Q): (a) pick the replacement grouping from the recommendation panel vs. a dedicated swap affordance (owner: user/design); (b) does replace preserve the bundle's `bundle_id` (new members, same identity — better for undo/park continuity) or mint a new bundle?; (c) per granularity decision #2, replace on a mixed A+B formation swaps the whole cell's contents for one grouping (can collapse a two-week formation) — confirm this is the intended meaning.
4. **Pre-commit fit-check vs. accept-and-flag for replace.** Accept-and-flag (reuse `deriveCellViolations`) satisfies the PRD and is consistent with every other op; a pre-commit gate is optional polish. Recommend accept-and-flag to stay consistent.
5. **Atomic persistence transport.** Confirm a `security invoker` RPC (per `replace_course_teachers`) over the current best-effort N-call fan-out for move/remove/replace.

## Code References

- `src/_pages/plan-detail/model/slot-bundle.ts:23-25` — derived `isBundled`; override transitions (the whole current "bundle" model)
- `src/_pages/plan-detail/model/use-placements.ts:207-227` — `persistMoveBundle`: delete+recreate, best-effort, no transaction, no fit-check
- `src/_pages/plan-detail/model/placement-transitions.ts:187-231` — `occupantPlacementIds`, `partitionBundleMove`, `moveManyOptimistic` (single-pass no-flicker invariant)
- `src/_pages/plan-detail/model/cell-occupants.ts:26-40` — co-location bucketing (the implicit identity)
- `src/_pages/plan-detail/model/constraints/index.ts:10-27` — registry + `explainCell` / `violatesAny` entry points
- `src/_pages/plan-detail/model/constraints/types.ts:38-45` — `CellConstraint` contract
- `src/_pages/plan-detail/model/collisions.ts:37-67` — `deriveCellViolations` (whole-board recompute)
- `src/_pages/plan-detail/model/drop-hints.ts:87-179` — drag preview + what-if `excludePlacementIds`
- `src/_pages/plan-detail/ui/PlannerBoard.tsx:87-211` — drop dispatch + accept-and-flag recompute
- `src/_pages/plan-detail/ui/slot-cell/PlacedChip.tsx:45-116` — `!bundled`-gated per-chip drag/remove (FR-010 path)
- `src/_pages/plan-detail/api/slot-bundles.ts:7-60` — inverted opt-out insert/delete
- `src/_pages/plan-detail/api/load.ts:30-158` — single-shot validation context load (perf foundation)
- `src/_pages/plan-detail/api/placements.ts:48-100` — single-row insert/delete/week-update (no atomic multi-row op)
- `supabase/migrations/20260613123404_slot_bundles.sql:11-26` — `slot_bundles` DDL (coordinate-keyed, no membership)
- `supabase/migrations/20260620120000_course_teachers.sql` — child-table + composite-FK + anon-revoke template; `replace_course_teachers` RPC template
- `supabase/migrations/20260621130001_clone_plan_with_week.sql:124-152` — clone RPC + `_grouping_map` double-remap pattern to mirror for `bundle_id`
- `src/shared/api/database.types.ts:282-388` — generated `placements` / `slot_bundles` rows

## Architecture Insights

- **Bundle = derived from co-location** is the single fact that shapes everything: it works on-board because a cell is a natural join key, and it cannot survive going off-board. S-07 is the forcing function for identity, not a nice-to-have.
- **Validation is decoupled from mutation** (pure derivation over state, accept-and-flag, never gates), so new *operations* don't threaten the <200 ms budget — only new *constraints* or larger data would, and S-05 adds neither.
- **The house move-pattern already isolates atomicity risk**: the single-`setPlacements`-pass invariant prevents transient-flag flicker; the missing piece is server-side transactionality, for which RPC precedents exist.
- **Precedent for a first-class course-set entity already exists** (`course_groupings` + `replace_cohort_groupings` RPC) — the recommended `bundles` entity is the same shape applied to placed bundles, lowering novelty risk.
- Relevant lessons (`context/foundation/lessons.md`): "Port the mechanism, not the legacy type shape" (model on generated `Database` types, identity as opaque tokens) directly applies to introducing `bundle_id`; "Granting a role is not excluding the others" (explicit `revoke … from anon` on the new table); "Guard `localStorage` with try/catch" (relevant when S-07 chooses its durability mechanism); "`astro check` is the mandatory type gate."

## Historical Context (from prior changes)

- `context/archive/2026-06-20-co-teaching-teacher-sets/plan.md` — phase template (additive-first, destructive-drop-last; breaking type change landed in one phase with all consumers); junction-table + composite-FK + anon-revoke conventions; `replace_course_teachers` RPC pattern.
- `context/archive/2026-06-21-bi-weekly-week-aware-validation/plan.md` — constraint-core extension discipline (reuse choke points, additive `BoardContext` field, relax-by-removing-violations); 3-file optimistic split; `clone_plan` must be `create or replace` off the **live** definition; week column added `not null default 'both'` for zero-backfill compatibility.
- `context/foundation/test-plan.md:69,94,119` — Risk #7 (bundle/parked durability) is recognised; board/drag E2E for bundles was deferred in Phase 3.

## Related Research

- None prior for this change (this is the first artifact under `context/changes/first-class-bundle-operations/`). The S-02/S-03 archive `research.md` files are the closest analogues for slice shape.

## Open Questions

1. Auto-bundling semantics under explicit `bundle_id` (see Key Decisions #1) — the only place behaviour could drift from the demoed UX.
2. Replace affordance + source (recommendation panel vs. dedicated swap) — owner: user/design.
3. Whether to land a pre-commit fit-check or stay accept-and-flag for replace (recommend accept-and-flag).
4. S-07 durability mechanism (`holding` state in Supabase vs. guarded `localStorage`) — out of S-05 scope, but the `bundles.status` column should be shaped now so S-07 is additive.
