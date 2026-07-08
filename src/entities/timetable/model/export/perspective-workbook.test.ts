import { describe, expect, it } from "vitest";
import type { Cohort } from "@/shared/config";
import { buildPerspectiveWorkbook, type PerspectiveWorkbookInput } from "./perspective-workbook";
import type { CourseDisplay } from "../course-display";
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

const item = (courseId: string, cohort: Cohort, over: Partial<PerspectiveCourseItem> = {}): PerspectiveCourseItem => ({
  courseId,
  cohort,
  occurrences: [],
  hours: null,
  teacherKeys: [],
  studentKeys: [],
  ...over,
});

const baseInput = (over: Partial<PerspectiveWorkbookInput> = {}): PerspectiveWorkbookInput => ({
  planName: "IB 2027 Draft",
  fileCode: "KK",
  days: 5,
  periods: 8,
  cohorts: [
    { cohort: "dp1", placements: [], courseDisplay: {} },
    { cohort: "dp2", placements: [], courseDisplay: {} },
  ],
  courseDisplay: {},
  courseLevels: {},
  items: [],
  teacherNames: {},
  studentNames: {},
  ...over,
});

describe("buildPerspectiveWorkbook — sheet composition", () => {
  it("places the grid sheet first, then one sheet per course in (cohort, name) order", () => {
    const courseDisplay: Record<string, CourseDisplay> = {
      bio: { name: "Biology", color: null },
      art: { name: "Art", color: null },
      chem: { name: "Chemistry", color: null },
    };
    const { sheets } = buildPerspectiveWorkbook(
      baseInput({
        courseDisplay,
        items: [item("bio", "dp1"), item("chem", "dp2"), item("art", "dp1")],
      }),
    );

    expect(sheets.map((sheet) => sheet.name)).toEqual(["Timetable", "Art · DP1", "Biology · DP1", "Chemistry · DP2"]);
  });

  it("honors a custom grid sheet name", () => {
    const { sheets } = buildPerspectiveWorkbook(baseInput({ gridSheetName: "Schedule" }));
    expect(sheets[0].name).toBe("Schedule");
  });

  it("de-duplicates identical course tab names", () => {
    const courseDisplay: Record<string, CourseDisplay> = {
      a: { name: "Physics", color: null },
      b: { name: "Physics", color: null },
    };
    const { sheets } = buildPerspectiveWorkbook(
      baseInput({ courseDisplay, items: [item("a", "dp1"), item("b", "dp1")] }),
    );

    const courseNames = sheets.slice(1).map((sheet) => sheet.name);
    expect(courseNames).toEqual(["Physics · DP1", "Physics · DP1~2"]);
    expect(new Set(courseNames).size).toBe(courseNames.length);
  });

  it("still yields a sheet for a course with an empty roster", () => {
    const courseDisplay: Record<string, CourseDisplay> = { a: { name: "Physics", color: null } };
    const { sheets } = buildPerspectiveWorkbook(
      baseInput({ courseDisplay, items: [item("a", "dp1", { studentKeys: [] })] }),
    );

    expect(sheets).toHaveLength(2);
    expect(sheets[1].name).toBe("Physics · DP1");
  });
});

describe("buildPerspectiveWorkbook — grid sheet", () => {
  it("merges both cohorts' placements and tags each occupant with its cohort", () => {
    const dp1Display: Record<string, CourseDisplay> = { m: { name: "Math", color: null } };
    const dp2Display: Record<string, CourseDisplay> = { e: { name: "English", color: null } };
    const { sheets } = buildPerspectiveWorkbook(
      baseInput({
        days: 1,
        periods: 1,
        cohorts: [
          { cohort: "dp1", placements: [placement("m", 1, 1)], courseDisplay: dp1Display },
          { cohort: "dp2", placements: [placement("e", 1, 1)], courseDisplay: dp2Display },
        ],
        courseDisplay: { ...dp1Display, ...dp2Display },
      }),
    );

    const gridValues = sheets[0].sheet.rows.flat().map((cell) => cell?.value);
    expect(gridValues).toContain("Math (DP1)");
    expect(gridValues).toContain("English (DP2)");
  });
});

describe("buildPerspectiveWorkbook — filename", () => {
  it("builds the filename from the plan slug and file code", () => {
    const { fileName } = buildPerspectiveWorkbook(baseInput({ planName: "IB 2027 Draft", fileCode: "KK" }));
    expect(fileName).toBe("ib-2027-draft-kk.xlsx");
  });

  it("falls back to `plan` when the plan name has no alphanumerics", () => {
    const { fileName } = buildPerspectiveWorkbook(baseInput({ planName: "!!!", fileCode: "kk" }));
    expect(fileName).toBe("plan-kk.xlsx");
  });
});
