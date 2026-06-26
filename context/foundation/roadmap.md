---
project: ib-timetable-planner
version: 1
status: draft
created: 2026-06-18
updated: 2026-06-26
prd_version: 1
main_goal: quality
top_blocker: decisions
---

# Roadmap: IB Timetable Planner (post-demo feedback change)

> Derived from `context/foundation/prd.md` (v1 — the post-demo feedback change PRD) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded. The original product-build roadmap is archived at `context/foundation/archive/2026-06-18-roadmap.md`.
> Slices below are listed in dependency order. The `## At a glance` table is the index.

## Vision recap

The IB timetable editor shipped and was demoed to its plan authors. Design and the core drag-and-drop validation were well received, but the demo surfaced six places where the tool's model diverges from how authors actually work and how the IB domain behaves — pushing them back toward spreadsheet workarounds for the exact cases the tool exists to remove. This change is **domain-fidelity and mental-model alignment, not new capability for its own sake**: cohorts named DP1/DP2, co-taught courses (two teachers both occupied), bi-weekly (fortnightly) courses where opposite-week pairs may share a slot, free movement between cohorts, a combined two-cohort assembly view, and placed groupings treated as first-class "bundles" with a temporary holding shelf. The hard constraint throughout: the enriched collision core must stay **collision-correct (no false-positive "valid") and within the sub-200 ms drag-drop budget** — including when validating both cohorts at once.

## North star

**S-06: Author assembles a complete, collision-free DP1 | DP2 plan in the combined two-cohort view** — this is the PRD's Primary Success Criterion ("assemble/review both cohorts together in a new combined view", US-01), the explicit final assembly stage where every enriched dimension (co-teaching, bi-weekly, cross-cohort teacher occupancy, bundles) is exercised together inside the validation budget. With `main_goal: quality`, it's the slice whose green light means the change preserved correctness while matching the authors' mental model.

> The **north star** is the smallest end-to-end slice whose successful delivery proves the change's core hypothesis (authors can assemble both cohorts the way they actually think, with no correctness regression) — placed as early as its prerequisites allow, because everything else only matters if this holds. It sits late here only because its prerequisites (the two-cohort/cross-cohort board S-04 and first-class bundles S-05) are genuine, not because it was deferred for tidy ordering.

## At a glance

| ID   | Change ID                            | Outcome (user can …)                                                                       | Prerequisites | PRD refs                          | Status   |
| ---- | ------------------------------------ | ------------------------------------------------------------------------------------------ | ------------- | --------------------------------- | -------- |
| S-01 | dp1-dp2-cohort-naming                | see cohorts labelled **DP1 / DP2** everywhere instead of "Year 1 / Year 2"                 | —             | FR-004                            | done     |
| S-02 | co-teaching-teacher-sets             | assign two+ teachers to a course; both count as occupied for conflict + availability       | —             | FR-001, FR-012                    | done     |
| S-03 | bi-weekly-week-aware-validation      | mark a course bi-weekly, pick week A/B; two opposite-week courses share one slot           | S-02          | FR-002, FR-003, FR-012, US-03     | done     |
| S-04 | cohort-switching                     | open either cohort, switch freely; a teacher occupied in one cohort's slot/week blocks the other | S-02, S-03    | FR-005, FR-006, FR-012            | done |
| S-05 | first-class-bundle-operations        | move / remove / replace a placed grouping as one bundle; ungroup to per-course still works | —             | FR-009, FR-010                    | done     |
| S-06 | combined-two-cohort-view             | assemble & edit a collision-free DP1 \| DP2 plan side by side, validated across both cohorts | S-04, S-05    | FR-007, FR-008, FR-012, US-01     | proposed |
| S-07 | bundle-holding-container             | lift a bundle off-board onto a holding shelf, then place it back later; survives refresh   | S-05          | FR-011, US-02                     | done     |
| S-08 | editing-undo-redo                    | undo / redo recent editing operations (move, remove, replace, ungroup, lift, place-back)   | S-05, S-07    | FR-013                            | blocked  |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                          | Chain                            | Note                                                                                                  |
| ------ | ------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| A      | Two-cohort correctness & assembly | `S-02` → `S-03` → `S-04` → `S-06` | The north-star track. Quality-sequenced through the protected constraint core; `S-06` also consumes `S-05` from Stream B. |
| B      | Bundle manipulation            | `S-05` → `S-07` → `S-08`         | Parallel with Stream A (different files). `S-05` also unlocks the combined view (`S-06`). `S-08` blocked on undo scope. |
| C      | Cohort relabel                 | `S-01`                           | Standalone cosmetic relabel; parallel with everything.                                                |

