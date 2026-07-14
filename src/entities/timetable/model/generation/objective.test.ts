import { describe, expect, it } from "vitest";
import type { PlacementWeek } from "@/shared/config";
import { course } from "../__fixtures__/builders";
import {
  compareObjectives,
  countDoublesDeficit,
  countFridayTail,
  countInteriorHoles,
  countLateStarts,
  countSoftHits,
  countStudentHoles,
  countTeacherHoles,
  type Objective,
  SEARCH_TIERS,
} from "./objective";

/** The 9-tuple, with every tier below `slots` defaulting to 0 so a case names only what it tests. */
const obj = (
  unplaced: number,
  holes: number,
  slots: number,
  teacherHoles = 0,
  softHits = 0,
  studentHoles = 0,
  doublesDeficit = 0,
  lateStarts = 0,
  fridayTail = 0,
): Objective => [unplaced, holes, slots, teacherHoles, softHits, studentHoles, doublesDeficit, lateStarts, fridayTail];

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
    expect(compareObjectives(obj(0, 0, 49, 0, 0, 500), obj(0, 0, 50, 0, 0, 0))).toBeLessThan(0);
  });

  it("keeps the slot count dominant over the people tiers (5.2 / 5.3: slots outrank both)", () => {
    // The expert took 3 soft hits, and 50 teacher windows, rather than pay one extra slot.
    expect(compareObjectives(obj(0, 0, 49, 50, 3), obj(0, 0, 50, 0, 0))).toBeLessThan(0);
  });

  it("ranks teacher gaps above soft-availability hits (G4)", () => {
    expect(compareObjectives(obj(0, 0, 49, 0, 3), obj(0, 0, 49, 1, 0))).toBeLessThan(0);
  });

  it("ranks soft hits above student gaps (her 0 soft hits beside ~600 student gaps)", () => {
    expect(compareObjectives(obj(0, 0, 49, 0, 0, 600), obj(0, 0, 49, 0, 1, 0))).toBeLessThan(0);
  });

  it("ranks student gaps above the shape tiers (a window hurts more than a lone single)", () => {
    expect(compareObjectives(obj(0, 0, 49, 0, 0, 0, 99, 99, 99), obj(0, 0, 49, 0, 0, 1))).toBeLessThan(0);
  });

  it("orders the shape tiers doubles → lateStarts → fridayTail", () => {
    // A single avoidable single outranks any number of late starts…
    expect(compareObjectives(obj(0, 0, 49, 0, 0, 0, 0, 9, 9), obj(0, 0, 49, 0, 0, 0, 1))).toBeLessThan(0);
    // …and one late start outranks a Friday running to the end of the grid (3.1: earlier finish
    // beats later start, but only once every day already starts at P1).
    expect(compareObjectives(obj(0, 0, 49, 0, 0, 0, 0, 0, 9), obj(0, 0, 49, 0, 0, 0, 0, 1))).toBeLessThan(0);
  });

  it("costs a soft hit and a teacher hole exactly one tier step each — neither can outbid a slot", () => {
    const oneSlotWorse = obj(0, 0, 50, 0, 0);
    expect(compareObjectives(obj(0, 0, 49, 999, 999), oneSlotWorse)).toBeLessThan(0);
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

  it("ignores the shape tiers when truncated to SEARCH_TIERS (what the LNS walk steers by)", () => {
    const shapelier = obj(0, 0, 49, 0, 0, 0, 40, 12, 30);
    const shapeless = obj(0, 0, 49, 0, 0, 0, 0, 0, 0);
    expect(compareObjectives(shapelier, shapeless, SEARCH_TIERS)).toBe(0); // a tie the walk won't chase
    expect(compareObjectives(shapelier, shapeless)).toBeGreaterThan(0); // …but the polish still ranks it
  });

  it("never reorders a truncated comparison — a search tier still decides it", () => {
    expect(compareObjectives(obj(0, 0, 49, 0, 0, 0, 99), obj(0, 0, 50), SEARCH_TIERS)).toBeLessThan(0);
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

describe("countTeacherHoles (tier 4)", () => {
  const teachers = (entries: Record<string, string[]>) => new Map(Object.entries(entries));

  it("counts a teacher's idle period between two lessons — in BOTH week lanes for a `both` row", () => {
    // t1 teaches p1 and p3 on day 1; the free p2 is a window in week A and in week B → 2.
    expect(countTeacherHoles(teachers({ c1: ["t1"], c2: ["t1"] }), [row("c1", 1, 1), row("c2", 1, 3)])).toBe(2);
  });

  it("scores a biweekly (single-week) lane once", () => {
    expect(countTeacherHoles(teachers({ c1: ["t1"], c2: ["t1"] }), [row("c1", 1, 1, "a"), row("c2", 1, 3, "a")])).toBe(
      1,
    );
  });

  it("counts the gap once per co-teacher of a co-taught course", () => {
    expect(
      countTeacherHoles(teachers({ c1: ["t1", "t2"], c2: ["t1", "t2"] }), [row("c1", 1, 1, "a"), row("c2", 1, 3, "a")]),
    ).toBe(2);
  });

  it("returns 0 for a back-to-back day and ignores different teachers' days", () => {
    expect(countTeacherHoles(teachers({ c1: ["t1"], c2: ["t1"] }), [row("c1", 1, 1), row("c2", 1, 2)])).toBe(0);
    expect(countTeacherHoles(teachers({ c1: ["t1"], c2: ["t2"] }), [row("c1", 1, 1), row("c2", 1, 3)])).toBe(0);
  });

  it("spans cohorts — the rows are the merged board, so a cross-cohort gap counts", () => {
    // c1 is a dp1 course, c2 a dp2 one; t1 teaches both and idles through p2.
    expect(countTeacherHoles(teachers({ c1: ["t1"], c2: ["t1"] }), [row("c1", 2, 1, "a"), row("c2", 2, 3, "a")])).toBe(
      1,
    );
  });
});

describe("countSoftHits (tier 5)", () => {
  const teachers = (entries: Record<string, string[]>) => new Map(Object.entries(entries));
  const soft = (teacherKey: string, day: number, period: number) =>
    ({ teacherKey, day, period, severity: "soft" }) as const;

  it("counts one hit per (row, teacher) landing on a soft-no cell", () => {
    expect(countSoftHits(teachers({ c1: ["t1"] }), [row("c1", 1, 1)], [soft("t1", 1, 1)])).toBe(1);
  });

  it("counts a co-taught row once per affected teacher", () => {
    const availability = [soft("t1", 1, 1), soft("t2", 1, 1)];
    expect(countSoftHits(teachers({ c1: ["t1", "t2"] }), [row("c1", 1, 1)], availability)).toBe(2);
  });

  it("is week-agnostic — a biweekly row on a soft cell is one hit, not two", () => {
    expect(countSoftHits(teachers({ c1: ["t1"] }), [row("c1", 1, 1, "a")], [soft("t1", 1, 1)])).toBe(1);
  });

  it("ignores other cells, other teachers, and strong rows (those are hard-blocked upstream)", () => {
    expect(countSoftHits(teachers({ c1: ["t1"] }), [row("c1", 1, 2)], [soft("t1", 1, 1)])).toBe(0);
    expect(countSoftHits(teachers({ c1: ["t2"] }), [row("c1", 1, 1)], [soft("t1", 1, 1)])).toBe(0);
    expect(
      countSoftHits(
        teachers({ c1: ["t1"] }),
        [row("c1", 1, 1)],
        [{ teacherKey: "t1", day: 1, period: 1, severity: "strong" }],
      ),
    ).toBe(0);
  });
});

describe("countStudentHoles (tier 6)", () => {
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

describe("countDoublesDeficit (tier 7)", () => {
  it("charges nothing for a course taught as doubles", () => {
    // 4 hours as two same-day pairs — no day-lane holds a lone hour.
    const rows = [row("c", 1, 1, "a"), row("c", 1, 2, "a"), row("c", 3, 4, "a"), row("c", 3, 5, "a")];
    expect(countDoublesDeficit(rows)).toBe(0);
  });

  it("charges every avoidable single of an even-hour course", () => {
    // 4 hours scattered over 4 days → 4 singles, none of them forced (4 mod 2 = 0).
    const rows = [row("c", 1, 1, "a"), row("c", 2, 1, "a"), row("c", 3, 1, "a"), row("c", 4, 1, "a")];
    expect(countDoublesDeficit(rows)).toBe(4);
  });

  it("forgives exactly one single on an odd-hour course (the TOK hour is free)", () => {
    // 3 hours = one double + one single: the single is unavoidable, so the deficit is 0…
    expect(countDoublesDeficit([row("c", 1, 1, "a"), row("c", 1, 2, "a"), row("c", 3, 1, "a")])).toBe(0);
    // …but 3 hours as three singles pays for the two that could have paired.
    expect(countDoublesDeficit([row("c", 1, 1, "a"), row("c", 2, 1, "a"), row("c", 3, 1, "a")])).toBe(2);
  });

  it("charges nothing for a 1-hour biweekly lane (CAS/EE need no exception flag)", () => {
    expect(countDoublesDeficit([row("cas", 1, 1, "a"), row("ee", 2, 1, "b")])).toBe(0);
  });

  it("counts each week lane of a `both` row separately", () => {
    // One `both` hour fans into lanes a and b — each is a forced single (1 mod 2 = 1) → 0.
    expect(countDoublesDeficit([row("c", 1, 1)])).toBe(0);
    // Two `both` hours on different days: each lane holds 2 hours as 2 singles (2 mod 2 = 0, so
    // neither is forced) → 2 per lane, 4 across the fan-out.
    expect(countDoublesDeficit([row("c", 1, 1), row("c", 2, 1)])).toBe(4);
  });
});

describe("countLateStarts (tier 8)", () => {
  it("counts the free periods before the day's first lesson, per week lane", () => {
    // Day 1 starts at P3 → 2 free periods, in week a and in week b → 4.
    expect(countLateStarts([row("c", 1, 3)])).toBe(4);
  });

  it("scores 0 for a day starting at P1 and ignores empty days", () => {
    expect(countLateStarts([row("c", 1, 1), row("c", 1, 4)])).toBe(0);
    expect(countLateStarts([])).toBe(0);
  });

  it("sums independent days and scores a biweekly lane once", () => {
    // Day 1 starts at P2 (1) and day 2 at P4 (3), both on week a only → 4.
    expect(countLateStarts([row("c", 1, 2, "a"), row("d", 2, 4, "a")])).toBe(4);
  });
});

describe("countFridayTail (tier 9)", () => {
  it("counts the last occupied period of the final grid day, per week lane", () => {
    // Friday (day 5) ends at P6, in both week lanes → 12; earlier days are free.
    expect(countFridayTail([row("c", 5, 6), row("d", 1, 9)], 5)).toBe(12);
  });

  it("prefers the earlier Friday finish (the tier's whole purpose)", () => {
    const early = countFridayTail([row("c", 5, 1, "a"), row("c", 5, 2, "a")], 5);
    const late = countFridayTail([row("c", 5, 7, "a"), row("c", 5, 8, "a")], 5);
    expect(early).toBeLessThan(late);
  });

  it("scores 0 for an empty Friday", () => {
    expect(countFridayTail([row("c", 4, 9)], 5)).toBe(0);
  });
});
