/**
 * Enriched-validator-class PARITY HARNESS — the test-plan §2 Risk #6 guard (scored High × High).
 *
 * Purpose: for each enriched validator class (co-teaching = teacher *sets*; bi-weekly = per-week
 * placement), prove the class cannot return a false-positive "valid" verdict at the board path.
 * Each class is one `describe()` wrapping an `it.each(...)` table of full-oracle rows — literal
 * expected violations plus negative-parity (accepted) rows — asserted through the authoritative
 * committed-placement boundary `deriveCellViolations` (NOT `explainCell`), because that is the
 * contract that survives the S-03/S-04 internal rewrites (test-plan §1 principle #4).
 *
 * Oracle discipline: every expected value is anchored to requirements (FR-001/FR-012 for S-02;
 * FR-002/FR-003/US-03 for S-03), never recomputed from the validator under test. See the cookbook
 * convention in `context/foundation/test-plan.md` §6 ("Adding a new-validator-class parity fixture").
 *
 * Disambiguation — three same-stem files in this folder, distinct surfaces:
 *   - `collisions.test.ts`     — the general `deriveCellViolations` oracle (single-teacher cases).
 *   - `collision.test.ts`      — the `hasIntersection` pairwise primitive.
 *   - `collision-parity.test.ts` (this file) — the per-enriched-class false-positive guard.
 *
 * S-04 (cross-cohort) is implemented via the `occupiedByTeacher` parameter, and each row is now
 * asserted through BOTH boundaries — the committed `deriveCellViolations` verdict AND a
 * `deriveDropHints` what-if (drag the last-placed course back onto the cell) — so the board-only
 * drag mirrors (availability, cross-cohort) are genuinely guarded, not just the committed path.
 * S-06 (combined two-cohort) remains an `it.todo` placeholder marking the next guard gap.
 */
import { describe, expect, it } from "vitest";
import type { AvailabilityIndex } from "./availability-index";
import { cellKey, deriveCellViolations } from "./collisions";
import type { CollisionViolation } from "./constraints";
import type { CrossCohortIndex } from "./cross-cohort-index";
import { deriveDropHints } from "./drop-hints";
import type { DropHint } from "./drop-hints";
import type { GroupingCourse } from "./grouping";
import type { PlannerPlacement } from "./placement";
import { avail, biweekly, catalog, coTaught, course, occupiedBy, placement } from "./__fixtures__/builders";

/** The drag what-if's expected affordance — a `DropHint`, or `"free"` for an omitted (free) cell. */
type ExpectedDragHint = DropHint | "free";

type ParityCase = {
  name: string;
  placements: PlannerPlacement[];
  catalog: Map<string, GroupingCourse>;
  /** Teacher-availability rows only — built via `avail({ strong, soft })`. */
  availability?: AvailabilityIndex;
  /** Sibling-cohort occupancy (the cross-cohort axis) — built via `occupiedBy({ teacher: { cell: weeks } })`. */
  occupiedByTeacher?: CrossCohortIndex;
  cell: { day: number; period: number };
  expect:
    | { verdict: "invalid"; blockingIds: Set<string>; violations: CollisionViolation[] }
    | { verdict: "warn"; warningIds: Set<string>; violations: CollisionViolation[] } // soft, never blocking
    | { verdict: "valid" }; // no cell entry
  /**
   * The hint the LAST-placed course would draw if dragged onto `cell` (the others remaining). Pins
   * the committed↔drag agreement: `invalid`→`blocked`, opposite-week `valid`→`opposite-week`,
   * no-collision `valid`→`free`. The drag path is week-agnostic (week is chosen after drop), so a
   * bi-weekly member over a single-week sibling/occupant reads `opposite-week` even where the
   * committed (week-chosen) verdict is `invalid` — the two paths are pinned independently.
   */
  dragHint: ExpectedDragHint;
};

const CELL = { day: 1, period: 1 };

/** Assert each row through BOTH boundaries: the committed verdict and the drag what-if. */
const assertParity = (testCase: ParityCase): void => {
  assertCommitted(testCase);
  assertDrag(testCase);
};

