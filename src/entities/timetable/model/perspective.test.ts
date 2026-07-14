import { describe, expect, it } from "vitest";
import { avail, catalog, coTaught, course, placement } from "./__fixtures__/builders";
import { cellKey } from "./collision/cell-key";
import { deriveCellViolations, type CellCollisions } from "./collision/collisions";
import {
  narrowViolationsToTeacher,
  perspectivePlacements,
  studentCourses,
  teacherCourses,
  teacherUnavailableCells,
} from "./perspective";

describe("teacherCourses", () => {
  it("keeps only courses whose teacher set contains the key", () => {
    const mine = course("c1", "T1");
    const other = course("c2", "T2");
    expect(teacherCourses([mine, other], "T1")).toEqual([mine]);
  });

  it("returns a co-taught course for every member of its teacher set", () => {
    const shared = coTaught("c1", ["T1", "T2"]);
    expect(teacherCourses([shared], "T1")).toEqual([shared]);
    expect(teacherCourses([shared], "T2")).toEqual([shared]);
    expect(teacherCourses([shared], "T3")).toEqual([]);
  });

  it("returns every member of a merge composite (identical teacher sets)", () => {
    const parent = coTaught("merged", ["T1", "T2"]);
    const childA = coTaught("child-a", ["T1", "T2"]);
    const childB = coTaught("child-b", ["T1", "T2"]);
    expect(teacherCourses([parent, childA, childB], "T1")).toEqual([parent, childA, childB]);
  });
});

describe("studentCourses", () => {
  it("keeps only courses whose student set contains the key", () => {
    const mine = course("c1", "T1", ["s1", "s2"]);
    const other = course("c2", "T1", ["s3"]);
    expect(studentCourses([mine, other], "s1")).toEqual([mine]);
    expect(studentCourses([mine, other], "s3")).toEqual([other]);
    expect(studentCourses([mine, other], "s9")).toEqual([]);
  });
});

describe("perspectivePlacements", () => {
  it("keeps only placements of the person's courses", () => {
    const mine = placement("p1", "c1", 1, 1);
    const other = placement("p2", "c2", 2, 3);
    expect(perspectivePlacements([mine, other], new Set(["c1"]))).toEqual([mine]);
  });
});

