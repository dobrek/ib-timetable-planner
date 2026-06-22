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
 * S-04 (cross-cohort) and S-06 (combined two-cohort) are `it.todo` placeholders: they cannot be
 * expressed through `deriveCellViolations` until it gains a cross-cohort occupancy parameter (the
 * S-04 slice). Keeping them visible here marks the pending guard gaps.
 */
import { describe, expect, it } from "vitest";
import type { AvailabilityIndex } from "./availability-index";
import { cellKey, deriveCellViolations } from "./collisions";
import type { CollisionViolation } from "./constraints";
import type { GroupingCourse } from "./grouping";
import type { PlannerPlacement } from "./placement";
import { avail, catalog, coTaught, course, placement } from "./__fixtures__/builders";

type ParityCase = {
  name: string;
  placements: PlannerPlacement[];
  catalog: Map<string, GroupingCourse>;
  /** Teacher-availability rows only — built via `avail({ strong, soft })`. */
  availability?: AvailabilityIndex;
  cell: { day: number; period: number };
  expect:
    | { verdict: "invalid"; blockingIds: Set<string>; violations: CollisionViolation[] }
    | { verdict: "warn"; warningIds: Set<string>; violations: CollisionViolation[] } // soft, never blocking
    | { verdict: "valid" }; // no cell entry
};

const CELL = { day: 1, period: 1 };

/** One assertion per row through the committed-placement verdict boundary. */
const assertParity = (testCase: ParityCase): void => {
  const result = deriveCellViolations(testCase.placements, testCase.catalog, testCase.availability);
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
  },
  {
    name: "valid — co-taught courses with disjoint teacher sets, no shared students",
    placements: [placement("p1", "A", 1, 1), placement("p2", "B", 1, 1)],
    catalog: catalog(coTaught("A", ["t1", "t2"]), coTaught("B", ["t3", "t4"])),
    cell: CELL,
    expect: { verdict: "valid" },
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
  },
  {
    name: "valid — opposite-week (a/b) sharing a teacher AND students (core over-rejection guard)",
    placements: [placement("p1", "A", 1, 1, "a"), placement("p2", "B", 1, 1, "b")],
    catalog: catalog(course("A", "t1", ["s1"]), course("B", "t1", ["s1"])),
    cell: CELL,
    expect: { verdict: "valid" },
  },
  {
    name: "valid — opposite-week sharing students only",
    placements: [placement("p1", "A", 1, 1, "a"), placement("p2", "B", 1, 1, "b")],
    catalog: catalog(course("A", null, ["s1"]), course("B", null, ["s1"])),
    cell: CELL,
    expect: { verdict: "valid" },
  },
];

describe("co-teaching (S-02) parity", () => {
  it.each(S02_CASES)("$name", assertParity);
});

describe("bi-weekly (S-03) parity", () => {
  it.each(S03_CASES)("$name", assertParity);
});

// Pending enriched classes — `deriveCellViolations` has no cross-cohort occupancy parameter yet,
// so these cannot be expressed through the boundary until the S-04 slice adds it. Listed as `it.todo`
// to keep the pending guard gaps visible in the harness surface (they render as pending, not failures).
describe("cross-cohort (S-04) parity", () => {
  it.todo("invalid — symmetric same-week cross-cohort occupancy blocks in both directions");
  it.todo("valid — opposite-week cross-cohort occupancy is accepted");
  it.todo("invalid — an agnostic (both) cross-cohort occupant overlaps every week");
  it.todo("valid — cross-cohort occupancy in a different slot does not collide");
  it.todo("valid — single-cohort regression: cross-cohort param off behaves as today");
  it.todo("availability is orthogonal to the cross-cohort axis");
});

describe("combined two-cohort (S-06) parity", () => {
  it.todo("invalid — co-teaching + bi-weekly + cross-cohort interact without false-positive valid");
});