/** The committed-placement verdict boundary (`deriveCellViolations`). */
const assertCommitted = (testCase: ParityCase): void => {
  const result = deriveCellViolations(
    testCase.placements,
    testCase.catalog,
    testCase.availability,
    testCase.occupiedByTeacher,
  );
  const key = cellKey(testCase.cell.day, testCase.cell.period);

  if (testCase.expect.verdict === "valid") {
    expect(result.has(key)).toBe(false);
    return;
  }

  const cell = result.get(key);
  if (!cell) throw new Error(`expected a violation cell at ${key}`);

  if (testCase.expect.verdict === "invalid") {
    expect(cell.blockingIds).toEqual(testCase.expect.blockingIds);
    expect(cell.violations).toEqual(testCase.expect.violations);
  } else {
    expect(cell.blockingIds).toEqual(new Set()); // soft NO is never blocking
    expect(cell.warningIds).toEqual(testCase.expect.warningIds);
    expect(cell.violations).toEqual(testCase.expect.violations);
  }
};

/**
 * The drag what-if boundary (`deriveDropHints`): lift the last-placed course off the board, then
 * classify dragging it back onto `cell` against the courses that remain. This is what genuinely
 * exercises the board-only drag mirrors (availability, cross-cohort) in `classifyCell`.
 */
const assertDrag = (testCase: ParityCase): void => {
  const dragged = testCase.placements.at(-1);
  if (!dragged) throw new Error("parity case has no placements to drag");
  const draggedCourse = testCase.catalog.get(dragged.courseId);
  if (!draggedCourse) throw new Error(`dragged course ${dragged.courseId} absent from the catalog`);

  const remaining = testCase.placements.slice(0, -1);
  const hints = deriveDropHints(
    { members: [draggedCourse] },
    remaining,
    testCase.catalog,
    testCase.availability,
    testCase.occupiedByTeacher,
  );
  const key = cellKey(testCase.cell.day, testCase.cell.period);
  expect(hints?.get(key) ?? "free").toBe(testCase.dragHint);
};

// S-02 co-teaching — teacher *set* overlap at the board path (FR-001/FR-012).
const S02_CASES: ParityCase[] = [
  {
    name: "invalid — two co-taught courses sharing exactly one teacher (new board-path coverage)",
    placements: [placement("p1", "A", 1, 1), placement("p2", "B", 1, 1)],
    catalog: catalog(coTaught("A", ["t1", "t2"]), coTaught("B", ["t2", "t3"])),
    cell: CELL,
    expect: {
      verdict: "invalid",
      blockingIds: new Set(["A", "B"]),
      violations: [{ kind: "teacher", teacherKey: "t2", courseIds: ["A", "B"] }],
    },
    dragHint: "blocked",
  },
  {
    name: "invalid — two co-taught courses sharing two teachers → two teacher violations (new)",
    placements: [placement("p1", "A", 1, 1), placement("p2", "B", 1, 1)],
    catalog: catalog(coTaught("A", ["t1", "t2"]), coTaught("B", ["t1", "t2"])),
    cell: CELL,
    expect: {
      verdict: "invalid",
      blockingIds: new Set(["A", "B"]),
      violations: [
        { kind: "teacher", teacherKey: "t1", courseIds: ["A", "B"] },
        { kind: "teacher", teacherKey: "t2", courseIds: ["A", "B"] },
      ],
    },
    dragHint: "blocked",
  },
  {
    name: "invalid — mixed cardinality: scalar {t1} + co-taught {t1,t2} (new)",
    placements: [placement("p1", "A", 1, 1), placement("p2", "B", 1, 1)],
    catalog: catalog(course("A", "t1"), coTaught("B", ["t1", "t2"])),
    cell: CELL,
    expect: {
      verdict: "invalid",
      blockingIds: new Set(["A", "B"]),
      violations: [{ kind: "teacher", teacherKey: "t1", courseIds: ["A", "B"] }],
    },
    dragHint: "blocked",
  },
  {
    name: "invalid — co-taught {t1,t2}, t2 strong-unavailable at the cell",
    placements: [placement("p1", "A", 1, 1)],
    catalog: catalog(coTaught("A", ["t1", "t2"])),
    availability: avail({ strong: { t2: ["1:1"] } }),
    cell: CELL,
    expect: {
      verdict: "invalid",
      blockingIds: new Set(["A"]),
      violations: [{ kind: "teacher-unavailable", teacherKey: "t2", courseIds: ["A"], severity: "block" }],
    },
    dragHint: "blocked",
  },
  {
    name: "invalid — co-taught {t1,t2}, both strong-unavailable → two teacher-unavailable",
    placements: [placement("p1", "A", 1, 1)],
    catalog: catalog(coTaught("A", ["t1", "t2"])),
    availability: avail({ strong: { t1: ["1:1"], t2: ["1:1"] } }),
    cell: CELL,
    expect: {
      verdict: "invalid",
      blockingIds: new Set(["A"]),
      violations: [
        { kind: "teacher-unavailable", teacherKey: "t1", courseIds: ["A"], severity: "block" },
        { kind: "teacher-unavailable", teacherKey: "t2", courseIds: ["A"], severity: "block" },
      ],
    },
    dragHint: "blocked",
  },
  {
    name: "warn — co-taught {t1,t2}, t2 soft-unavailable → warn only, never blocking (new)",
    placements: [placement("p1", "A", 1, 1)],
    catalog: catalog(coTaught("A", ["t1", "t2"])),
    availability: avail({ soft: { t2: ["1:1"] } }),
    cell: CELL,
    expect: {
      verdict: "warn",
      warningIds: new Set(["A"]),
      violations: [{ kind: "teacher-unavailable", teacherKey: "t2", courseIds: ["A"], severity: "warn" }],
    },
    dragHint: "warn",
  },
  {
    name: "valid — co-taught courses with disjoint teacher sets, no shared students",
    placements: [placement("p1", "A", 1, 1), placement("p2", "B", 1, 1)],
    catalog: catalog(coTaught("A", ["t1", "t2"]), coTaught("B", ["t3", "t4"])),
    cell: CELL,
    expect: { verdict: "valid" },
    dragHint: "free",
  },
];

