import { describe, expect, it } from "vitest";
import type { Cohort } from "@/shared/config";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import type { LocalPlacement } from "@/entities/timetable";
import type { CourseMerge, PlanTeacher } from "@/shared/api";
import {
  buildBatchExportWorkbooks,
  type BatchExportCohort,
  type BatchExportFile,
  type BatchExportInput,
} from "./batch-export-workbooks";
import type { WorkbookSheet } from "./export-workbook";

const course = (id: string, teacherKeys: string[], studentKeys: string[] = []): GroupingCourse => ({
  id,
  teacherKeys,
  studentKeys,
  hours: 4,
  weekMode: "agnostic",
});

const placement = (courseId: string, day: number, period: number): LocalPlacement => ({
  id: `${courseId}-${day}-${period}`,
  courseId,
  day,
  period,
  week: "both",
  isOptional: false,
});

const cohort = (c: Cohort, over: Partial<BatchExportCohort> = {}): BatchExportCohort => ({
  cohort: c,
  placements: [],
  courseDisplay: {},
  catalog: [],
  studentNames: {},
  hours: new Map(),
  ...over,
});

const teacher = (id: string, code: string, fullName: string | null = null): PlanTeacher => ({ id, code, fullName });

const input = (over: Partial<BatchExportInput> = {}): BatchExportInput => ({
  planName: "IB 2027",
  days: 5,
  periods: 6,
  teacherNames: {},
  dp1: cohort("dp1"),
  dp2: cohort("dp2"),
  batch: { teachers: [], merges: [], courseLevels: {} },
  ...over,
});

const sheetNames = (file: BatchExportFile): string[] => file.sheets.map((sheet) => sheet.sheet);
const cellValues = (sheet: WorkbookSheet): (string | undefined)[] => sheet.data.flat().map((cell) => cell?.value);

