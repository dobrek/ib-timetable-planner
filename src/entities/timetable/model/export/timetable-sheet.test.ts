import { describe, expect, it } from "vitest";
import { SUBJECT_COLOR_HEX, type Cohort } from "@/shared/config";
import { buildTimetableSheet, type TimetableSheetColumn } from "./timetable-sheet";
import type { TimetableSheet, TimetableSheetCell } from "./sheet-types";
import type { CourseDisplay } from "../course-display";
import type { LocalPlacement } from "../placement";

const placement = (
  courseId: string,
  day: number,
  period: number,
  over: Partial<LocalPlacement> = {},
): LocalPlacement => ({
  id: `${courseId}-${day}-${period}`,
  courseId,
  day,
  period,
  week: "both",
  isOptional: false,
  ...over,
});

const col = (
  cohort: Cohort,
  placements: LocalPlacement[],
  courseDisplay: Record<string, CourseDisplay> = {},
): TimetableSheetColumn => ({ cohort, placements, courseDisplay });

/** A non-null cell for property access; throws if the position is a span placeholder. */
const at = (sheet: TimetableSheet, row: number, column: number): NonNullable<TimetableSheetCell> => {
  const cell = sheet.rows[row][column];
  if (cell === null) throw new Error(`cell (${row},${column}) is a null span placeholder`);
  return cell;
};

describe("buildTimetableSheet — header structure", () => {
  it("combined: day headers span both sub-columns, each followed by a null placeholder", () => {
    const sheet = buildTimetableSheet({ days: 2, periods: 1, columns: [col("dp1", []), col("dp2", [])] });

    // corner + [day1 span, null, day2 span, null]
    expect(sheet.rows[0]).toHaveLength(5);
    expect(at(sheet, 0, 0).value).toBeUndefined(); // blank corner
    expect(at(sheet, 0, 1)).toMatchObject({ value: "Mon", fontWeight: "bold", align: "center", columnSpan: 2 });
    expect(sheet.rows[0][2]).toBeNull();
    expect(at(sheet, 0, 3)).toMatchObject({ value: "Tue", columnSpan: 2 });
    expect(sheet.rows[0][4]).toBeNull();
  });

  it("combined: a cohort sub-label row names each sub-column under every day", () => {
    const sheet = buildTimetableSheet({ days: 2, periods: 1, columns: [col("dp1", []), col("dp2", [])] });

    expect(at(sheet, 1, 0).value).toBeUndefined(); // blank corner
    expect([1, 2, 3, 4].map((c) => at(sheet, 1, c).value)).toEqual(["DP1", "DP2", "DP1", "DP2"]);
  });

  it("focus: single column, no span, no null placeholders, no cohort sub-label row", () => {
    const sheet = buildTimetableSheet({ days: 2, periods: 1, columns: [col("dp1", [])] });

    expect(sheet.rows[0]).toHaveLength(3); // corner + day1 + day2
    expect(at(sheet, 0, 1)).toMatchObject({ value: "Mon" });
    expect(at(sheet, 0, 1).columnSpan).toBeUndefined();
    expect(sheet.rows[0][2]).not.toBeNull();
    // Row 1 is already the first period row — no cohort label row.
    expect(at(sheet, 1, 0).value).toBe("08:00–08:45");
  });
});

describe("buildTimetableSheet — period row headers", () => {
  it("shows the time range, falling back to the period label past P10", () => {
    const sheet = buildTimetableSheet({ days: 1, periods: 11, columns: [col("dp1", [])] });
    const rowHeaders = sheet.rows.map((row) => row[0]?.value);

    expect(rowHeaders).toContain("08:00–08:45"); // P1
    expect(rowHeaders).toContain("16:10–16:55"); // P10
    expect(rowHeaders).toContain("P11"); // fallback — no time defined
  });
});

