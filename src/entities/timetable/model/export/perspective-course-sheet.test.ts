import { describe, expect, it } from "vitest";
import { buildPerspectiveCourseSheet } from "./perspective-course-sheet";
import type { TimetableSheet } from "./sheet-types";
import type { PerspectiveCourseItem } from "../perspective-course-list";
import type { PlannerPlacement } from "../placement";

const placement = (courseId: string, day: number, period: number): PlannerPlacement => ({
  id: `${courseId}-${day}-${period}`,
  courseId,
  day,
  period,
  week: "both",
  isOptional: false,
});

const item = (over: Partial<PerspectiveCourseItem> = {}): PerspectiveCourseItem => ({
  courseId: "math",
  cohort: "dp1",
  occurrences: [],
  hours: { placed: 3, required: 4 },
  teacherKeys: ["self"],
  studentKeys: [],
  ...over,
});

/** Each row of a per-course sheet is a single cell; collect their values in row order. */
const values = (sheet: TimetableSheet): (string | undefined)[] => sheet.rows.map((row) => row[0]?.value);

describe("buildPerspectiveCourseSheet — header block", () => {
  it("renders title, cohort·level, hours, co-teachers, and occurrence lines", () => {
    const sheet = buildPerspectiveCourseSheet({
      item: item({
        teacherKeys: ["self", "t2"],
        occurrences: [placement("math", 1, 1), placement("math", 3, 3)],
      }),
      courseName: "Mathematics HL",
      level: "HL",
      teacherNames: { self: "Me", t2: "Jane Doe" },
      studentNames: {},
      omitTeacherKey: "self",
    });

    expect(values(sheet)).toEqual([
      "Mathematics HL",
      "DP1 · HL",
      "Placed 3 / Required 4",
      "Co-teachers: Jane Doe",
      "Occurrences: Mon P1 (08:00–08:45), Wed P3 (09:55–10:40)",
      undefined, // blank spacer row
      "Students",
      "No students assigned.",
    ]);
  });

  it("omits the hours line when the item has no hours stat", () => {
    const sheet = buildPerspectiveCourseSheet({
      item: item({ hours: null }),
      courseName: "Math",
      level: "SL",
      teacherNames: {},
      studentNames: {},
    });

    expect(values(sheet).some((line) => line?.startsWith("Placed"))).toBe(false);
  });

  it("excludes omitTeacherKey and omits the co-teachers line when no others remain", () => {
    const sheet = buildPerspectiveCourseSheet({
      item: item({ teacherKeys: ["self"] }),
      courseName: "Math",
      level: "HL",
      teacherNames: { self: "Me" },
      studentNames: {},
      omitTeacherKey: "self",
    });

    expect(values(sheet).some((line) => line?.startsWith("Co-teachers:"))).toBe(false);
  });

  it("sorts co-teacher names", () => {
    const sheet = buildPerspectiveCourseSheet({
      item: item({ teacherKeys: ["a", "b", "c"] }),
      courseName: "Math",
      level: "HL",
      teacherNames: { a: "Zed", b: "Amy", c: "Mia" },
      studentNames: {},
    });

    expect(values(sheet)).toContain("Co-teachers: Amy, Mia, Zed");
  });

  it("shows only the cohort when the level is empty", () => {
    const sheet = buildPerspectiveCourseSheet({
      item: item(),
      courseName: "Math",
      level: "",
      teacherNames: {},
      studentNames: {},
    });

    expect(values(sheet)[1]).toBe("DP1");
  });
});

describe("buildPerspectiveCourseSheet — roster", () => {
  it("lists the roster sorted by resolved name", () => {
    const sheet = buildPerspectiveCourseSheet({
      item: item({ studentKeys: ["s1", "s2", "s3"] }),
      courseName: "Math",
      level: "HL",
      teacherNames: {},
      studentNames: { s1: "Zoe", s2: "Ann", s3: "Mike" },
    });

    const rows = values(sheet);
    const studentsAt = rows.indexOf("Students");
    expect(rows.slice(studentsAt + 1)).toEqual(["Ann", "Mike", "Zoe"]);
  });

  it("falls back to the raw key when a student name is unmapped", () => {
    const sheet = buildPerspectiveCourseSheet({
      item: item({ studentKeys: ["s1"] }),
      courseName: "Math",
      level: "HL",
      teacherNames: {},
      studentNames: {},
    });

    expect(values(sheet).at(-1)).toBe("s1");
  });

  it("shows the empty-roster note when no students are assigned", () => {
    const sheet = buildPerspectiveCourseSheet({
      item: item({ studentKeys: [] }),
      courseName: "Math",
      level: "HL",
      teacherNames: {},
      studentNames: {},
    });

    expect(values(sheet).at(-1)).toBe("No students assigned.");
  });
});
