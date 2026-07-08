import { describe, expect, it } from "vitest";
import type { CourseDisplay, LocalPlacement } from "@/entities/timetable";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import type { Cohort } from "@/shared/config";
import type { BoardSurface } from "./board-surface";
import {
  buildExportWorkbook,
  type ExportCohortData,
  type ExportWorkbookInput,
  type WorkbookSheet,
} from "./export-workbook";

const placement = (courseId: string, day: number, period: number): LocalPlacement => ({
  id: `${courseId}-${day}-${period}`,
  courseId,
  day,
  period,
  week: "both",
  isOptional: false,
});

const course = (id: string): GroupingCourse => ({
  id,
  teacherKeys: [],
  studentKeys: [],
  hours: 4,
  weekMode: "agnostic",
});

const cohortData = (cohort: Cohort, over: Partial<ExportCohortData> = {}): ExportCohortData => ({
  cohort,
  placements: [],
  courseDisplay: {},
  catalog: [],
  studentNames: {},
  ...over,
});

const input = (view: BoardSurface, over: Partial<ExportWorkbookInput> = {}): ExportWorkbookInput => ({
  planName: "IB 2027",
  view,
  days: 5,
  periods: 6,
  teacherNames: {},
  dp1: cohortData("dp1"),
  dp2: cohortData("dp2"),
  ...over,
});

const cellValues = (sheet: WorkbookSheet): (string | undefined)[] => sheet.data.flat().map((cell) => cell?.value);

describe("buildExportWorkbook", () => {
  it("combined: timetable grid first, then one roster per cohort, with the combined filename", () => {
    const { sheets, fileName } = buildExportWorkbook(input("combined"));

    expect(sheets.map((s) => s.sheet)).toEqual(["Combined", "DP1 subjects", "DP2 subjects"]);
    expect(fileName).toBe("ib-2027-combined.xlsx");
    expect(sheets[0].stickyRowsCount).toBe(2); // combined freezes both header rows
  });

  it("dp1 focus: single-cohort grid + its roster only", () => {
    const { sheets, fileName } = buildExportWorkbook(input("dp1"));

    expect(sheets.map((s) => s.sheet)).toEqual(["DP1", "DP1 subjects"]);
    expect(fileName).toBe("ib-2027-dp1.xlsx");
    expect(sheets[0].stickyRowsCount).toBe(1);
  });

  it("dp2 focus: the dp2 grid + the dp2 roster", () => {
    const { sheets, fileName } = buildExportWorkbook(input("dp2"));

    expect(sheets.map((s) => s.sheet)).toEqual(["DP2", "DP2 subjects"]);
    expect(fileName).toBe("ib-2027-dp2.xlsx");
  });

  it("routes a cohort's live placements into the grid and its catalog into the roster", () => {
    const dp1 = cohortData("dp1", {
      placements: [placement("math", 1, 1)],
      courseDisplay: { math: { name: "Math", color: null } satisfies CourseDisplay },
      catalog: [course("math")],
    });

    const { sheets } = buildExportWorkbook(input("dp1", { dp1 }));

    expect(cellValues(sheets[0])).toContain("Math"); // placed on the grid
    expect(cellValues(sheets[1])).toContain("Math"); // listed on the roster
  });
});
