import { describe, expect, it } from "vitest";
import type { PlacementWeek, WeekMode } from "@/shared/config";
import type { AvailabilityIndex } from "./availability-index";
import { cellKey } from "./collisions";
import type { CrossCohortIndex } from "./cross-cohort-index";
import { findDuplicateTarget } from "./duplicate-target";
import type { GroupingCourse } from "./grouping";
import type { PlannerPlacement } from "./placement";

const course = (
  id: string,
  teacher: string | null,
  studentKeys: string[],
  weekMode: WeekMode = "agnostic",
): GroupingCourse => ({
  id,
  teacherKeys: teacher === null ? [] : [teacher],
  studentKeys,
  hours: 4,
  weekMode,
});

const placement = (
  id: string,
  courseId: string,
  day: number,
  period: number,
  week: PlacementWeek = "both",
): PlannerPlacement => ({ id, courseId, day, period, week });

const catalog = (...courses: GroupingCourse[]): Map<string, GroupingCourse> => new Map(courses.map((c) => [c.id, c]));

// AvailabilityIndex from teacherKey → cellKey[] per severity (mirrors drop-hints.test.ts).
const toMap = (rec: Record<string, string[]>) =>
  new Map(Object.entries(rec).map(([teacher, keys]) => [teacher, new Set(keys)]));
const availability = (strong: Record<string, string[]>, soft: Record<string, string[]> = {}): AvailabilityIndex => ({
  strongUnavailableByTeacher: toMap(strong),
  softUnavailableByTeacher: toMap(soft),
});

// CrossCohortIndex from teacherKey → cellKey → weeks.
const crossCohort = (rec: Record<string, Record<string, PlacementWeek[]>>): CrossCohortIndex => {
  const index: CrossCohortIndex = new Map();
  for (const [teacher, byCell] of Object.entries(rec)) {
    const cells = new Map<string, Set<PlacementWeek>>();
    for (const [key, weeks] of Object.entries(byCell)) cells.set(key, new Set(weeks));
    index.set(teacher, cells);
  }
  return index;
};

