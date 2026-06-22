# Parity Harness for Enriched Validator Classes — Implementation Plan

## Overview

Land the test-plan **Phase 4** parity harness: a single, table-driven test that guards each enriched
validator class against false-positive "valid" verdicts (test-plan §2 **Risk #6**, scored High × High). The
harness asserts through `deriveCellViolations` — the authoritative committed-placement verdict — and
**backfills** the gaps left by S-02 (co-teaching) and S-03 (bi-weekly), which shipped before the guard
existed. Supporting work: extract a shared unit-fixture builder (and migrate the four existing model test
files onto it), add a §6 cookbook convention, and flip the test-plan rollout status to reflect Phase 4
landing.

This change touches **test + documentation only** — no production code, schema, or runtime path changes.

## Current State Analysis

- **The verdict boundary** is `deriveCellViolations(placements, catalogById, availability)` →
  `Map<cellKey, CellCollisions>` (`src/_pages/plan-detail/model/collisions.ts:42-70`), where
  `CellCollisions = { blockingIds, warningIds, unavailableIds, violations }` (`collisions.ts:11-23`) and
  `cellKey(day, period)` formats `"${day}:${period}"` (`collisions.ts:9`). Violation kinds:
  `duplicate-course | teacher | student | teacher-unavailable(severity)` (`constraints/types.ts:8-12`).
- **The enriched dimensions are under-tested at the board path.** `collisions.test.ts` exercises
  `deriveCellViolations` but only with **single-teacher** courses — co-teaching (teacher *set*) has never been
  asserted through this boundary; it lives only in `explainCell`-level tests
  (`constraints/constraints.test.ts`, `constraints/teacher-conflict.test.ts`). So a board-path co-teaching
  matrix is genuinely new coverage, not duplication.
- **Oracle hygiene is already correct** — every model test uses hand-typed literal expectations (not values
  recomputed from the validator). The backfill adds missing *requirement-anchored reject* fixtures; it does
  not fix tainted oracles.
- **The builders are duplicated and divergent across the four files**, which makes "migrate all" a real
  (behavior-preserving) refactor, not a find-replace:
  - `course`: `(id, teacher, studentKeys)` in `collisions.test.ts:8`, `collision.test.ts:5`,
    `constraints.test.ts:11`; but `(id, teacher)` in `teacher-conflict.test.ts:7` (no studentKeys).
  - `ctx`: `(...courses)` building a catalog in `constraints.test.ts:19`; but `(weeks?)` building an **empty**
    catalog in `teacher-conflict.test.ts:24`. Plus `ctxWeeks(weeks, ...courses)` (`constraints.test.ts:25`)
    and a local `unavailCtx(cell, strong)` (`constraints.test.ts:154`).
  - `placement` / `catalog` / `unionOfViolationCourseIds` live only in `collisions.test.ts`.
- **Naming collision risk.** `model/` already has `collisions.test.ts` and `collision.test.ts`; the new file
  is `collision-parity.test.ts` (user-chosen) — header comment must make its distinct purpose explicit.
- **`__fixtures__` precedent** exists at `src/_pages/plan-detail/api/__fixtures__/cohort-catalog.node.ts`,
  imported by `api/parity.test.ts` — the same within-slice, test-support pattern this plan mirrors in `model/`.
- **`weeksDisjoint`** (`model/week.ts:19`) is the shared week primitive; the cross-cohort param S-04 will add
  to `deriveCellViolations` does not exist yet, so S-04 fixtures cannot be expressed through the boundary
  today — forward-compat is an explicit extension point, not built plumbing.

## Desired End State

- A single `src/_pages/plan-detail/model/collision-parity.test.ts` holding the full board-path parity matrix
  for **S-02** and **S-03**, each as a `describe()` with an `it.each(fixtures)` table of full-oracle rows
  (literal expected violations) plus negative-parity (accepted) rows — and visible `it.todo` placeholders for
  **S-04** and **S-06**.
- A shared `src/_pages/plan-detail/model/__fixtures__/builders.ts` consumed by the harness and by the four
  migrated test files; no inline builder definitions remain in those files; the whole suite is green and
  type-clean.
- The test-plan reflects Phase 4 landed: §6 cookbook entry, §3 Phase 4 → `complete`, §5 parity gate → live.

**Verify:** `pnpm test` green, `pnpm check` clean, `pnpm lint` + `pnpm steiger` clean; manually confirm the
harness is a real oracle (temporarily breaking a constraint flips at least one parity fixture to red).

### Key Discoveries:

- Board-path enriched coverage is absent today (`collisions.test.ts` single-teacher only) — the matrix is additive.
- `ctx` has two incompatible signatures across files (`constraints.test.ts:19` vs `teacher-conflict.test.ts:24`) — resolved by named `cellCtx` / `weekCtx` / `availCtx` variants.
- `deriveCellViolations` has no cross-cohort parameter yet — S-04/S-06 are `it.todo`, not live fixtures.

## What We're NOT Doing

- **No production / domain code changes.** No constraint, `collisions.ts`, `week.ts`, or `load.ts` edits.
- **No S-04 plumbing.** We do not add a cohort axis to the builders or a cross-cohort param to
  `deriveCellViolations` — that is S-04's slice. The harness only leaves a documented `it.todo` extension point.
- **No deletion of existing tests.** The four files keep all their cases (at the `explainCell`/unit boundary);
  only their *builder definitions* move to the shared module. The board-path matrix is additive, accepting mild
  overlap at a different boundary by design.
- **No drop-hint (`deriveDropHints`) coverage** — that is the drag→feedback surface owned by test-plan Phase 3.
- **No new CI job.** The harness is a Vitest unit test; it runs in the existing `pnpm test` lane that already
  gates CI. "Gate live" is a documentation statement, not new infrastructure.

## Implementation Approach

Three phases, safety-net-first. Phase 1 is a pure behavior-preserving refactor (extract + migrate builders),
verified green before any new assertions are written — so the protected core's net never goes dark. Phase 2
writes the actual Risk #6 guard against the stable `deriveCellViolations` boundary, with requirement-anchored
literal oracles. Phase 3 records the convention and updates rollout status. The harness asserts at the board
path (not `explainCell`) precisely because that is the contract that survives the S-03/S-04 internal rewrites
(test-plan §1 principle #4).

## Phase 1: Shared fixture builder + migrate the four model test files

### Overview

Create one shared builder module and move the divergent inline builders onto it via named variants, leaving the
four files' assertions byte-for-byte equivalent in behavior. No new test cases in this phase.

### Changes Required:

#### 1. Shared builder module

**File**: `src/_pages/plan-detail/model/__fixtures__/builders.ts` (new)

**Intent**: Single home for the unit-test fixture builders, eliminating the per-file duplication and the
`ctx` signature divergence, and giving the harness (Phase 2) one import surface.

**Contract**: Pure functions over the app's own domain types (no bespoke fixture types — lessons.md "port the
mechanism"). Exports:
- `course(id: string, teacher: string | null, studentKeys?: string[]): GroupingCourse` — `studentKeys`
  defaults `[]` (covers `teacher-conflict.test.ts`'s 2-arg use); `teacher === null ⇒ teacherKeys: []`;
  `hours: 4`, `weekMode: "agnostic"`.
- `coTaught(id: string, teacherKeys: string[], studentKeys?: string[]): GroupingCourse`.
- `placement(id, courseId, day, period, week: PlacementWeek = "both"): PlannerPlacement`.
- `catalog(...courses: GroupingCourse[]): Map<string, GroupingCourse>`.
- `cellCtx(...courses): BoardContext` — `{ cell: {day:1,period:1}, catalogById }` (replaces
  `constraints.test.ts` `ctx`).
- `weekCtx(weeks: Record<string, PlacementWeek> | undefined, ...courses): BoardContext` — `cellCtx` +
  `weekByCourseId` (replaces `constraints.test.ts` `ctxWeeks` **and** `teacher-conflict.test.ts` `ctx(weeks?)`;
  zero courses ⇒ empty catalog; `undefined` weeks ⇒ `weekByCourseId` omitted).
- `availCtx(opts: { cell?: {day:number;period:number}; strong?: Map<string, Set<string>>; soft?: Map<string, Set<string>>; courses?: GroupingCourse[] }): BoardContext` — replaces the local `unavailCtx` and the inline soft/both contexts.
- `unionOfViolationCourseIds(cell: CellCollisions): Set<string>` — moved from `collisions.test.ts:210`.
- `avail(opts: { strong?: Record<string, string[]>; soft?: Record<string, string[]> }): AvailabilityIndex` —
  builds the `{ strongUnavailableByTeacher, softUnavailableByTeacher }` index from `teacherKey → cellKey[]`
  maps (each `string[]` becomes a `Set<cellKey>`). For the harness's S-02 teacher-unavailable rows so their
  table entries stay literal rather than hand-rolling nested `Map`/`Set` inline. The four migrated files keep
  their existing inline `availability` / `BoardContext` literals (out of scope for this builder).

Note: the `hours` default differs historically (`4` in most files, `1` in `teacher-conflict.test.ts`). `hours`
is irrelevant to every constraint under test (collision rules read teacher/student/week only), so standardize
on `4`; confirm green after migration proves it inert.

#### 2. Migrate `collisions.test.ts`

**File**: `src/_pages/plan-detail/model/collisions.test.ts`

**Intent**: Replace the inline `course`/`placement`/`catalog` and the trailing `unionOfViolationCourseIds`
with imports from `./__fixtures__/builders`.

**Contract**: Delete local builder defs (`:8-30`, `:210-217`); add the import. No `it()` body changes. The
inline `availability` object literals stay (they are `AvailabilityIndex` args to `deriveCellViolations`, not
`BoardContext`).

#### 3. Migrate `collision.test.ts`

**File**: `src/_pages/plan-detail/model/collision.test.ts`

**Intent**: Replace the inline `course` (`:5-11`) with the shared import.

**Contract**: Delete local builder; add import. Bodies unchanged.

#### 4. Migrate `constraints/constraints.test.ts`

**File**: `src/_pages/plan-detail/model/constraints/constraints.test.ts`

**Intent**: Map the inline builders to shared variants: `course`→`course`, `ctx`→`cellCtx`,
`ctxWeeks`→`weekCtx`, local `unavailCtx(cell, strong)`→`availCtx({ cell, strong })`. The two inline
soft/both `BoardContext` literals (`:177-181`, `:189-194`) become `availCtx({ soft })` / `availCtx({ strong, soft })`.

**Contract**: Delete local builder defs (`:11-28`, `:154-158`); add import; rewrite the ~ handful of `ctx*`
call sites to the named variants. No expected-value changes.

#### 5. Migrate `constraints/teacher-conflict.test.ts`

**File**: `src/_pages/plan-detail/model/constraints/teacher-conflict.test.ts`

**Intent**: Map `course(id, teacher)`→`course(id, teacher)` (shared default `studentKeys: []`),
`coTaught`→`coTaught`, `ctx(weeks?)`→`weekCtx(weeks)`.

**Contract**: Delete local builder defs (`:7-28`); add import; rewrite `ctx(...)` calls to `weekCtx(...)`.
Bodies otherwise unchanged.

### Success Criteria:

#### Automated Verification:

- Unit suite passes unchanged: `pnpm test`
- Type-check clean: `pnpm check`
- Lint clean: `pnpm lint`
- FSD structure clean: `pnpm steiger`

#### Manual Verification:

- Diff of the four files shows only builder-definition removal + import + `ctx`→named-variant rewrites — **no
  changed assertions or expected values**.
- `git stash` the builder module and confirm the four files fail to resolve the import (proves they actually
  consume the shared module, not leftover locals).

**Implementation Note**: After Phase 1 automated verification passes, pause for manual confirmation before
Phase 2.

---

## Phase 2: Author `collision-parity.test.ts` (the Risk #6 guard)

### Overview

Write the single table-driven harness asserting the enriched-class parity matrix through
`deriveCellViolations`. Each enriched class is a `describe()` wrapping one `it.each(fixtures)` table; rows are
full oracles (literal expected violations) and include negative-parity (accepted) rows. S-04 and S-06 are
`it.todo` placeholders documenting the pending classes.

### Changes Required:

#### 1. The harness file

**File**: `src/_pages/plan-detail/model/collision-parity.test.ts` (new)

**Intent**: Be the one authoritative Risk #6 surface — "does each enriched class have a false-positive guard?"
answerable at a glance — asserting the committed-placement verdict for co-teaching and bi-weekly.

**Contract**: Imports builders from `./__fixtures__/builders` and `deriveCellViolations`/`cellKey` from
`./collisions`. A header comment states its purpose and links test-plan §2 Risk #6 + the §6 cookbook entry,
and disambiguates it from `collisions.test.ts` (the general oracle) and `collision.test.ts` (`hasIntersection`).

Row shape (one table per class):
```
type ParityCase = {
  name: string;
  placements: PlannerPlacement[];
  catalog: Map<string, GroupingCourse>;
  availability?: AvailabilityIndex;          // for teacher-availability rows — build via `avail({ strong, soft })`
  cell: { day: number; period: number };
  expect:
    | { verdict: "invalid"; blockingIds: Set<string>; violations: CollisionViolation[] }
    | { verdict: "warn"; warningIds: Set<string>; violations: CollisionViolation[] }  // soft, never blocking
    | { verdict: "valid" };                  // no cell entry (or empty blocking)
};
```
The single assertion per row: run `deriveCellViolations(placements, catalog, availability)`, then for
`invalid` assert `blockingIds` + `violations` equal the literals; for `warn` assert `warningIds` + `violations`
and empty `blockingIds`; for `valid` assert `result.has(cellKey(...)) === false`.

**S-02 co-teaching matrix** (`describe("co-teaching (S-02) parity")`), expected values from FR-001/FR-012:
- *invalid* — two co-taught courses sharing exactly one teacher (`{t1,t2}` + `{t2,t3}`) → `teacher`/`t2`,
  blocking `{A,B}` **(new board-path coverage)**.
- *invalid* — two co-taught courses sharing ≥2 teachers (`{t1,t2}` + `{t1,t2}`) → two `teacher` violations,
  blocking `{A,B}` **(new)**.
- *invalid* — mixed cardinality: scalar `{t1}` + co-taught `{t1,t2}` → `teacher`/`t1`, blocking `{A,B}` **(new)**.
- *invalid* — co-taught `{t1,t2}`, `t2` strong-unavailable at cell → `teacher-unavailable`/`t2`/`block`,
  blocking `{A}`, unavailable `{A}` (board-path).
- *invalid* — co-taught `{t1,t2}`, both strong-unavailable → two `teacher-unavailable`/`block` (board-path).
- *warn* — co-taught `{t1,t2}`, `t2` **soft**-unavailable → `teacher-unavailable`/`t2`/`warn`, warning `{A}`,
  empty blocking **(new)**.
- *valid* — co-taught courses with disjoint teacher sets (`{t1,t2}` + `{t3,t4}`), no shared students → accepted.

**S-03 bi-weekly matrix** (`describe("bi-weekly (S-03) parity")`), expected values from FR-002/FR-003/US-03:
- *invalid* — same-week (`a`/`a`) sharing a teacher → `teacher`, blocking `{A,B}`.
- *invalid* — same-week sharing students → `student`.
- *invalid* — agnostic (`both`) + single-week (`a`) sharing a teacher → `teacher`, blocking `{A,B}`.
- *invalid* — default-week placement (untagged ⇒ `both`) + single-week (`a`) sharing a teacher → collide;
  row name records the "untagged behaves as both" contract **(new board-path coverage)**.
- *invalid* — `{both, a, b}` three courses sharing a teacher → one `teacher` violation citing all three.
- *valid* — opposite-week (`a`/`b`) sharing a teacher **and** students → accepted (the core over-rejection
  guard).
- *valid* — opposite-week sharing students only → accepted.

**S-04 / S-06 extension point**: a `describe("cross-cohort (S-04) parity")` and
`describe("combined two-cohort (S-06) parity")` each containing `it.todo(...)` lines naming the scenarios
(symmetric same-week block both directions; opposite-week valid; agnostic overlaps all; different-slot valid;
single-cohort regression; availability orthogonal) and a comment: blocked on `deriveCellViolations` gaining a
cross-cohort occupancy parameter (S-04 slice). This keeps the pending classes visible in the guard surface.

### Success Criteria:

#### Automated Verification:

- New harness passes: `pnpm test`
- Type-check clean: `pnpm check`
- Lint clean: `pnpm lint`
- FSD structure clean: `pnpm steiger`

#### Manual Verification:

- **Oracle integrity probe**: temporarily weaken a constraint (e.g. make `teacher-conflict` ignore the second
  co-teacher, or make `weeksDisjoint` always true) and confirm at least one S-02 and one S-03 parity fixture
  turns **red**; revert. Proves the matrix actually guards, and that expected values were not lifted from the
  validator.
- `it.todo` placeholders for S-04/S-06 render in the test report as pending (visible guard gaps).

**Implementation Note**: After Phase 2 automated verification passes, pause for manual confirmation before
Phase 3.

---

## Phase 3: Convention doc + test-plan rollout status

### Overview

Record the parity-fixture convention in the cookbook and update the rollout status to reflect Phase 4 landing.

### Changes Required:

#### 1. Cookbook convention

**File**: `context/foundation/test-plan.md`

**Intent**: Give future contributors the standard for adding a new-validator-class parity fixture, where they
already look for test how-tos.

**Contract**: New §6 subsection "Adding a new-validator-class parity fixture" (after §6.5). Covers: location
(`model/collision-parity.test.ts`, one file, append a `describe()` per class); assert through
`deriveCellViolations` (the stable boundary, not `explainCell`); **expected values from requirements, never
recomputed from the validator** (cite the oracle-problem anti-pattern); include negative-parity (accepted)
rows; use the shared `__fixtures__/builders.ts`; run with `pnpm test`. Reference `collision-parity.test.ts` as
the live example.

#### 2. Rollout status flip

**File**: `context/foundation/test-plan.md`

**Intent**: Mark Phase 4's convention + harness as landed (per the user's decision to flip status in this
change), while making clear the S-04/S-06 *per-class fixtures* append as those slices ship.

**Contract**: §3 phase table Phase 4 Status `not started` → `complete`, change-folder cell →
`context/changes/parity-harness-enriched-validators/`; add a §3 note that the harness + S-02/S-03 backfill
landed and S-04/S-06 rows are `it.todo` pending their slices. §5 "Current enforcement" note: the
**new-validator-class parity** gate is now **live** (satisfied by the unit lane) — but word it as
*convention live; enforced by review plus the `it.todo` reminders, not a CI failure* so "live" is not read as
"CI blocks an unguarded new class" (an `it.todo` does not fail the suite). Add a one-line caveat that
`/10x-test-plan` remains the orchestrator of record for rollout state.

#### 3. Harness header cross-link

**File**: `src/_pages/plan-detail/model/collision-parity.test.ts`

**Intent**: Point readers from the harness to the convention.

**Contract**: One line in the header comment linking test-plan §6 (the new subsection). (Authored in Phase 2;
confirm the link target now exists.)

### Success Criteria:

#### Automated Verification:

- Full suite still green: `pnpm test`
- Type-check clean: `pnpm check`
- Lint + structure clean: `pnpm lint` && `pnpm steiger`

#### Manual Verification:

- test-plan §3/§5/§6 read consistently — no dangling "not started"/"planned" for Phase 4; the §6 example
  reference resolves to the real file.
- The §6 entry's oracle-discipline wording matches what the harness actually does.

**Implementation Note**: Final phase — after verification, the change is ready for `/10x-impl-review` and commit.

---

## Testing Strategy

### Unit Tests:

- The deliverable **is** the test (`collision-parity.test.ts`) — the full board-path parity matrix for S-02
  and S-03, full-oracle rows + negative-parity rows.
- The four migrated files retain their existing `explainCell`/unit assertions unchanged.

### Integration Tests:

- None. This change adds no server/DB surface; the parity guard is a pure in-memory model test.

### Manual Testing Steps:

1. `pnpm test` — entire suite green after each phase.
2. Oracle-integrity probe (Phase 2 manual): break a constraint, watch a parity fixture go red, revert.
3. Read test-plan §3/§5/§6 for consistency after Phase 3.

## Performance Considerations

None. Pure unit tests; no runtime path touched. The sub-200 ms placement budget (test-plan §7) is unaffected
and remains out of automated scope.

## Migration Notes

Phase 1 is a behavior-preserving builder migration: the resulting `GroupingCourse`/`PlannerPlacement`/
`BoardContext` objects are identical to today's; only the *source* of the builders moves. The `hours`
standardization (`1`→`4` in `teacher-conflict.test.ts`) is inert for every constraint under test and is proven
so by the green suite.

## References

- Research: `context/changes/parity-harness-enriched-validators/research.md`
- Verdict boundary: `src/_pages/plan-detail/model/collisions.ts:42-70`
- Oracle convention to mirror: `src/_pages/plan-detail/model/collisions.test.ts:8-40`
- `__fixtures__` precedent: `src/_pages/plan-detail/api/__fixtures__/cohort-catalog.node.ts`
- Standard: `context/foundation/test-plan.md` §2 Risk #6, §3 Phase 4, §5, §6

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared fixture builder + migrate the four model test files

#### Automated

- [x] 1.1 Unit suite passes unchanged: `pnpm test` — 5fdacc2
- [x] 1.2 Type-check clean: `pnpm check` — 5fdacc2
- [x] 1.3 Lint clean: `pnpm lint` — 5fdacc2
- [x] 1.4 FSD structure clean: `pnpm steiger` — 5fdacc2

#### Manual

- [x] 1.5 Diff of the four files shows only builder removal + import + `ctx`→named-variant rewrites (no changed assertions) — 5fdacc2
- [x] 1.6 Stashing the builder module breaks the four files' imports (proves real consumption) — 5fdacc2

### Phase 2: Author collision-parity.test.ts (the Risk #6 guard)

#### Automated

- [x] 2.1 New harness passes: `pnpm test`
- [x] 2.2 Type-check clean: `pnpm check`
- [x] 2.3 Lint clean: `pnpm lint`
- [x] 2.4 FSD structure clean: `pnpm steiger`

#### Manual

- [x] 2.5 Oracle-integrity probe: breaking a constraint reddens ≥1 S-02 and ≥1 S-03 fixture; reverted
- [x] 2.6 S-04/S-06 `it.todo` placeholders render as pending in the report

### Phase 3: Convention doc + test-plan rollout status

#### Automated

- [ ] 3.1 Full suite still green: `pnpm test`
- [ ] 3.2 Type-check clean: `pnpm check`
- [ ] 3.3 Lint + structure clean: `pnpm lint` && `pnpm steiger`

#### Manual

- [ ] 3.4 test-plan §3/§5/§6 read consistently; §6 example reference resolves to the real file
- [ ] 3.5 §6 oracle-discipline wording matches harness behavior
