import { describe, expect, it } from "vitest";
import { coTaught, course, placement, type HoursStat } from "@/entities/timetable";
import { buildTeacherCourseItems } from "./course-list";

const hoursOf = (entries: Record<string, HoursStat>): Map<string, HoursStat> => new Map(Object.entries(entries));

describe("buildTeacherCourseItems", () => {
  it("keeps only the teacher's courses and sorts occurrences by day, then period", () => {
    const items = buildTeacherCourseItems({
      cohort: "dp1",
      courses: [course("c1", "T1", ["s1", "s2"]), course("c2", "T2")],
      placements: [
        placement("p-late", "c1", 2, 1),
        placement("p-mid", "c1", 1, 3),
        placement("p-early", "c1", 1, 1),
        placement("p-other", "c2", 1, 1),
      ],
      merges: [],
      hours: hoursOf({ c1: { placed: 3, required: 4 } }),
      teacherKey: "T1",
    });

    expect(items).toHaveLength(1);
    expect(items[0].courseId).toBe("c1");
    expect(items[0].occurrences.map((occurrence) => occurrence.id)).toEqual(["p-early", "p-mid", "p-late"]);
    expect(items[0].hours).toEqual({ placed: 3, required: 4 });
    expect(items[0].studentKeys).toEqual(["s1", "s2"]);
    expect(items[0].mergedIntoId).toBeUndefined();
  });

  it("excludes the current teacher from coTeacherKeys", () => {
    const items = buildTeacherCourseItems({
      cohort: "dp1",
      courses: [coTaught("c1", ["T1", "T2", "T3"])],
      placements: [],
      merges: [],
      hours: new Map(),
      teacherKey: "T1",
    });

    expect(items[0].coTeacherKeys).toEqual(["T2", "T3"]);
    expect(items[0].hours).toBeNull();
  });

  describe("merge composites", () => {
    it("resolves a merge parent to child rows scheduled by the parent's placements", () => {
      const items = buildTeacherCourseItems({
        cohort: "dp1",
        // child-b has no direct choices, so it sits outside the grouping catalog.
        courses: [course("parent", "T1"), course("child-a", "T1", ["s1"])],
        placements: [placement("pp", "parent", 1, 2)],
        merges: [
          { parentId: "parent", childId: "child-a" },
          { parentId: "parent", childId: "child-b" },
        ],
        hours: hoursOf({ parent: { placed: 1, required: 4 }, "child-a": { placed: 1, required: 2 } }),
        teacherKey: "T1",
      });

      expect(items.map((item) => item.courseId).sort()).toEqual(["child-a", "child-b"]);

      const childA = items.find((item) => item.courseId === "child-a");
      expect(childA?.occurrences.map((occurrence) => occurrence.id)).toEqual(["pp"]);
      expect(childA?.hours).toEqual({ placed: 1, required: 2 });
      expect(childA?.studentKeys).toEqual(["s1"]);
      expect(childA?.mergedIntoId).toBe("parent");

      const childB = items.find((item) => item.courseId === "child-b");
      expect(childB?.occurrences.map((occurrence) => occurrence.id)).toEqual(["pp"]);
      // Absent from the catalog: empty roster, hours fall back to the parent's stat.
      expect(childB?.studentKeys).toEqual([]);
      expect(childB?.hours).toEqual({ placed: 1, required: 4 });
      expect(childB?.mergedIntoId).toBe("parent");
    });

    it("unions a partially-merged child's own placements with the parent's, sorted", () => {
      const items = buildTeacherCourseItems({
        cohort: "dp1",
        courses: [course("parent", "T1"), course("child-a", "T1", ["s1"])],
        placements: [placement("pp", "parent", 2, 1), placement("pc", "child-a", 1, 1)],
        merges: [{ parentId: "parent", childId: "child-a" }],
        hours: new Map(),
        teacherKey: "T1",
      });

      expect(items).toHaveLength(1);
      expect(items[0].occurrences.map((occurrence) => occurrence.id)).toEqual(["pc", "pp"]);
    });

    it("ignores merges whose parent is not the teacher's course", () => {
      const items = buildTeacherCourseItems({
        cohort: "dp1",
        courses: [course("c1", "T1")],
        placements: [],
        merges: [{ parentId: "foreign-parent", childId: "c1" }],
        hours: new Map(),
        teacherKey: "T1",
      });

      expect(items.map((item) => item.courseId)).toEqual(["c1"]);
      expect(items[0].mergedIntoId).toBeUndefined();
    });
  });
});