## Baseline

What's already in place in the codebase as of 2026-06-18 (auto-researched + author-confirmed). This is a brownfield change on a shipped product, so the generic platform is **present** and slices below extend it rather than re-scaffold it. The "change-specific" rows are the subsystems the six asks introduce — all absent today, which is why each is a vertical slice, not a foundation.

**Generic platform — present:**

- **Frontend:** present — Astro 6 + React 19 islands + Tailwind v4 + shadcn; drag-and-drop via `@dnd-kit/react` (`src/_pages/plan-detail/ui/PlannerBoard.tsx`, `package.json`).
- **Backend / API:** present — Astro Actions (`src/actions/`) are the single mutation/compute transport; API routes reserved for auth.
- **Data:** present — Supabase Postgres, 13 migrations under `supabase/migrations/`, generated `src/shared/api/database.types.ts`.
- **Auth:** present — email/password via Supabase, deny-by-default `src/middleware.ts`, single Author role. **No change in this work.**
- **Deploy / infra:** present — Cloudflare Workers (`wrangler.jsonc`) + GitHub Actions CI. **No change.**
- **Observability:** partial — Cloudflare observability enabled (`wrangler.jsonc`); no Sentry/OTEL/Datadog. Not promoted to a foundation — `main_goal: quality` here means *collision correctness verified by tests*, not production telemetry.

**Change-specific subsystems — absent today (each ask is net-new behaviour):**

- **Co-teaching:** absent — a course carries a single nullable `teacher_id`; constraints reference a singular `teacherKey` (`constraints/teacher-conflict.ts`, `teacher-availability.ts`). → S-02.
- **Bi-weekly / week dimension:** absent — no `week` column on placements, no fortnight flag on courses; the grid is `(day, period)` only. → S-03.
- **Cross-cohort teacher occupancy:** absent — every registered constraint operates within a single cell; `BoardContext` only *comments* about future cross-cohort fields. → S-04.
- **DP1/DP2 naming:** present-but-wrong — labels are "Year 1" / "Year 2" in `src/shared/config/cohorts.ts` (data values `dp1`/`dp2` already correct). → S-01.
- **Free switching / two-cohort board:** absent — `BOARD_COHORT = "dp1"` is hardcoded in `src/_pages/plan-detail/api/load.ts:15`. → S-04.
- **Combined two-cohort view:** absent — `PlannerBoard` renders a single cohort. → S-06.
- **First-class bundle:** absent — `isBundled` is a derived flag (`occupantCount ≥ 2 && !overridden`, `slot-bundle.ts`); whole-slot move is delete+recreate of per-course placements (`persistMoveBundle`); `slot_bundles` records opt-outs only. → S-05.
- **Holding container / undo-redo:** both absent. → S-07, S-08.

## Foundations

**None.** This is a brownfield change on a mature, shipped platform: auth, data, the Astro-Actions transport, the deploy pipeline, the `@dnd-kit` board, and the existing four-class constraint core are all present (see `## Baseline`). Every cross-cutting model change this change needs — the teacher *set* (co-teaching), the week dimension (bi-weekly), the cross-cohort validation context, and bundle *identity* — is folded into the first vertical slice that makes it user-visible (S-02, S-03, S-04, S-05 respectively), per progressive disclosure. There is no cross-cutting enabler whose postponement would make the first vertical slice unplannable, so no `F-NN` is justified; introducing one would be horizontal-first scope creep into the protected constraint core.

## Slices

### S-01: DP1 / DP2 cohort naming