// S-03 bi-weekly — per-week placement relaxation at the board path (FR-002/FR-003/US-03).
const S03_CASES: ParityCase[] = [
  {
    name: "invalid — same-week (a/a) sharing a teacher",
    placements: [placement("p1", "A", 1, 1, "a"), placement("p2", "B", 1, 1, "a")],
    catalog: catalog(course("A", "t1"), course("B", "t1")),
    cell: CELL,
    expect: {
      verdict: "invalid",
      blockingIds: new Set(["A", "B"]),
      violations: [{ kind: "teacher", teacherKey: "t1", courseIds: ["A", "B"] }],
    },
    dragHint: "blocked",
  },
  {
    name: "invalid — same-week sharing students",
    placements: [placement("p1", "A", 1, 1, "a"), placement("p2", "B", 1, 1, "a")],
    catalog: catalog(course("A", null, ["s1"]), course("B", null, ["s1"])),
    cell: CELL,
    expect: {
      verdict: "invalid",
      blockingIds: new Set(["A", "B"]),
      violations: [{ kind: "student", studentKeys: ["s1"], courseIds: ["A", "B"] }],
    },
    dragHint: "blocked",
  },
  {
    name: "invalid — agnostic (both) + single-week (a) sharing a teacher",
    placements: [placement("p1", "A", 1, 1, "both"), placement("p2", "B", 1, 1, "a")],
    catalog: catalog(course("A", "t1"), course("B", "t1")),
    cell: CELL,
    expect: {
      verdict: "invalid",
      blockingIds: new Set(["A", "B"]),
      violations: [{ kind: "teacher", teacherKey: "t1", courseIds: ["A", "B"] }],
    },
    dragHint: "blocked",
  },
  {
    name: "invalid — untagged placement (defaults to both) + single-week (a) still collide (new)",
    placements: [placement("p1", "A", 1, 1), placement("p2", "B", 1, 1, "a")],
    catalog: catalog(course("A", "t1"), course("B", "t1")),
    cell: CELL,
    expect: {
      verdict: "invalid",
      blockingIds: new Set(["A", "B"]),
      violations: [{ kind: "teacher", teacherKey: "t1", courseIds: ["A", "B"] }],
    },
    dragHint: "blocked",
  },
  {
    name: "invalid — {both, a, b} three courses sharing a teacher cite all three",
    placements: [placement("p1", "A", 1, 1, "both"), placement("p2", "B", 1, 1, "a"), placement("p3", "C", 1, 1, "b")],
    catalog: catalog(course("A", "t1"), course("B", "t1"), course("C", "t1")),
    cell: CELL,
    expect: {
      verdict: "invalid",
      blockingIds: new Set(["A", "B", "C"]),
      violations: [{ kind: "teacher", teacherKey: "t1", courseIds: ["A", "B", "C"] }],
    },
    // Dragging the week-b C onto {both A, week-a B}: the agnostic A overlaps every week → hard.
    dragHint: "blocked",
  },
  {
    name: "valid — opposite-week (a/b) sharing a teacher AND students (core over-rejection guard)",
    placements: [placement("p1", "A", 1, 1, "a"), placement("p2", "B", 1, 1, "b")],
    // Bi-weekly: opposite-week placements only arise for bi-weekly courses, so the drag path can
    // offer the opposite-week affordance (the pre-drop mirror of the committed valid verdict).
    catalog: catalog(biweekly("A", "t1", ["s1"]), biweekly("B", "t1", ["s1"])),
    cell: CELL,
    expect: { verdict: "valid" },
    dragHint: "opposite-week",
  },
  {
    name: "valid — opposite-week sharing students only",
    placements: [placement("p1", "A", 1, 1, "a"), placement("p2", "B", 1, 1, "b")],
    catalog: catalog(biweekly("A", null, ["s1"]), biweekly("B", null, ["s1"])),
    cell: CELL,
    expect: { verdict: "valid" },
    dragHint: "opposite-week",
  },
];