describe("buildTimetableSheet — content cells", () => {
  const sky: Record<string, CourseDisplay> = { math: { name: "Math", color: "sky" } };

  it("renders a single occupant with its subject fill and text color", () => {
    const sheet = buildTimetableSheet({ days: 1, periods: 1, columns: [col("dp1", [placement("math", 1, 1)], sky)] });
    const cell = at(sheet, 1, 1);

    expect(cell.value).toBe("Math");
    expect(cell.backgroundColor).toBe(SUBJECT_COLOR_HEX.sky.fill);
    expect(cell.textColor).toBe(SUBJECT_COLOR_HEX.sky.text);
  });

  it("appends (A)/(B) for week a/b and nothing for both", () => {
    const cellFor = (week: LocalPlacement["week"]) =>
      at(
        buildTimetableSheet({ days: 1, periods: 1, columns: [col("dp1", [placement("math", 1, 1, { week })], sky)] }),
        1,
        1,
      );

    expect(cellFor("a").value).toBe("Math (A)");
    expect(cellFor("b").value).toBe("Math (B)");
    expect(cellFor("both").value).toBe("Math");
  });

  it("appends (optional), after any week tag", () => {
    const sheet = buildTimetableSheet({
      days: 1,
      periods: 1,
      columns: [col("dp1", [placement("math", 1, 1, { week: "a", isOptional: true })], sky)],
    });

    expect(at(sheet, 1, 1).value).toBe("Math (A) (optional)");
  });

  it("does not fill a colorless occupant cell", () => {
    const plain: Record<string, CourseDisplay> = { math: { name: "Math", color: null } };
    const sheet = buildTimetableSheet({ days: 1, periods: 1, columns: [col("dp1", [placement("math", 1, 1)], plain)] });

    const cell = at(sheet, 1, 1);
    expect(cell.value).toBe("Math");
    expect(cell.backgroundColor).toBeUndefined();
    expect(cell.textColor).toBeUndefined();
  });

  it("emits empty, bordered filler cells for an empty board without crashing", () => {
    const sheet = buildTimetableSheet({ days: 2, periods: 2, columns: [col("dp1", []), col("dp2", [])] });
    const cell = at(sheet, 2, 1); // first period, first content cell

    expect(cell.value).toBeUndefined();
    expect(cell.borderStyle).toBe("thin");
  });
});

describe("buildTimetableSheet — bundles stack as per-occupant sub-rows", () => {
  const display: Record<string, CourseDisplay> = {
    alpha: { name: "Alpha", color: "sky" },
    beta: { name: "Beta", color: "rose" },
  };

  it("splits a bundle into one colored cell per course, one sub-row each", () => {
    const sheet = buildTimetableSheet({
      days: 1,
      periods: 1,
      columns: [col("dp1", [placement("beta", 1, 1), placement("alpha", 1, 1)], display)],
    });

    // Name-sorted: Alpha in sub-row 0, Beta in sub-row 1 — each keeps its own color.
    expect(at(sheet, 1, 1)).toMatchObject({
      value: "Alpha",
      backgroundColor: SUBJECT_COLOR_HEX.sky.fill,
      textColor: SUBJECT_COLOR_HEX.sky.text,
    });
    expect(at(sheet, 2, 1)).toMatchObject({
      value: "Beta",
      backgroundColor: SUBJECT_COLOR_HEX.rose.fill,
      textColor: SUBJECT_COLOR_HEX.rose.text,
    });
  });

  it("gives the period a rowSpanned time header with a null placeholder beneath it", () => {
    const sheet = buildTimetableSheet({
      days: 1,
      periods: 1,
      columns: [col("dp1", [placement("alpha", 1, 1), placement("beta", 1, 1)], display)],
    });

    expect(at(sheet, 1, 0)).toMatchObject({ value: "08:00–08:45", rowSpan: 2, alignVertical: "center" });
    expect(sheet.rows[2][0]).toBeNull(); // the merge placeholder under the time header
  });

  it("stacks 3+ occupants in name order, one per sub-row", () => {
    const names: Record<string, CourseDisplay> = {
      z: { name: "Zebra", color: null },
      a: { name: "Apple", color: null },
      m: { name: "Mango", color: null },
    };
    const sheet = buildTimetableSheet({
      days: 1,
      periods: 1,
      columns: [col("dp1", [placement("z", 1, 1), placement("a", 1, 1), placement("m", 1, 1)], names)],
    });

    expect([1, 2, 3].map((r) => at(sheet, r, 1).value)).toEqual(["Apple", "Mango", "Zebra"]);
  });

  it("sizes a period to its busiest cell; lighter cells get empty fillers below", () => {
    const two: Record<string, CourseDisplay> = { m: { name: "Math", color: null }, b: { name: "Bio", color: null } };
    const one: Record<string, CourseDisplay> = { c: { name: "Chem", color: "teal" } };
    const sheet = buildTimetableSheet({
      days: 1,
      periods: 1,
      columns: [col("dp1", [placement("m", 1, 1), placement("b", 1, 1)], two), col("dp2", [placement("c", 1, 1)], one)],
    });

    // columns: [label, day1·dp1, day1·dp2]; period height 2 → sub-rows at sheet rows 2 and 3.
    expect(at(sheet, 2, 2).value).toBe("Chem"); // dp2's one course sits in the top sub-row
    expect(at(sheet, 3, 2).value).toBeUndefined(); // filler beneath it
    expect(at(sheet, 2, 1).value).toBeDefined(); // dp1 fills both sub-rows
    expect(at(sheet, 3, 1).value).toBeDefined();
  });

  it("carries no rowSpan on the time header of a single-height period", () => {
    const sheet = buildTimetableSheet({
      days: 1,
      periods: 1,
      columns: [col("dp1", [placement("math", 1, 1)], { math: { name: "Math", color: null } })],
    });

    expect(at(sheet, 1, 0).rowSpan).toBeUndefined();
  });
});

