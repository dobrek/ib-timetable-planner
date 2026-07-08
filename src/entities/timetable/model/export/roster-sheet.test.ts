import { describe, expect, it } from "vitest";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import { buildRosterSheet } from "./roster-sheet";
import type { TimetableSheet, TimetableSheetCell } from "./sheet-types";
import type { CourseDisplay } from "../course-display";

const course = (id: string, over: Partial<GroupingCourse> = {}): GroupingCourse => ({
  id,
  teacherKeys: [],
  studentKeys: [],
  hours: 4,
  weekMode: "agnostic",
  ...over,
});

const at = (sheet: TimetableSheet, row: number, column: number): NonNullable<TimetableSheetCell> => {
  const cell = sheet.rows[row][column];
  if (cell === null) throw new Error(`cell (${row},${column}) is null`);
  return cell;
};

const build = (catalog: GroupingCourse[], over: Partial<Parameters<typeof buildRosterSheet>[0]> = {}) =>
  buildRosterSheet({ catalog, courseDisplay: {}, teacherNames: {}, studentNames: {}, ...over });

describe("buildRosterSheet — header", () => {
  it("emits a bold, bottom-ruled header row and freezes it", () => {
    const sheet = build([]);

    expect(sheet.rows[0].map((c) => c?.value)).toEqual(["Subject", "Teachers", "Students", "Hours/week"]);
    expect(sheet.rows[0].every((c) => c?.fontWeight === "bold")).toBe(true);
    expect(at(sheet, 0, 0)).toMatchObject({ bottomBorderStyle: "thin" });
    expect(sheet.stickyRowsCount).toBe(1);
    expect(sheet.stickyColumnsCount).toBe(0);
  });

  it("returns the header row only for an empty catalog (valid sheet, no crash)", () => {
    expect(build([]).rows).toHaveLength(1);
  });
});

describe("buildRosterSheet — subject rows", () => {
  it("lists every catalog subject sorted by resolved display name", () => {
    const courseDisplay: Record<string, CourseDisplay> = {
      m: { name: "Math", color: null },
      a: { name: "Art", color: null },
      z: { name: "Zoology", color: null },
    };
    const sheet = build([course("m"), course("a"), course("z")], { courseDisplay });

    expect(sheet.rows.slice(1).map((r) => r[0]?.value)).toEqual(["Art", "Math", "Zoology"]);
  });

  it("breaks display-name ties by course id for stable ordering", () => {
    const courseDisplay: Record<string, CourseDisplay> = {
      "a-id": { name: "Same", color: null },
      "b-id": { name: "Same", color: null },
    };
    const sheet = build([course("b-id", { hours: 2 }), course("a-id", { hours: 9 })], { courseDisplay });

    // a-id sorts before b-id → its hours (9) row comes first
    expect(sheet.rows.slice(1).map((r) => r[3]?.value)).toEqual(["9", "2"]);
  });

  it("resolves the subject name, falling back to the raw id, with no color fill", () => {
    const sheet = build([course("unknown")]);
    const cell = at(sheet, 1, 0);

    expect(cell.value).toBe("unknown");
    expect(cell.backgroundColor).toBeUndefined();
  });

  it("resolves and name-sorts teachers/students, falling back to raw keys, joined and wrapped", () => {
    const sheet = build([course("c1", { teacherKeys: ["t2", "t1"], studentKeys: ["s1", "sX"] })], {
      courseDisplay: { c1: { name: "Chem", color: null } },
      teacherNames: { t1: "Alice", t2: "Bob" },
      studentNames: { s1: "Dave" }, // sX is unmapped → raw key
    });

    expect(at(sheet, 1, 1)).toMatchObject({ value: "Alice, Bob", wrap: true });
    expect(at(sheet, 1, 2)).toMatchObject({ value: "Dave, sX", wrap: true });
  });

  it("right-aligns the weekly-hours cell", () => {
    const sheet = build([course("c1", { hours: 6 })]);

    expect(at(sheet, 1, 3)).toMatchObject({ value: "6", align: "right" });
  });
});

describe("buildRosterSheet — columns", () => {
  it("sizes subject/teachers/students/hours columns", () => {
    expect(build([]).columns.map((c) => c.width)).toEqual([28, 30, 60, 10]);
  });
});