describe("co-teaching (S-02) parity", () => {
  it.each(S02_CASES)("$name", assertParity);
});

describe("bi-weekly (S-03) parity", () => {
  it.each(S03_CASES)("$name", assertParity);
});

// S-04 cross-cohort — a teacher occupied in the OTHER cohort at this cell, week-aware (FR-006).
// `occupiedByTeacher` is the sibling-cohort projection; the committed path flags a blocking
// `cross-cohort-teacher` violation, the drag path mirrors it (week-agnostic, pre-drop).
const S04_CASES: ParityCase[] = [
  {
    // Symmetric by construction: the rule reads `occupiedByTeacher` with no notion of a "primary"
    // cohort, so place-in-dp1-sees-dp2 and place-in-dp2-sees-dp1 are the same code path. The
    // committed verdict blocks (week a == sibling week a); the drag path, not yet knowing the week,
    // offers the bi-weekly opposite-week escape.
    name: "invalid — symmetric same-week cross-cohort occupancy blocks in both directions",
    placements: [placement("p1", "A", 1, 1, "a")],
    catalog: catalog(biweekly("A", "t1")),
    occupiedByTeacher: occupiedBy({ t1: { "1:1": ["a"] } }),
    cell: CELL,
    expect: {
      verdict: "invalid",
      blockingIds: new Set(["A"]),
      violations: [{ kind: "cross-cohort-teacher", teacherKey: "t1", courseIds: ["A"] }],
    },
    dragHint: "opposite-week",
  },
  {
    name: "valid — opposite-week cross-cohort occupancy is accepted",
    placements: [placement("p1", "A", 1, 1, "b")],
    catalog: catalog(biweekly("A", "t1")),
    occupiedByTeacher: occupiedBy({ t1: { "1:1": ["a"] } }),
    cell: CELL,
    expect: { verdict: "valid" },
    dragHint: "opposite-week",
  },
  {
    name: "invalid — an agnostic (both) cross-cohort occupant overlaps every week",
    placements: [placement("p1", "A", 1, 1, "a")],
    catalog: catalog(biweekly("A", "t1")),
    occupiedByTeacher: occupiedBy({ t1: { "1:1": ["both"] } }),
    cell: CELL,
    expect: {
      verdict: "invalid",
      blockingIds: new Set(["A"]),
      violations: [{ kind: "cross-cohort-teacher", teacherKey: "t1", courseIds: ["A"] }],
    },
    // A `both` sibling overlaps every week — unescapable even for a bi-weekly member → blocked.
    dragHint: "blocked",
  },
  {
    name: "valid — cross-cohort occupancy in a different slot does not collide",
    placements: [placement("p1", "A", 1, 1)],
    catalog: catalog(course("A", "t1")),
    occupiedByTeacher: occupiedBy({ t1: { "2:2": ["both"] } }),
    cell: CELL,
    expect: { verdict: "valid" },
    dragHint: "free",
  },
  {
    // Param off (no `occupiedByTeacher`): the same A/week-a that case 1 blocked is now valid —
    // the single-cohort regression path is untouched.
    name: "valid — single-cohort regression: cross-cohort param off behaves as today",
    placements: [placement("p1", "A", 1, 1, "a")],
    catalog: catalog(biweekly("A", "t1")),
    cell: CELL,
    expect: { verdict: "valid" },
    dragHint: "free",
  },
  {
    // Two orthogonal axes in one cell: availability flags B (t2 strong-unavailable), cross-cohort
    // flags A (t1 busy in the sibling) — neither leaks into the other. A is placed last, so the
    // drag what-if exercises the cross-cohort mirror.
    name: "availability is orthogonal to the cross-cohort axis",
    placements: [placement("p1", "B", 1, 1), placement("p2", "A", 1, 1)],
    catalog: catalog(course("A", "t1"), course("B", "t2")),
    availability: avail({ strong: { t2: ["1:1"] } }),
    occupiedByTeacher: occupiedBy({ t1: { "1:1": ["both"] } }),
    cell: CELL,
    expect: {
      verdict: "invalid",
      blockingIds: new Set(["A", "B"]),
      violations: [
        { kind: "teacher-unavailable", teacherKey: "t2", courseIds: ["B"], severity: "block" },
        { kind: "cross-cohort-teacher", teacherKey: "t1", courseIds: ["A"] },
      ],
    },
    dragHint: "blocked",
  },
];

