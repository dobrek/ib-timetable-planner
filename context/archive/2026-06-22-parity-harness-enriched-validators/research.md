---
date: 2026-06-22T19:31:14+0200
researcher: Dobromir Kropielnicki
git_commit: adba155fc938e4b1f5750620002af6824d72ea9b
branch: main
repository: dobrek/ib-timetable-planner
topic: "Parity-harness convention for enriched validator classes (test-plan Phase 4) + S-02/S-03 backfill + S-04 forward-compat"
tags: [research, codebase, parity-harness, constraints, collisions, validator, phase-4, risk-6]
status: complete
last_updated: 2026-06-22
last_updated_by: Dobromir Kropielnicki
---

# Research: Parity-harness convention for enriched validator classes (test-plan Phase 4)

**Date**: 2026-06-22T19:31:14+0200
**Researcher**: Dobromir Kropielnicki
**Git Commit**: adba155fc938e4b1f5750620002af6824d72ea9b
**Branch**: main
**Repository**: dobrek/ib-timetable-planner

## Research Question

Design a table-driven "parity harness" — a false-positive guard ("no placement marked *valid* that the
richer rule should reject") for each enriched validator class — per test-plan §3 **Phase 4** / §2 **Risk #6**.
Scope decisions (locked with the user before research):
- **Backfill S-02 (co-teaching) + S-03 (bi-weekly)** with retroactive parity fixtures (they shipped without the guard).
- **S-04 (cross-cohort) is the first new consumer** — the harness shape must support it from day one without over-fitting.
- **Harness home:** research to recommend (extend an existing pattern vs. a dedicated harness).

## Summary

**The stable boundary to assert against is `deriveCellViolations(...)`** — the authoritative cell-level
collision verdict (`src/_pages/plan-detail/model/collisions.ts:42-70`). It returns
`Map<cellKey, CellCollisions>` where `CellCollisions.violations` enumerates every `CollisionViolation` in
registry order. This is the single contract that survives the S-03/S-04 rewrites and is the correct parity
oracle target. `deriveDropHints(...)` (`model/drop-hints.ts:93-131`) is a **separate, secondary** verdict
surface (the drag affordance) — out of scope for the false-positive parity guard, which is about the
committed-placement verdict.

**Harness home recommendation: a dedicated, table-driven validator-parity harness** that asserts through
`deriveCellViolations` (the board path), with **hand-typed expected violations drawn from requirements**.
Rationale:
- The name "parity" is already taken twice by *unrelated* concerns — `api/parity.test.ts` (grouping output
  vs. CSV golden) and `api/adapter-parity.integration.test.ts` (board-vs-server). Neither is the Risk #6
  false-positive guard. A new file avoids overloading the term further; suggest naming it for what it is
  (e.g. `collision-parity.test.ts` or `validator-parity.test.ts` co-located in `model/`).
- The existing oracle convention (`collisions.test.ts`) is already clean — **hand-typed literal
  expectations**, inline `course`/`placement`/`catalog` builders. The harness should adopt this oracle
  discipline but make it **table-driven** (the repo's `it.each` idiom, today used only for schema tests),
  so each enriched class contributes a labelled fixture array.
- Do **not** use the CSV-golden pattern (that fits deterministic grouping output, not hand-stated rules).

**Backfill is small and surgical** — both shipped slices already use hand-typed literal oracles (no
oracle-problem taint), so the work is *adding the missing requirement-anchored REJECT fixtures*, not fixing
tainted ones. Net new fixtures: ~5 (S-02: mixed scalar+set intersection, ≥2 shared teachers via `explain`,
co-taught pair through the board path, co-taught soft second-teacher → warn; S-03: explicit untagged-`both`
vs single-week reject through the board path).

**S-04 imposes exactly one new harness axis**: a **cohort dimension** on occupants plus a **sibling-cohort
occupancy context slot** (teacher × week, narrowed to the target cell). Everything else reuses the
teacher-set (S-02) and week (S-03) dimensions. No new `CollisionViolation` kind — cross-cohort conflict
reports as the existing `{ kind: "teacher", ... }`, so the assertion side needs no extension.

## Detailed Findings

### A. The validator verdict boundary (what the harness asserts)

**Primary boundary — `deriveCellViolations`** (`src/_pages/plan-detail/model/collisions.ts:42-70`):

```ts
export const deriveCellViolations = (
  placements: PlannerPlacement[],
  catalogById: Map<string, GroupingCourse>,
  availability: AvailabilityIndex = NO_AVAILABILITY,
): Map<string, CellCollisions>
```

Returns per-cell (`src/_pages/plan-detail/model/collisions.ts:11-23`):

```ts
export type CellCollisions = {
  blockingIds: Set<string>;   // BLOCKING (collisions + strong-NO) → invalid
  warningIds: Set<string>;    // WARN only (soft-NO) → never invalid
  unavailableIds: Set<string>;
  violations: CollisionViolation[]; // registry order: duplicate → teacher → student → availability
};
```

**Constraint registry** (`src/_pages/plan-detail/model/constraints/index.ts:9-14`): `CELL_CONSTRAINTS =
[duplicateCourse, teacherConflict, studentConflict, teacherAvailability]`. Aggregated by `explainCell`
(`index.ts:17-18`); fast-path boolean `violatesAny` (`index.ts:24-25`) is used by enumeration + drop hints.

**Shared constraint contract** (`src/_pages/plan-detail/model/constraints/types.ts:32-40`):

```ts
export type CellConstraint = {
  id: string;
  explain(occupants: GroupingCourse[], ctx: BoardContext): CollisionViolation[];
  test?(course: GroupingCourse, others: GroupingCourse[]): boolean;
};
```

**Violation union** (`types.ts:8-12`): `duplicate-course | teacher | student | teacher-unavailable`
(the last carries `severity: "block" | "warn"`).

**Context input** (`types.ts:20-30`) — the additive seam:

```ts
export type BoardContext = {
  cell: { day: number; period: number };
  catalogById: Map<string, GroupingCourse>;
  strongUnavailableByTeacher?: Map<string, Set<string>>; // cellKey set per teacher → block
  softUnavailableByTeacher?: Map<string, Set<string>>;   // → warn
  weekByCourseId?: Map<string, PlacementWeek>;           // S-03 week-overlap input
};
```

The comment at `types.ts:14-19` explicitly anticipates **cross-cohort occupancy** as a future additive
optional field "without touching existing evaluators."

**Enriched dimensions plug in here:**
- **Teacher set (S-02):** `GroupingCourse.teacherKeys: string[]` (`src/shared/lib/catalog-hash/types.ts:10-17`).
  `teacher-conflict.ts:23-27` indexes per teacher; `teacher-availability.ts:26-34` fans out one violation
  per unavailable co-teacher.
- **Week (S-03):** `weeksDisjoint` (`model/week.ts:19`) — `a !== "both" && b !== "both" && a !== b`. Used by
  `student-conflict.ts:13-24` and `teacher-conflict.ts:31-42` to skip opposite-week pairs. Fed via
  `ctx.weekByCourseId`; absent ⇒ treated as `both` (`teacher-conflict.ts:20`).

**Secondary surface (out of scope for this guard):** `deriveDropHints` (`model/drop-hints.ts:93-131`)
returns `Map<cellKey, DropHint>` where `DropHint = "partial" | "blocked" | "warn" | "opposite-week"`
(`drop-hints.ts:24`). It is the drag affordance, uses `violatesAny` (not `explainCell`), and can differ
from the committed verdict (e.g. drag-back-to-origin). The Phase 4 false-positive guard is about the
*committed placement verdict*, so it targets `deriveCellViolations`, not drop hints. (Drop-hint correctness
is the test-plan **Phase 3** drag→feedback concern, a different rollout phase.)

### B. Existing test conventions (what the harness must fit)

**Independent-oracle convention is already in place** — `collisions.test.ts` uses **hand-typed literal
expectations** (not recomputed from the validator), with inline module-scope builders
(`src/_pages/plan-detail/model/collisions.test.ts:8-30`):

```ts
const course = (id, teacher, studentKeys): GroupingCourse => ({ id, teacherKeys: teacher === null ? [] : [teacher], studentKeys, hours: 4, weekMode: "agnostic" });
const placement = (id, courseId, day, period, week = "both"): PlannerPlacement => ({ id, courseId, day, period, week });
const catalog = (...courses) => new Map(courses.map((c) => [c.id, c]));
```

Representative case (`collisions.test.ts:33-40`) asserts literal `blockingIds` + `violations`. **Structure is
individual `it()` blocks**, not table-driven. Same pattern in `collision.test.ts`, `constraints.test.ts`
(adds `ctx`/`ctxWeeks` builders, `constraints.test.ts:11-25`), `teacher-conflict.test.ts` (adds a `coTaught`
builder, `:7-27`), `week.test.ts`.

**Table-driven idiom exists but only for schema tests** — `it.each` with tuple rows + `%s` label, e.g.
`placement-actions.test.ts:28-36` and `grouping-actions.test.ts:11-16`. No `describe.each` anywhere. The
harness can legitimately introduce `it.each`/`describe.each` into domain-logic testing for this purpose —
it's the house idiom, just not yet applied to the model layer.

**The two existing `*parity*` files are unrelated** to Risk #6:
- `api/parity.test.ts:26-54` — grouping output vs. **CSV golden** (`data/out/dp2-variants-2.csv`), loaded via
  `parseGolden` (`:13-24`) + `loadFixtureCourses` (`api/__fixtures__/cohort-catalog.node.ts:7-70`). Guards
  the grouping core, explicitly excluded from re-litigation (test-plan §7).
- `api/adapter-parity.integration.test.ts` — board-vs-server adapter parity.

**Fixture builders:** unit tests use **per-file inline factories** (no shared unit builder exists today —
mild duplication across `collisions`/`collision`/`constraints`/`teacher-conflict` test files). The
`src/test/factories/` directory is **integration-only** (Supabase, CSV-seeded) — not for unit oracles.
A small shared unit-fixture builder is an option the harness could introduce (DRY the `course`/`placement`/
`ctx` factories), but it's not required.

### C. Backfill work-list (S-02 + S-03)

Both slices already use hand-typed literal oracles → **no oracle-problem taint**; backfill = add missing
requirement-anchored REJECT fixtures.

**S-02 — co-teaching (teacher = set; collide if teacher sets intersect; unavailable if *any* co-teacher is):**

| # | False-positive scenario (must REJECT) | Status | Evidence |
|---|---|---|---|
| 1 | Two co-taught courses share exactly one teacher → flag, name shared teacher | **covered** | `teacher-conflict.test.ts:41-45` |
| 2 | ≥2 shared teachers → one violation per shared teacher (via `explain`) | **MISSING** (only disjoint negative + `.test` fast-path positive exist) | gap |
| 3 | Scalar course + co-taught course where scalar teacher ∈ set → collide (mixed cardinality) | **MISSING** (only `.test`-false null case at `constraints.test.ts:70-71`) | backfill |
| 4 | Co-taught course, *second* co-teacher strong-unavailable → block, name that teacher | covered | `constraints.test.ts:224-236` |
| 5 | Both co-teachers unavailable → 2 block violations (fan-out) | covered | `constraints.test.ts:206-222` |
| 6 | One co-teacher free, one unavailable → exactly one violation (no masking) | covered | `constraints.test.ts:224-236` |
| 7 | Co-taught course, soft-unavailable second co-teacher → warn | **MISSING** (soft→warn only tested for single-teacher, `:175-185`) | backfill |
| — | Co-taught pair sharing a teacher rejected through the **`deriveCellViolations` board path** | **MISSING** (`collisions.test.ts` uses single-teacher fixtures only) | backfill |

**S-03 — bi-weekly (week-aware; opposite-week share OK; same-week / `both` overlap collide):**

| # | False-positive scenario (must REJECT) | Status | Evidence |
|---|---|---|---|
| 1 | Same-week (`a`/`a`) share teacher → collide | covered | `teacher-conflict.test.ts:64-68`; `collisions.test.ts:93-97` |
| 2 | Same-week share students → collide | covered | `constraints.test.ts:115-121` |
| 3 | `both`/agnostic + single-week share → collide (`both` overlaps all) | covered | `teacher-conflict.test.ts:70-74`; `collisions.test.ts:108-112` |
| 4 | **Untagged** (week absent → defaults `both`) vs single-week → collide, through board path | **MISSING / implicit** (only `weeksDisjoint` unit truth-table + code fallback) | backfill |
| 5 | `{both, a, b}` three-course teacher case → collide, cite the `both` bridge | covered | `teacher-conflict.test.ts:76-83` |
| 6 | (negative parity) genuine `a`/`b` opposite-week → accepted | covered | `teacher-conflict.test.ts:60-61`; `collisions.test.ts:87-91` |

**Net backfill ≈ 5 fixtures:** S-02 (#2, #3, #7, board-path) + S-03 (#4). Everything else already covered.

### D. S-04 forward-compat requirements (first new consumer)

**Today's single-cohort lock:** `BOARD_COHORT = "dp1"` (`src/_pages/plan-detail/api/load.ts:15`); all
placement/grouping/slot-bundle queries filter `.eq("cohort", BOARD_COHORT)`. **Exception:**
`teacher_availability` is loaded with **no cohort filter** (`load.ts:64`) — already cohort-independent +
week-agnostic. So **S-04 is a teacher-*occupancy* concern only; availability needs no change.**

**The one new context field** (additive to `BoardContext`, mirroring `weekByCourseId`):

```ts
/** Teachers occupied in the OTHER cohort at THIS cell, with the week(s) they occupy.
 *  Absent ⇒ single-cohort board ⇒ behaves exactly as today. */
otherCohortOccupancyByTeacher?: Map<string, Set<PlacementWeek>>;
```

The cross-cohort check reuses `weeksDisjoint` exactly as `week.ts:6-8` anticipates ("S-04's cross-cohort
occupancy check reuses it") and emits the existing `{ kind: "teacher", ... }` violation — **no new kind**.

**S-04 parity fixtures (the harness must be able to express these):**
1. Symmetric block, same week: T in DP1(d,p,A); placing T in DP2(d,p,A) invalid — **both directions**.
2. Opposite week valid: DP1(d,p,A) + DP2(d,p,B) accepted.
3. Agnostic overlaps all: DP1(d,p,`both`) + DP2(d,p,A) invalid.
4. Different slot valid: DP1(d,p) + DP2(d',p') accepted.
5. Single-cohort regression: absent field ⇒ identical to today.
6. Availability orthogonal: cross-cohort occupancy must not leak into the availability verdict.

**Harness axes — needed vs. speculative:**
- **NEEDED (new):** a **cohort axis** on occupants (`Cohort` already exists in `src/shared/config/cohorts.ts`,
  `COHORT_VALUES = ["dp1","dp2"]`); a **sibling-cohort occupancy input slot** (teacher × week at the target cell).
- **NEEDED (reuse):** per-occupant `PlacementWeek` (S-03), teacher-set (S-02), `(day,period)` cell, the
  `CollisionViolation[]` assertion shape — all already present.
- **SPECULATIVE — do not bake in:** a cohort axis on *availability* (it's cohort-independent already); an
  N-cohort abstraction (domain is fixed at exactly 2); a "both cohorts rendered at once" input (that's
  **S-06**, a later slice — the harness must not pre-build combined-view inputs).

## Code References

- `src/_pages/plan-detail/model/collisions.ts:42-70` — `deriveCellViolations` (PRIMARY parity boundary)
- `src/_pages/plan-detail/model/collisions.ts:11-23` — `CellCollisions` verdict container
- `src/_pages/plan-detail/model/collisions.ts:9` — `cellKey` formatter (`"${day}:${period}"`, no cohort)
- `src/_pages/plan-detail/model/constraints/index.ts:9-25` — registry + `explainCell` + `violatesAny`
- `src/_pages/plan-detail/model/constraints/types.ts:8-40` — violation union, `BoardContext` (additive seam at :14-19), `CellConstraint`
- `src/_pages/plan-detail/model/constraints/teacher-conflict.ts:23-42` — teacher-set indexing + week relaxation
- `src/_pages/plan-detail/model/constraints/teacher-availability.ts:26-34` — per-co-teacher fan-out
- `src/_pages/plan-detail/model/week.ts:6-8,19` — `weeksDisjoint` (S-04 reuse point)
- `src/_pages/plan-detail/model/drop-hints.ts:24,93-131` — secondary surface (OUT of scope)
- `src/_pages/plan-detail/model/collisions.test.ts:8-40` — independent-oracle convention to mirror
- `src/_pages/plan-detail/model/constraints/constraints.test.ts:11-25` — `ctx`/`ctxWeeks` builders
- `src/_pages/plan-detail/model/constraints/teacher-conflict.test.ts:7-83` — `coTaught` builder + week block
- `src/_pages/plan-detail/api/parity.test.ts:13-54` — grouping-vs-CSV golden (name collision; NOT Risk #6)
- `src/_pages/plan-detail/api/placement-actions.test.ts:28-36` — `it.each` house idiom
- `src/_pages/plan-detail/api/load.ts:15,60-64` — `BOARD_COHORT` lock + availability-no-filter exception
- `src/shared/config/cohorts.ts` — `COHORT_VALUES = ["dp1","dp2"]` (fixed two-cohort enum)
- `src/test/factories/` — integration-only builders (NOT for unit oracles)

## Architecture Insights

- **One verdict, two surfaces.** `deriveCellViolations` (committed verdict) and `deriveDropHints` (drag
  affordance) are deliberately separate. Phase 4 (false-positive guard) targets the former; Phase 3
  (drag→feedback) targets the latter. Keep the harness on `deriveCellViolations` to avoid scope bleed.
- **The `BoardContext` additive-optional-field pattern is the extension mechanism** for every enriched
  dimension (week already; cross-cohort next). A harness that builds `BoardContext`/placements directly and
  asserts `violations` will survive S-03/S-04 internal rewrites — exactly the "stable boundary, not internal
  structure" requirement of test-plan §1 principle #4.
- **Oracle hygiene is already the norm** (hand-typed literals). The Phase 4 contribution is *organization*
  (table-driven, per-class, requirement-labelled) + *coverage* (the missing reject fixtures), not a new
  testing philosophy.
- **`weeksDisjoint` was deliberately kept a named export for S-04** (`week.ts:6-8`) — the codebase is already
  staged for cross-cohort; the harness should assume cross-cohort reuses week semantics, not reinvents them.
- **Lessons.md priors that apply:** "Port the mechanism, not the legacy type shape" (model the harness on the
  app's own `GroupingCourse`/`PlannerPlacement`/`BoardContext`, not a bespoke fixture type); "Green
  build/test/lint ≠ type-safe — `pnpm check` is the type gate" (the harness fixtures must pass `astro check`).

## Historical Context (from prior changes)

- `context/archive/2026-06-20-co-teaching-teacher-sets/` (S-02) — shipped teacher-as-set; tests use hand-typed
  oracles but lack the mixed scalar+set intersection reject and a board-path co-taught reject.
- `context/archive/2026-06-21-bi-weekly-week-aware-validation/` (S-03) — shipped `weeksDisjoint` + week-aware
  constraints; strong coverage except the explicit untagged-`both`-vs-single-week board-path reject.
- `context/foundation/test-plan.md` §2 Risk #6, §3 Phase 4, §5 (new-validator-class parity gate), §6.1 —
  the parity-guard standard this change implements; Phase 4 "owns the whole enriched-dimension wave
  (S-02/S-03/S-04/S-06)" and was meant to land before S-03 (slipped → hence the backfill).

## Related Research

- `context/archive/2026-06-20-co-teaching-teacher-sets/research.md`
- `context/archive/2026-06-21-bi-weekly-week-aware-validation/research.md`
- (forthcoming) the S-04 `two-cohort-board-cross-cohort` change will consume this harness — its own research
  should reference §D above.

## Open Questions — RESOLVED (2026-06-22, with user)

1. **Harness file name + location — DECIDED:** `src/_pages/plan-detail/model/collision-parity.test.ts`,
   a **single** co-located file (one place for all enriched-class guards; S-04/S-06 append blocks later).
   Header comment links to the test-plan §6 cookbook entry and §2 Risk #6.
2. **Shared unit-fixture builder — DECIDED: extract AND migrate all.** Create a shared builder under
   `src/_pages/plan-detail/model/__fixtures__/` (precedent: `api/__fixtures__/`) exposing the
   `course`/`coTaught`/`placement`/`catalog`/`ctx`/`ctxWeeks` factories, and **migrate the four existing
   test files** (`collisions.test.ts`, `collision.test.ts`, `constraints/constraints.test.ts`,
   `constraints/teacher-conflict.test.ts`) onto it. Migration is behavior-preserving — only the builder
   *source* moves; assertions are untouched (honors test-plan §1 principle #4). The builder is the natural
   extension point for S-04's cohort axis.
3. **Convention doc surface — DECIDED:** add a new **test-plan §6 cookbook** subsection ("Adding a
   new-validator-class parity fixture") + a short header note in the harness file pointing to it.
4. **Fixture table shape — DECIDED:** hand-written `describe()` per enriched class wrapping a single
   `it.each(fixtures)` table (no `describe.each`). Rows are full oracles — **expected violations as
   hand-typed literals** (mirroring `collisions.test.ts`) — and each class includes **negative-parity rows**
   (opposite-week / clean → *accepted*) to also guard over-rejection. Row shape:
   `{ name, placements, catalog, ctx?, expect: "invalid" | "valid", expectedViolations? }`.