describe("findDuplicateTarget", () => {
  it("anchors the scan after the source: next free period down the same day", () => {
    const a = course("A", "t1", ["s1"]);
    const target = findDuplicateTarget({
      source: { day: 1, period: 1 },
      members: [a],
      placements: [placement("p1", "A", 1, 1)],
      catalogById: catalog(a),
      days: 2,
      periods: 3,
    });
    // From (1,1) the next column-major cell is (1,2) — down the source's own day first.
    expect(target).toEqual({ day: 1, period: 2 });
  });

  it("crosses to the next day when the source is the last period of its day", () => {
    const a = course("A", "t1", ["s1"]);
    const target = findDuplicateTarget({
      source: { day: 1, period: 3 },
      members: [a],
      placements: [placement("p1", "A", 1, 3)],
      catalogById: catalog(a),
      days: 2,
      periods: 3,
    });
    expect(target).toEqual({ day: 2, period: 1 });
  });

  it("never lands before the source unless it wraps because everything after is full", () => {
    const a = course("A", "t1", ["s1"]);
    const b = course("B", "t2", ["s2"]);
    // Source at (1,2); (1,3) and all of day 2 are occupied (by a disjoint, non-conflicting course),
    // so the only empty cell after the source is none — the scan wraps to (1,1), before the source.
    const placements = [
      placement("p0", "A", 1, 2), // source
      placement("p3", "B", 1, 3),
      placement("p4", "B", 2, 1),
      placement("p5", "B", 2, 2),
      placement("p6", "B", 2, 3),
    ];
    const target = findDuplicateTarget({
      source: { day: 1, period: 2 },
      members: [a],
      placements,
      catalogById: catalog(a, b),
      days: 2,
      periods: 3,
    });
    expect(target).toEqual({ day: 1, period: 1 }); // wrapped to the earliest free slot
  });

  it("prefers a strictly-free cell over an earlier non-blocking (warn) cell anywhere in the rotation", () => {
    const a = course("A", "t1", ["s1"]);
    // From source (1,1): (1,2) is soft-unavailable (warn), (1,3) is strictly free.
    const target = findDuplicateTarget({
      source: { day: 1, period: 1 },
      members: [a],
      placements: [placement("p1", "A", 1, 1)],
      catalogById: catalog(a),
      availability: availability({}, { t1: [cellKey(1, 2)] }),
      days: 1,
      periods: 3,
    });
    expect(target).toEqual({ day: 1, period: 3 });
  });

  it("falls back to a non-blocking (warn) cell when no strictly-free cell exists", () => {
    const a = course("A", "t1", ["s1"]);
    // (1,2) soft-unavailable → warn; (1,3) strong-unavailable → blocked (skipped).
    const target = findDuplicateTarget({
      source: { day: 1, period: 1 },
      members: [a],
      placements: [placement("p1", "A", 1, 1)],
      catalogById: catalog(a),
      availability: availability({ t1: [cellKey(1, 3)] }, { t1: [cellKey(1, 2)] }),
      days: 1,
      periods: 3,
    });
    expect(target).toEqual({ day: 1, period: 2 });
  });

  it("skips an empty cell where a member's teacher is strong-unavailable (blocked)", () => {
    const a = course("A", "t1", ["s1"]);
    // (1,2) blocked by strong-unavailability → skip to (1,3).
    const target = findDuplicateTarget({
      source: { day: 1, period: 1 },
      members: [a],
      placements: [placement("p1", "A", 1, 1)],
      catalogById: catalog(a),
      availability: availability({ t1: [cellKey(1, 2)] }),
      days: 1,
      periods: 3,
    });
    expect(target).toEqual({ day: 1, period: 3 });
  });

  it("skips an empty cell where a member's teacher is occupied in the sibling cohort (cross-cohort blocked)", () => {
    const a = course("A", "t1", ["s1"]);
    // t1 is occupied `both` weeks at (1,2) in the other cohort → hard cross-cohort conflict → blocked.
    const target = findDuplicateTarget({
      source: { day: 1, period: 1 },
      members: [a],
      placements: [placement("p1", "A", 1, 1)],
      catalogById: catalog(a),
      occupiedByTeacher: crossCohort({ t1: { [cellKey(1, 2)]: ["both"] } }),
      days: 1,
      periods: 3,
    });
    expect(target).toEqual({ day: 1, period: 3 });
  });

  it("skips a 'partial' empty cell (only some members fit)", () => {
    const a = course("A", "t1", ["s1"]);
    const b = course("B", "t2", ["s2"]);
    // (1,2): A's teacher strong-unavailable but B fits → partial → skipped; (1,3) free for both.
    const target = findDuplicateTarget({
      source: { day: 1, period: 1 },
      members: [a, b],
      placements: [placement("p1", "A", 1, 1), placement("p2", "B", 1, 1)],
      catalogById: catalog(a, b),
      availability: availability({ t1: [cellKey(1, 2)] }),
      days: 1,
      periods: 3,
    });
    expect(target).toEqual({ day: 1, period: 3 });
  });

  it("never returns the source cell — the copy context keeps it occupied (not a move)", () => {
    const a = course("A", "t1", ["s1"]);
    const x = course("X", "t1", ["s9"]); // shares teacher t1 → blocks A
    // Only two cells: source (1,1) and (1,2). (1,2) is blocked for A. A move would lift the source
    // off and could pick (1,1); a copy keeps it occupied → no legal empty cell → undefined.
    const target = findDuplicateTarget({
      source: { day: 1, period: 1 },
      members: [a],
      placements: [placement("p1", "A", 1, 1), placement("p2", "X", 1, 2)],
      catalogById: catalog(a, x),
      days: 1,
      periods: 2,
    });
    expect(target).toBeUndefined();
  });

  it("returns undefined when the grid is full (no empty cell)", () => {
    const a = course("A", "t1", ["s1"]);
    const b = course("B", "t2", ["s2"]);
    const target = findDuplicateTarget({
      source: { day: 1, period: 1 },
      members: [a],
      placements: [placement("p1", "A", 1, 1), placement("p2", "B", 1, 2)],
      catalogById: catalog(a, b),
      days: 1,
      periods: 2,
    });
    expect(target).toBeUndefined();
  });

  it("wraps to reach the earliest free slot when only a pre-source cell is free", () => {
    const a = course("A", "t1", ["s1"]);
    const b = course("B", "t2", ["s2"]);
    // 2×2 grid. Source (2,1); after it column-major is (2,2) [occupied], then wrap (1,1) [free].
    const target = findDuplicateTarget({
      source: { day: 2, period: 1 },
      members: [a],
      placements: [placement("p0", "A", 2, 1), placement("p2", "B", 2, 2)],
      catalogById: catalog(a, b),
      days: 2,
      periods: 2,
    });
    expect(target).toEqual({ day: 1, period: 1 });
  });
});