describe("buildBatchExportWorkbooks", () => {
  it("puts the combined workbook first, then one file per conducting teacher in loader order", () => {
    const dp1 = cohort("dp1", {
      catalog: [course("a", ["t1"]), course("b", ["t2"])],
      placements: [placement("a", 1, 1), placement("b", 2, 2)],
      courseDisplay: { a: { name: "Alpha", color: null }, b: { name: "Beta", color: null } },
      hours: new Map([
        ["a", { placed: 1, required: 4 }],
        ["b", { placed: 1, required: 4 }],
      ]),
    });
    const result = buildBatchExportWorkbooks(
      input({
        dp1,
        // tNone conducts nothing — it must be skipped, not emit an empty file.
        batch: {
          teachers: [teacher("t1", "T1"), teacher("t2", "T2"), teacher("tnone", "TNONE")],
          merges: [],
          courseLevels: {},
        },
      }),
    );

    expect(result.zipFileName).toBe("ib-2027.zip");
    expect(result.files.map((file) => file.fileName)).toEqual([
      "ib-2027-combined.xlsx",
      "ib-2027-t1.xlsx",
      "ib-2027-t2.xlsx",
    ]);
    expect(sheetNames(result.files[0])).toEqual(["Combined", "DP1 subjects", "DP2 subjects"]);
  });

  it("narrows each teacher's grid to only their own courses' placements", () => {
    const dp1 = cohort("dp1", {
      catalog: [course("a", ["t1"]), course("b", ["t2"])],
      placements: [placement("a", 1, 1), placement("b", 2, 2)],
      courseDisplay: { a: { name: "Alpha", color: null }, b: { name: "Beta", color: null } },
      hours: new Map([
        ["a", { placed: 1, required: 4 }],
        ["b", { placed: 1, required: 4 }],
      ]),
    });
    const result = buildBatchExportWorkbooks(
      input({ dp1, batch: { teachers: [teacher("t1", "T1")], merges: [], courseLevels: {} } }),
    );

    // Occupant labels carry a ` (DP1)` cohort tag in the perspective grid, so match on substring.
    const grid = cellValues(result.files[1].sheets[0]);
    expect(grid.some((value) => value?.includes("Alpha"))).toBe(true);
    expect(grid.some((value) => value?.includes("Beta"))).toBe(false); // t2's course must not leak in
  });

  it("resolves a merge parent to its child rows in the conducting teacher's workbook", () => {
    const dp1 = cohort("dp1", {
      catalog: [course("parent", ["t1"]), course("child", ["t1"], ["s1"])],
      placements: [placement("parent", 3, 3)],
      courseDisplay: { parent: { name: "Parent", color: null }, child: { name: "Child", color: null } },
      hours: new Map([
        ["parent", { placed: 1, required: 4 }],
        ["child", { placed: 0, required: 0 }],
      ]),
      studentNames: { s1: "Stu One" },
    });
    const merges: CourseMerge[] = [{ parentId: "parent", childId: "child" }];
    const result = buildBatchExportWorkbooks(
      input({ dp1, batch: { teachers: [teacher("t1", "T1")], merges, courseLevels: {} } }),
    );

    // The parent composite resolves to the child row (grid + one Child sheet); no standalone Parent sheet.
    expect(sheetNames(result.files[1])).toEqual(["Timetable", "Child · DP1"]);
    // The child inherits the parent's placement as its occurrence.
    expect(cellValues(result.files[1].sheets[1]).some((value) => value?.startsWith("Occurrences: Wed P3"))).toBe(true);
  });

  it("passes live hours through untouched rather than re-deriving from placements", () => {
    const dp1 = cohort("dp1", {
      catalog: [course("a", ["t1"], ["s1"])],
      placements: [placement("a", 1, 1)], // one placement…
      courseDisplay: { a: { name: "Alpha", color: null } },
      hours: new Map([["a", { placed: 9, required: 5 }]]), // …but the live hours say 9/5
      studentNames: { s1: "Stu One" },
    });
    const result = buildBatchExportWorkbooks(
      input({ dp1, batch: { teachers: [teacher("t1", "T1")], merges: [], courseLevels: {} } }),
    );

    expect(cellValues(result.files[1].sheets[1])).toContain("Placed 9 / Required 5");
  });

  it("sets omitTeacherKey so each course sheet excludes the viewing teacher from co-teachers", () => {
    const dp1 = cohort("dp1", {
      catalog: [course("a", ["t1", "t2"], ["s1"])],
      placements: [placement("a", 1, 1)],
      courseDisplay: { a: { name: "Alpha", color: null } },
      hours: new Map([["a", { placed: 1, required: 4 }]]),
      studentNames: { s1: "Stu One" },
    });
    const result = buildBatchExportWorkbooks(
      input({
        dp1,
        teacherNames: { t1: "Teacher One", t2: "Teacher Two" },
        batch: { teachers: [teacher("t1", "T1")], merges: [], courseLevels: {} },
      }),
    );

    const text = cellValues(result.files[1].sheets[1]);
    expect(text).toContain("Co-teachers: Teacher Two");
    // The viewer (t1) is omitted — no line mentions "Teacher One".
    expect(text.some((value) => value?.includes("Teacher One"))).toBe(false);
  });

  it("dedupes in-archive filename collisions case-insensitively with a numeric suffix", () => {
    const dp1 = cohort("dp1", {
      catalog: [course("a", ["ta", "tb"], ["s1"])],
      placements: [placement("a", 1, 1)],
      courseDisplay: { a: { name: "Alpha", color: null } },
      hours: new Map([["a", { placed: 1, required: 4 }]]),
      studentNames: { s1: "Stu One" },
    });
    const result = buildBatchExportWorkbooks(
      input({
        dp1,
        // Two codes that slugify to the same string — the second file must disambiguate.
        batch: { teachers: [teacher("ta", "ABC"), teacher("tb", "abc")], merges: [], courseLevels: {} },
      }),
    );

    expect(result.files.map((file) => file.fileName)).toEqual([
      "ib-2027-combined.xlsx",
      "ib-2027-abc.xlsx",
      "ib-2027-abc-2.xlsx",
    ]);
  });

  it("slugs the zip filename, falling back to `plan` when the name has no alphanumerics", () => {
    expect(buildBatchExportWorkbooks(input({ planName: "IB 2027 Draft!" })).zipFileName).toBe("ib-2027-draft.zip");

    const fallback = buildBatchExportWorkbooks(input({ planName: "***" }));
    expect(fallback.zipFileName).toBe("plan.zip");
    expect(fallback.files[0].fileName).toBe("plan-combined.xlsx");
  });
});