- **Outcome:** Author sees cohorts labelled **"DP1"** and **"DP2"** throughout the UI, replacing the "Year 1" / "Year 2" display labels. The `dp1` / `dp2` data values are unchanged.
- **Change ID:** dp1-dp2-cohort-naming
- **PRD refs:** FR-004
- **Prerequisites:** —
- **Parallel with:** S-02, S-03, S-04, S-05, S-06, S-07, S-08
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Lowest-risk slice in the change — a display-label relabel in `src/shared/config/cohorts.ts` and any hardcoded UI strings, with zero touch to the constraint core or schema. Sequenced first as a clean, correctness-neutral win that removes a daily friction the demo flagged; can ship independently of every other slice. Risk is only completeness (every surface relabelled, no stray "Year 1" string).
- **Status:** done

### S-02: Co-teaching (teacher sets)

- **Outcome:** Author can assign two or more teachers to a single course; every assigned teacher is treated as occupied for teacher-conflict and is checked for availability (a placement is invalid if **any** of the course's teachers is unavailable in that slot). A single-teacher course behaves exactly as today (one-element set).
- **Change ID:** co-teaching-teacher-sets
- **PRD refs:** FR-001, FR-012 (preserved: sub-200 ms + no false-positive valid)
- **Prerequisites:** —
- **Parallel with:** S-01, S-05, S-07
- **Blockers:** —
- **Unknowns:**
  - Teacher-set storage: junction table vs. array column on courses, and how `database.types.ts` + the catalog UI surface a second teacher — Owner: dev. Block: no (resolved in `/10x-plan`; must be an additive migration that defaults existing single-teacher courses to a one-element set).
- **Risk:** First touch of the protected constraint core, chosen deliberately as the gentler entry: a "modified" change localised to `teacher-conflict` + `teacher-availability`, establishing the teacher-as-set shape the later unified rule (S-03) and cross-cohort scope (S-04) build on. Sequenced before S-03 so the week-aware rewrite integrates the teacher set once rather than reworking it. Not parallel with S-03/S-04 — they edit the same hot collision code.
- **Status:** done

### S-03: Bi-weekly courses + week-aware validation

- **Outcome:** Author can mark a course bi-weekly (fortnightly) and choose which week (A or B) a placement occupies; a weekly course occupies both weeks. The validator becomes week-aware: two opposite-week fortnightly courses may share one slot, while any week overlap (two same-week courses, or any clash with a weekly course) is flagged. Existing placements with no week tag are treated as weekly.
- **Change ID:** bi-weekly-week-aware-validation
- **PRD refs:** FR-002, FR-003, FR-012 (preserved), US-03
- **Prerequisites:** S-02
- **Parallel with:** S-01, S-05, S-07
- **Blockers:** —
- **Unknowns:**
  - How the week (A/B) is chosen at drop time and shown on a placed cell without breaking the existing drop-hint UX — Owner: user / design. Block: no.
  - Whether the grouping/recommendation half must also become week-aware in this slice or can follow — Owner: dev. Block: no (PRD says recommendation "unchanged in spirit" but must become week-aware eventually).
- **Risk:** The deepest, most invasive change — the PRD's "unified collision rule" spine (collide iff *share a student or teacher* **and** *weeks overlap*) is reworked across schema (course fortnight flag + placement week), the grid, and every occupancy check. Highest single-slice correctness risk before cross-cohort; sequenced after S-02 so the rule is built once over the teacher-set form, and before S-04 because cross-cohort occupancy (FR-006) is itself week-aware and depends on this dimension existing.
- **Status:** done

### S-04: Two-cohort board — free switching + cross-cohort occupancy

- **Outcome:** Author can open the board on either cohort and switch between DP1 and DP2 freely (no forced start order); the board is no longer locked to `dp1`. Teacher **occupancy** is enforced symmetrically and week-aware across both cohorts — a teacher occupied in slot S / week W in either cohort cannot be placed in S / W of the other (but may occupy S across opposite weeks). Teacher **availability** stays week-agnostic and cohort-independent (unchanged).
- **Change ID:** two-cohort-board-cross-cohort
- **PRD refs:** FR-005, FR-006, FR-012 (preserved)
- **Prerequisites:** S-02, S-03
- **Parallel with:** S-01, S-05, S-07
- **Blockers:** —
- **Unknowns:**
  - Whether the validator loads both cohorts' placements into context eagerly or fetches the other cohort's occupancy on demand — directly impacts the sub-200 ms budget — Owner: dev. Block: no (perf-driven, resolved in `/10x-plan`).
- **Risk:** The hardest correctness slice — the symmetric cross-cohort teacher constraint is built from scratch (the never-implemented "Year 1 fixes Year 2" model is replaced by a symmetric one), and it must hold the sub-200 ms budget while now scanning across cohorts. FR-005 (free switching) is folded in because switching is only *safe* once this symmetric constraint exists (the PRD's own reasoning) and the constraint can't be exercised without leaving the `dp1` lock. Could be split (constraint vs. switcher UI) in `/10x-plan` if scope proves large.
- **Status:** proposed

### S-05: First-class bundle operations

- **Outcome:** A placed grouping is a first-class bundle the author can **move** (relocate all its courses atomically, re-validated at the destination, within its own cohort), **remove** (delete the whole bundle at once), or **replace** (swap its contents for a different compatible grouping on the same slot). Ungrouping to operate on individual courses — remove one course, move one course — keeps working exactly as today (the `slot_bundles` opt-out).
- **Change ID:** first-class-bundle-operations
- **PRD refs:** FR-009, FR-010
- **Prerequisites:** —
- **Parallel with:** S-01, S-02, S-03, S-04, S-06
- **Blockers:** —
- **Unknowns:**
  - Whether a bundle gains a persistent identity row or is reconstituted from its placements at move time (today's move is delete+recreate) — Owner: dev. Block: no (drives whether the holding container in S-07 can persist a parked bundle as a unit).
  - "Replace" interaction: pick the replacement grouping from the recommendation panel vs. a dedicated swap affordance — Owner: user / design. Block: no.
- **Risk:** Head of the bundle track, independent of the constraint-core chain (different files), so it runs in parallel with S-02→S-04. The model change (bundle move becomes atomic and identity-bearing instead of delete+recreate) is intrinsic to this slice — no separate foundation. Carries FR-010 as preserved behaviour, so the existing ungroup / opt-out path must not regress. Its identity decision is load-bearing for S-07 and S-08.
- **Status:** done

### S-06: Combined two-cohort view  *(north star)*

- **Outcome:** Author opens a combined view showing DP1 and DP2 side by side, one column per cohort, and edits either column (placement and bundle operations) within that cohort's constraints — cross-column (cross-cohort) moves are guarded so a bundle moves only within its own cohort. Every placement is validated live against students, teachers (within *and* across cohorts, counting both teachers of a co-taught course), week-aware fortnightly overlap, and availability — all within the sub-200 ms budget while validating both cohorts at once. The author ends with a complete, collision-free plan across DP1 and DP2.
- **Change ID:** combined-two-cohort-view
- **PRD refs:** FR-007, FR-008, FR-012 (preserved), US-01
- **Prerequisites:** S-04, S-05
- **Parallel with:** S-07
- **Blockers:** —
- **Unknowns:**
  - Combined-view layout / screen-fit (PRD Open Q #2): compact columns, horizontal scroll, density toggle, or collapse-to-one-column on a laptop — Owner: user + design. Block: no (a design input resolved in `/10x-plan`; does not block planning).
- **Risk:** The north star and the capstone — the first time the fully enriched validator runs against both cohorts simultaneously, so the sub-200 ms guardrail is re-proven here at its hardest. Sequenced as early as its real prerequisites allow (the two-cohort/cross-cohort board S-04 and first-class bundles S-05 are both mandatory; the existing single-cohort boards remain, so this view is additive, not a replacement). If the budget breaks here, the chain loops back to S-04/S-03 to optimise the validator before this view is shippable.
- **Status:** proposed

### S-07: Bundle holding container

- **Outcome:** Author can lift a bundle off the board into a temporary holding container (a shelf that holds multiple parked bundles), rearrange the board, then drag a parked bundle back onto a now-suitable slot. A parked bundle is off-board — it holds no slot and is **not** validated while parked; collisions are evaluated only on drop-back, within its cohort's constraints. A parked bundle survives an accidental browser refresh or tab close.
- **Change ID:** bundle-holding-container
- **PRD refs:** FR-011, US-02 (and Secondary Success Criterion: parked bundle survives refresh)
- **Prerequisites:** S-05
- **Parallel with:** S-01, S-02, S-03, S-04, S-06
- **Blockers:** —
- **Unknowns:**
  - Where a parked bundle persists for refresh-durability (a `holding` state on the bundle in Supabase vs. guarded `localStorage`) — Owner: dev. Block: no (note lessons.md: guard `localStorage` with try/catch, not just a `typeof window` check).
- **Risk:** Depends only on bundle identity from S-05, so it runs in parallel with the constraint chain and the combined view. Lower correctness risk (a parked bundle is explicitly unvalidated), but the durability NFR (no silent loss of a parked bundle) is the load-bearing requirement. Sequenced after S-05 because lifting a bundle as a unit requires the first-class bundle to exist.
- **Status:** done

### S-08: Editing undo / redo

- **Outcome:** Author can undo (and redo) recent editing operations — bundle move, remove, replace, ungroup, single-course move, lift-to-container, and place-back.
- **Change ID:** editing-undo-redo
- **PRD refs:** FR-013
- **Prerequisites:** S-05, S-07
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Undo/redo scope & priority (PRD Open Q #1, FR-013 is provisional): must-have for this change or a fast-follow? Single-step vs. multi-step history? Session-only vs. durable across reload? — Owner: author. **Block: yes** (the answer changes whether this slice exists in this change at all, and the PRD flags it may move the 4–6 week estimate).
- **Risk:** Wraps the full editing-operation set, so it depends on those operations existing (S-05, S-07) and ideally the combined view's edits too. Blocked until its scope is decided — building multi-step durable undo across every operation is a different slice than session-only single-step. Resolving Open Q #1 either promotes this to `ready` (after S-05/S-07) or moves it to a fast-follow / parks it.
- **Status:** blocked

## Backlog Handoff

| Roadmap ID | Change ID                       | Suggested issue title                                                | Ready for `/10x-plan` | Notes |
| ---------- | ------------------------------- | -------------------------------------------------------------------- | --------------------- | ----- |
| S-01       | dp1-dp2-cohort-naming           | Relabel cohorts DP1 / DP2 throughout the UI                          | yes                   | Run `/10x-plan dp1-dp2-cohort-naming` — no prerequisites |
| S-02       | co-teaching-teacher-sets        | Co-teaching: assign multiple teachers per course, both occupied      | yes                   | Run `/10x-plan co-teaching-teacher-sets` — head of constraint chain |
| S-03       | bi-weekly-week-aware-validation | Bi-weekly courses + week-aware collision validation                  | no                    | Promotes to `ready` once S-02 done |
| S-04       | two-cohort-board-cross-cohort   | Free cohort switching + symmetric cross-cohort teacher occupancy     | no                    | Promotes to `ready` once S-02 + S-03 done |
| S-05       | first-class-bundle-operations   | First-class bundle: move / remove / replace as a unit                | yes                   | Run `/10x-plan first-class-bundle-operations` — parallel with constraint chain |
| S-06       | combined-two-cohort-view        | Combined DP1 \| DP2 view (north star) — assemble both cohorts        | no                    | Promotes to `ready` once S-04 + S-05 done |
| S-07       | bundle-holding-container        | Holding container: park a bundle off-board, place it back            | no                    | Promotes to `ready` once S-05 done |
| S-08       | editing-undo-redo               | Undo / redo for editing operations                                   | no                    | Blocked on undo scope (Open Q #1); also waits for S-05 + S-07 |

## Open Roadmap Questions

1. **Undo/redo scope & priority (FR-013, PRD Open Q #1).** Must-have for this change or a fast-follow? Single-step vs. multi-step history? Session-only vs. durable across reload? — Owner: author. Block: **S-08** (and may move the 4–6 week estimate). This is the single highest-leverage decision in the change.
2. **Combined-view layout / screen-fit (FR-007, PRD Open Q #2).** Two cohort grids side by side strain a laptop screen — compact columns, horizontal scroll, density toggle, or collapse-to-one-column? — Owner: author + design. Block: no (a design input for S-06, resolvable in `/10x-plan`).
3. **CSV export in scope? (PRD Open Q #3).** Listed as must-preserve in the original product but never implemented. If in scope, it must represent the enriched model (co-teaching, bi-weekly week tags, both cohorts distinguishable) and would become a **new slice**; if not, it drops from the guardrails. — Owner: author. Block: no (does not gate any existing slice; resolving it in-scope adds a slice via `/10x-plan`).

## Parked

- **Arbitrary fortnight cycles** — Why parked: PRD §Non-Goals. Bi-weekly is a two-week A/B alternation only — no every-third-week, custom rotations, or month-based patterns.
- **Split-teaching** — Why parked: PRD §Non-Goals. Co-teaching models both teachers occupying the same slot together; it does not model teachers splitting a class across different times or rooms.
- **Configurable cohort names** — Why parked: PRD §Non-Goals. DP1/DP2 is a fixed relabel (S-01); cohort names are not user-editable. Possible future extension.
- **Cross-cohort rooms or students** — Why parked: PRD §Non-Goals. The symmetric cross-cohort constraint covers teacher occupancy only — rooms are out of product scope, students are single-cohort by definition.
- **Room / location validation** — Why parked: PRD §Non-Goals (carried forward).
- **End-to-end automatic timetable optimization / auto-placement** — Why parked: PRD §Non-Goals (carried forward).
- **Custom slot-grid editor (presets only)** — Why parked: PRD §Non-Goals (carried forward).
- **Student- and teacher-facing self-entry flows** — Why parked: PRD §Non-Goals (carried forward).
- **Multi-school / cross-school tenancy** — Why parked: PRD §Non-Goals (carried forward).
- **Mobile-optimized UX** — Why parked: PRD §Non-Goals (carried forward); laptop is the target form factor.
- **Printable / PDF export** — Why parked: PRD §Non-Goals (carried forward); CSV (if any) only.
- **Teacher soft preferences and hours-per-week caps** — Why parked: PRD §Non-Goals (carried forward); hard exclusions only.

## Done

(Empty on first generation. `/10x-archive` appends an entry here — and flips that item's `Status` to `done` — when a change whose `Change ID` matches a roadmap item is archived. Do NOT pre-populate.)

- **S-01: Author sees cohorts labelled **"DP1"** and **"DP2"** throughout the UI, replacing the "Year 1" / "Year 2" display labels. The `dp1` / `dp2` data values are unchanged.** — Archived 2026-06-20 → `context/archive/2026-06-20-dp1-dp2-cohort-naming/`. Lesson: —.
- **S-02: assign two+ teachers to a course; both count as occupied for conflict + availability** — Archived 2026-06-21 → `context/archive/2026-06-20-co-teaching-teacher-sets/`. Lesson: —.
- **S-03: mark a course bi-weekly, pick week A/B; two opposite-week courses share one slot** — Archived 2026-06-21 → `context/archive/2026-06-21-bi-weekly-week-aware-validation/`. Lesson: —.
- **S-05: A placed grouping is a first-class bundle the author can **move** (relocate all its courses atomically, re-validated at the destination, within its own cohort), **remove** (delete the whole bundle at once), or **replace** (swap its contents for a different compatible grouping on the same slot). Ungrouping to operate on individual courses — remove one course, move one course — keeps working exactly as today (the `slot_bundles` opt-out).** — Archived 2026-06-24 → `context/archive/2026-06-23-first-class-bundle-operations/`. Lesson: —.
- **S-07: Author can lift a bundle off the board into a temporary holding container (a shelf that holds multiple parked bundles), rearrange the board, then drag a parked bundle back onto a now-suitable slot. A parked bundle is off-board — it holds no slot and is **not** validated while parked; collisions are evaluated only on drop-back, within its cohort's constraints. A parked bundle survives an accidental browser refresh or tab close.** — Archived 2026-06-26 → `context/archive/2026-06-26-bundle-holding-container/`. Lesson: —.