describe("cross-cohort (S-04) parity", () => {
  it.each(S04_CASES)("$name", assertParity);
});

// S-06 combined two-cohort — co-teaching (teacher SET) × bi-weekly (per-week) × cross-cohort
// (sibling occupancy) interacting in ONE cell, proving none of the three enriched axes returns a
// false-positive "valid" when combined. The harness is cohort-symmetric by construction:
// `occupiedByTeacher` is "the other cohort's occupancy" with no notion of a primary cohort, so a
// clash on either co-teacher (cases 1 vs 4) is the same code path in both directions (DP1↔DP2).
// Each row asserts through BOTH boundaries — committed `deriveCellViolations` and the `deriveDropHints`
// what-if (FR-001/FR-002/FR-006, US-01).
const coTaughtBiweekly = (id: string, teacherKeys: string[]): GroupingCourse => ({
  ...coTaught(id, teacherKeys),
  weekMode: "biweekly",
});

const S06_CASES: ParityCase[] = [
  {
    name: "invalid — co-taught bi-weekly, a co-teacher busy same-week in the sibling cohort → blocked",
    placements: [placement("p1", "A", 1, 1, "a")],
    catalog: catalog(coTaughtBiweekly("A", ["t1", "t2"])),
    occupiedByTeacher: occupiedBy({ t2: { "1:1": ["a"] } }),
    cell: CELL,
    expect: {
      verdict: "invalid",
      blockingIds: new Set(["A"]),
      violations: [{ kind: "cross-cohort-teacher", teacherKey: "t2", courseIds: ["A"] }],
    },
    // The bi-weekly member can still escape to the sibling's free week → pre-drop opposite-week.
    dragHint: "opposite-week",
  },
  {
    name: "valid — co-taught bi-weekly placed opposite the sibling co-teacher's week is accepted (over-rejection guard)",
    placements: [placement("p1", "A", 1, 1, "b")],
    catalog: catalog(coTaughtBiweekly("A", ["t1", "t2"])),
    occupiedByTeacher: occupiedBy({ t2: { "1:1": ["a"] } }),
    cell: CELL,
    expect: { verdict: "valid" },
    dragHint: "opposite-week",
  },
  {
    name: "invalid — co-taught WEEKLY course runs every week, so a fortnightly sibling co-teacher still clashes → blocked",
    placements: [placement("p1", "A", 1, 1, "both")],
    catalog: catalog(coTaught("A", ["t1", "t2"])), // agnostic = weekly
    occupiedByTeacher: occupiedBy({ t2: { "1:1": ["a"] } }),
    cell: CELL,
    expect: {
      verdict: "invalid",
      blockingIds: new Set(["A"]),
      violations: [{ kind: "cross-cohort-teacher", teacherKey: "t2", courseIds: ["A"] }],
    },
    // A weekly (agnostic) member has no opposite-week escape — it runs every week → hard block.
    dragHint: "blocked",
  },
  {
    name: "invalid — set membership × cross-cohort: the OTHER co-teacher (t1) busy same-week in the sibling → blocked",
    placements: [placement("p1", "A", 1, 1, "a")],
    catalog: catalog(coTaughtBiweekly("A", ["t1", "t2"])),
    occupiedByTeacher: occupiedBy({ t1: { "1:1": ["a"] } }),
    cell: CELL,
    expect: {
      verdict: "invalid",
      blockingIds: new Set(["A"]),
      violations: [{ kind: "cross-cohort-teacher", teacherKey: "t1", courseIds: ["A"] }],
    },
    dragHint: "opposite-week",
  },
];

describe("combined two-cohort (S-06) parity", () => {
  it.each(S06_CASES)("$name", assertParity);
});