describe("narrowViolationsToTeacher", () => {
  it("keeps a student-overlap violation involving the teacher's course and preserves severity sets", () => {
    const mine = course("c1", "T1", ["s1"]);
    const other = course("c2", "T2", ["s1"]);
    const violations = deriveCellViolations(
      [placement("p1", "c1", 1, 1), placement("p2", "c2", 1, 1)],
      catalog(mine, other),
    );

    const narrowed = narrowViolationsToTeacher(violations, "T1", new Set(["c1"]));
    const cell = getCell(narrowed, cellKey(1, 1));
    expect(cell.violations).toEqual([{ kind: "student", studentKeys: ["s1"], courseIds: ["c1", "c2"] }]);
    expect(cell.blockingIds).toEqual(new Set(["c1", "c2"]));
    expect(cell.warningIds).toEqual(new Set());
  });

  it("drops violations not involving the teacher, and drops cells left empty", () => {
    const a = course("a", "T2", ["s1"]);
    const b = course("b", "T3", ["s1"]);
    const violations = deriveCellViolations([placement("p1", "a", 2, 4), placement("p2", "b", 2, 4)], catalog(a, b));
    expect(violations.size).toBe(1);

    const narrowed = narrowViolationsToTeacher(violations, "T1", new Set(["mine"]));
    expect(narrowed.size).toBe(0);
  });

  it("keeps violations naming the teacherKey even when its courses are not in the teacher set", () => {
    // Cross-cohort teacher conflicts cite the teacher directly; the sibling-cohort course
    // ids are not in this cohort's teacher course set.
    const here = course("c1", "T1");
    const violations = deriveCellViolations(
      [placement("p1", "c1", 3, 2)],
      catalog(here),
      avail({ strong: { T1: [cellKey(3, 2)] } }),
    );

    const narrowed = narrowViolationsToTeacher(violations, "T1", new Set());
    const cell = getCell(narrowed, cellKey(3, 2));
    expect(cell.violations).toEqual([
      { kind: "teacher-unavailable", teacherKey: "T1", courseIds: ["c1"], severity: "block" },
    ]);
    expect(cell.unavailableIds).toEqual(new Set(["c1"]));
  });

  it("keeps an early-finish-edge violation for the flagged course's teacher (courseIds narrowing)", () => {
    const flagged = course("F", "T1", ["s1"]);
    const x = course("X", "T2", ["s1"]);
    const y = course("Y", "T3", ["s1"]);
    const violations = deriveCellViolations(
      [placement("pf", "F", 1, 3), placement("px", "X", 1, 1), placement("py", "Y", 1, 5)],
      catalog(flagged, x, y),
      undefined,
      undefined,
      new Set(["F"]),
    );

    const narrowed = narrowViolationsToTeacher(violations, "T1", new Set(["F"]));
    const cell = getCell(narrowed, cellKey(1, 3));
    expect(cell.violations).toEqual([{ kind: "early-finish-edge", courseIds: ["F"], studentKeys: ["s1"] }]);
    expect(cell.blockingIds).toEqual(new Set(["F"]));
  });

  it("keeps a course-day-stacking warn for the stacked course's teacher", () => {
    const c = course("C", "T1", ["s1"]);
    const violations = deriveCellViolations(
      [placement("p1", "C", 1, 1), placement("p2", "C", 1, 2), placement("p3", "C", 1, 3)],
      catalog(c),
    );

    const narrowed = narrowViolationsToTeacher(violations, "T1", new Set(["C"]));
    const cell = getCell(narrowed, cellKey(1, 1));
    expect(cell.violations).toEqual([{ kind: "course-day-stacking", courseIds: ["C"], count: 3, lanes: ["a", "b"] }]);
    expect(cell.warningIds).toEqual(new Set(["C"]));
    expect(cell.blockingIds).toEqual(new Set());
  });

  it("rebuilds warn semantics for soft teacher-unavailable violations", () => {
    const mine = course("c1", "T1");
    const violations = deriveCellViolations(
      [placement("p1", "c1", 1, 2)],
      catalog(mine),
      avail({ soft: { T1: [cellKey(1, 2)] } }),
    );

    const narrowed = narrowViolationsToTeacher(violations, "T1", new Set(["c1"]));
    const cell = getCell(narrowed, cellKey(1, 2));
    expect(cell.blockingIds).toEqual(new Set());
    expect(cell.warningIds).toEqual(new Set(["c1"]));
    expect(cell.unavailableIds).toEqual(new Set(["c1"]));
  });

  it("produces nothing for week-disjoint biweekly sharers (derivation is week-aware upstream)", () => {
    const weekA = { ...course("c1", "T1", ["s1"]), weekMode: "biweekly" as const };
    const weekB = { ...course("c2", "T1", ["s1"]), weekMode: "biweekly" as const };
    const violations = deriveCellViolations(
      [placement("p1", "c1", 1, 1, "a"), placement("p2", "c2", 1, 1, "b")],
      catalog(weekA, weekB),
    );

    expect(narrowViolationsToTeacher(violations, "T1", new Set(["c1", "c2"])).size).toBe(0);
  });
});

describe("teacherUnavailableCells", () => {
  it("maps the teacher's blocked cells with their severity", () => {
    const index = avail({
      strong: { T1: [cellKey(1, 1)], T2: [cellKey(4, 4)] },
      soft: { T1: [cellKey(2, 3)] },
    });

    expect(teacherUnavailableCells(index, "T1")).toEqual(
      new Map([
        [cellKey(1, 1), "strong"],
        [cellKey(2, 3), "soft"],
      ]),
    );
  });

  it("lets strong win when both severities mark the same cell", () => {
    const index = avail({ strong: { T1: [cellKey(1, 1)] }, soft: { T1: [cellKey(1, 1)] } });
    expect(teacherUnavailableCells(index, "T1")).toEqual(new Map([[cellKey(1, 1), "strong"]]));
  });

  it("returns an empty map for a teacher with no availability rows", () => {
    expect(teacherUnavailableCells(avail({}), "T1")).toEqual(new Map());
  });
});

const getCell = (cells: Map<string, CellCollisions>, key: string): CellCollisions => {
  const cell = cells.get(key);
  if (!cell) throw new Error(`expected a narrowed cell at ${key}`);
  return cell;
};