describe("buildTimetableSheet — break bands", () => {
  const isBreakRow = (row: TimetableSheetCell[]) => row[0]?.height !== undefined && row[0]?.value === undefined;

  it("inserts one spacer row after each interior break period (P2, P5)", () => {
    const sheet = buildTimetableSheet({ days: 1, periods: 6, columns: [col("dp1", [])] });

    // header + 6 single-height period rows + 2 break rows (after P2, after P5)
    expect(sheet.rows).toHaveLength(9);
    expect(sheet.rows.filter(isBreakRow)).toHaveLength(2);
    const breakRow = sheet.rows.find(isBreakRow);
    expect(breakRow?.[0]).toMatchObject({ columnSpan: 2 });
    expect(breakRow?.[1]).toBeNull();
  });

  it("suppresses a break after the final period", () => {
    const sheet = buildTimetableSheet({ days: 1, periods: 5, columns: [col("dp1", [])] });

    // break after P2 stays; break after P5 is suppressed (P5 is last) → header + 5 + 1 = 7
    expect(sheet.rows).toHaveLength(7);
    expect(sheet.rows.filter(isBreakRow)).toHaveLength(1);
  });
});

describe("buildTimetableSheet — separators (border weight)", () => {
  it("closes each day column with a strong right border and cohort splits with a lighter one", () => {
    const sheet = buildTimetableSheet({ days: 1, periods: 1, columns: [col("dp1", []), col("dp2", [])] });

    // columns: [label, day1·dp1, day1·dp2]; the content sub-row is sheet row 2.
    const dp1 = at(sheet, 2, 1);
    const dp2 = at(sheet, 2, 2);
    expect(dp2.rightBorderStyle).toBe("medium"); // day boundary — heaviest
    expect(dp1.rightBorderStyle).toBe("thin"); // cohort split — lighter
    expect(dp1.rightBorderColor).toBe(dp2.rightBorderColor); // both the dark separator color
    expect(dp1.rightBorderColor).not.toBe(dp1.borderColor); // stronger than the internal grid
  });

  it("closes the frozen time-label column with a strong right border", () => {
    const sheet = buildTimetableSheet({ days: 1, periods: 1, columns: [col("dp1", [])] });

    expect(at(sheet, 1, 0).rightBorderStyle).toBe("medium");
  });

  it("closes each period block with a strong bottom on its last sub-row and time header", () => {
    const two: Record<string, CourseDisplay> = { m: { name: "Math", color: null }, b: { name: "Bio", color: null } };
    const sheet = buildTimetableSheet({
      days: 1,
      periods: 1,
      columns: [col("dp1", [placement("m", 1, 1), placement("b", 1, 1)], two)],
    });

    // focus, one day, a 2-tall period → rows: [0] day header, [1] sub-row 0, [2] sub-row 1 (last).
    expect(at(sheet, 1, 1).bottomBorderStyle).toBeUndefined(); // internal sub-row: thin grid
    expect(at(sheet, 2, 1).bottomBorderStyle).toBe("medium"); // period end
    expect(at(sheet, 1, 0).bottomBorderStyle).toBe("medium"); // time header closes the block
  });

  it("marks the bottom of the header block (day row in focus, cohort row in combined)", () => {
    const focus = buildTimetableSheet({ days: 1, periods: 1, columns: [col("dp1", [])] });
    expect(at(focus, 0, 1).bottomBorderStyle).toBe("medium"); // the only header row

    const combined = buildTimetableSheet({ days: 1, periods: 1, columns: [col("dp1", []), col("dp2", [])] });
    expect(at(combined, 0, 1).bottomBorderStyle).toBeUndefined(); // day header — cohort row sits below
    expect(at(combined, 1, 1).bottomBorderStyle).toBe("medium"); // cohort label row ends the header
  });
});

describe("buildTimetableSheet — sheet options", () => {
  it("freezes the label column plus both header rows in combined", () => {
    const sheet = buildTimetableSheet({ days: 5, periods: 1, columns: [col("dp1", []), col("dp2", [])] });

    expect(sheet.stickyRowsCount).toBe(2);
    expect(sheet.stickyColumnsCount).toBe(1);
  });

  it("freezes the label column plus the single header row in focus", () => {
    const sheet = buildTimetableSheet({ days: 5, periods: 1, columns: [col("dp1", [])] });

    expect(sheet.stickyRowsCount).toBe(1);
    expect(sheet.stickyColumnsCount).toBe(1);
  });

  it("sets a narrow first column and uniform wider course columns", () => {
    const sheet = buildTimetableSheet({ days: 2, periods: 1, columns: [col("dp1", []), col("dp2", [])] });

    // 1 label column + 2 days × 2 cohorts = 5 columns
    expect(sheet.columns).toHaveLength(5);
    expect(sheet.columns[0].width).toBeLessThan(sheet.columns[1].width);
    expect(new Set(sheet.columns.slice(1).map((c) => c.width)).size).toBe(1); // uniform course columns
  });
});
