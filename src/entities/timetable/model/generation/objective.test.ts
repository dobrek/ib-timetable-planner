import { describe, expect, it } from "vitest";
import type { PlacementWeek } from "@/shared/config";
import { course } from "../__fixtures__/builders";
import { compareObjectives, countInteriorHoles, countStudentHoles, type Objective } from "./objective";

const obj = (unplaced: number, holes: number, slots: number, studentHoles: number): Objective => [
  unplaced,
  holes,
  slots,
  studentHoles,
];

/** A placed course-hour row (the shape `countStudentHoles` scores over). */
const row = (courseId: string, day: number, period: number, week: PlacementWeek = "both") => ({
  courseId,
  day,
  period,
  week,
});

describe("compareObjectives", () => {
  it("lets one fewer slot win despite a large studentHoles disadvantage (the scalar's bug)", () => {
    // Scalar score: 49*100 + 500 = 5400 vs 50*100 + 0 = 5000 — the scalar wrongly preferred the
    // 50-slot board. The tuple compares the slot tier before compactness, so 49 slots wins.
    expect(compareObjectives(obj(0, 0, 49, 500), obj(0, 0, 50, 0))).toBeLessThan(0);
  });

  it("ranks completeness above every other tier", () => {
    expect(compareObjectives(obj(1, 0, 0, 0), obj(0, 99, 99, 99))).toBeGreaterThan(0);
  });

  it("ranks interior holes above slot count", () => {
    expect(compareObjectives(obj(0, 1, 10, 0), obj(0, 2, 5, 0))).toBeLessThan(0);
  });

  it("returns 0 for identical tuples", () => {
    expect(compareObjectives(obj(0, 1, 2, 3), obj(0, 1, 2, 3))).toBe(0);
  });
});

describe("countInteriorHoles (tier 2)", () => {
  it("counts free periods inside a day's used span", () => {
    // Day 1 uses periods 1 and 3 — period 2 is an interior hole.
    expect(countInteriorHoles([row("c", 1, 1), row("c", 1, 3)], 1)).toBe(1);
  });

  it("counts holes per day independently", () => {
    // Day 1: hole at p2; day 2: holes at p3 and p4 (span 2..5, used {2,5}).
    const rows = [row("c", 1, 1), row("c", 1, 3), row("d", 2, 2), row("d", 2, 5)];
    expect(countInteriorHoles(rows, 2)).toBe(3);
  });

  it("returns 0 for a single occupied cell (span of one) and for empty days", () => {
    expect(countInteriorHoles([row("c", 1, 2)], 3)).toBe(0);
    expect(countInteriorHoles([], 3)).toBe(0);
  });

  it("ignores days beyond a contiguous span (no interior gap)", () => {
    expect(countInteriorHoles([row("c", 1, 1), row("c", 1, 2), row("c", 1, 3)], 1)).toBe(0);
  });
});

describe("countStudentHoles (tier 4)", () => {
  const shared = (...students: string[]) => course("x", "t", students);

  it("expands a `both`-week row into both concrete lanes and counts each", () => {
    // c1@p1 and c2@p3 share s1, both agnostic (`both`) → lanes s1|1|a and s1|1|b each hold {1,3},
    // one interior hole apiece → 2 total (proves `both` fans out to both weeks).
    const courses = [course("c1", "t1", ["s1"]), course("c2", "t2", ["s1"])];
    expect(countStudentHoles(courses, [row("c1", 1, 1), row("c2", 1, 3)])).toBe(2);
  });

  it("scores a biweekly (single-week) lane once", () => {
    // Same gap but concrete week "a" → only lane s1|1|a holds {1,3}; lane b is empty → 1 total.
    const courses = [course("c1", "t1", ["s1"]), course("c2", "t2", ["s1"])];
    expect(countStudentHoles(courses, [row("c1", 1, 1, "a"), row("c2", 1, 3, "a")])).toBe(1);
  });

  it("counts the gap once per enrolled student (multi-student rows)", () => {
    // Both hours carry s1 and s2 on week "a" → lanes s1|1|a and s2|1|a each hold {1,3} → 2 total.
    const courses = [course("c1", "t1", ["s1", "s2"]), course("c2", "t2", ["s1", "s2"])];
    expect(countStudentHoles(courses, [row("c1", 1, 1, "a"), row("c2", 1, 3, "a")])).toBe(2);
  });

  it("returns 0 when a student's day is contiguous", () => {
    const courses = [course("c1", "t1", ["s1"]), course("c2", "t2", ["s1"])];
    expect(countStudentHoles(courses, [row("c1", 1, 1), row("c2", 1, 2)])).toBe(0);
  });

  it("sums (span − occupancy) across independent student-day lanes", () => {
    // s1 on day 1 has {1,4} (span 4, 2 used → 2 holes); s1 on day 2 has {2,3} (contiguous → 0).
    const courses = [shared("s1")];
    const rows = [row("x", 1, 1, "a"), row("x", 1, 4, "a"), row("x", 2, 2, "a"), row("x", 2, 3, "a")];
    expect(countStudentHoles(courses, rows)).toBe(2);
  });
});
