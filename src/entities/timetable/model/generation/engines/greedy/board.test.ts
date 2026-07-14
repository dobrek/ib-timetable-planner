import { describe, expect, it } from "vitest";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import { course } from "../../../__fixtures__/builders";
import type { GeneratorSnapshot } from "../../types";
import { createBoard } from "./board";
import { buildProblem } from "./problem";

/**
 * `fitsAt` is the engine's fast MIRROR of the oracle: every stage and every LNS repair flows through
 * it, so a rule it fails to enforce is a rule the search will happily violate for 20 seconds before
 * the final verify throws the whole board away (constructed boards are returned unverified —
 * `search.ts`). These cases pin the two rules Phase 3 added, and — the part that matters most — pin
 * their DELTA semantics: a violation a PIN already created must never poison unrelated placements.
 */
const hours = (id: string, teacher: string, count = 4): GroupingCourse => ({
  ...course(id, teacher, ["s"]),
  hours: count,
});

const boardOf = (courses: GroupingCourse[], periods = 10) => {
  const snapshot: GeneratorSnapshot = {
    days: 5,
    periods,
    availability: [],
    finishesEarlyByCourseId: [],
    cohorts: {
      dp1: { courses, pins: [], parkedCourseIds: [] },
      dp2: { courses: [], pins: [], parkedCourseIds: [] },
    },
  };
  return createBoard(buildProblem(snapshot));
};

describe("fitsAt — no same-day split (R1)", () => {
  const math = hours("math", "t1");

  it("accepts a second same-day hour adjacent to the first (a double)", () => {
    const board = boardOf([math]);
    board.place("dp1", "math", 1, 4, "both");

    expect(board.fitsAt("dp1", math, 1, 5)).toBe("both");
    expect(board.fitsAt("dp1", math, 1, 3)).toBe("both");
  });

  it("rejects a gapped second same-day hour", () => {
    const board = boardOf([math]);
    board.place("dp1", "math", 1, 4, "both");

    expect(board.fitsAt("dp1", math, 1, 6)).toBeNull();
    expect(board.fitsAt("dp1", math, 1, 9)).toBeNull();
  });

  it("still enforces the 2/day cap on top of it", () => {
    const board = boardOf([math]);
    board.place("dp1", "math", 1, 4, "both");
    board.place("dp1", "math", 1, 5, "both");

    expect(board.fitsAt("dp1", math, 1, 6)).toBeNull();
    expect(board.fitsAt("dp1", math, 2, 6)).toBe("both"); // another day is untouched
  });

  it("keeps week lanes independent for a biweekly course", () => {
    const bio: GroupingCourse = { ...course("bio", "t2", ["s"]), hours: 4, weekMode: "biweekly" };
    const board = boardOf([bio]);
    board.place("dp1", "bio", 1, 2, "a");

    // Week A is occupied at P2, so a P6 candidate can only take week B — and does.
    expect(board.fitsAt("dp1", bio, 1, 6)).toBe("b");
  });
});

describe("fitsAt — teacher day shape (R2)", () => {
  const math = hours("math", "t1");
  const phys = hours("phys", "t1");

  it("accepts a day at the exact bounds (span 8) and rejects the 9th period", () => {
    const board = boardOf([math, phys]);
    board.place("dp1", "math", 1, 1, "both");

    expect(board.fitsAt("dp1", phys, 1, 8)).toBe("both");
    expect(board.fitsAt("dp1", phys, 1, 9)).toBeNull();
  });

  it("rejects a 7th consecutive teaching hour but allows a gapped 7th", () => {
    const courses = Array.from({ length: 8 }, (_, index) => hours(`c${index + 1}`, "t1", 1));
    const board = boardOf(courses);
    for (let period = 1; period <= 6; period++) board.place("dp1", `c${period}`, 1, period, "both");

    expect(board.fitsAt("dp1", courses[6], 1, 7)).toBeNull(); // would be 7 in a row
    expect(board.fitsAt("dp1", courses[6], 1, 8)).toBe("both"); // span 8, streak 6 — legal
  });

  it("counts the teacher's day across BOTH cohorts", () => {
    const snapshot: GeneratorSnapshot = {
      days: 5,
      periods: 10,
      availability: [],
      finishesEarlyByCourseId: [],
      cohorts: {
        dp1: { courses: [math], pins: [], parkedCourseIds: [] },
        dp2: { courses: [phys], pins: [], parkedCourseIds: [] },
      },
    };
    const board = createBoard(buildProblem(snapshot));
    board.place("dp2", "phys", 1, 1, "both");

    // t1's day already starts at P1 in dp2 — a dp1 hour at P10 would span 10.
    expect(board.fitsAt("dp1", math, 1, 10)).toBeNull();
    expect(board.fitsAt("dp1", math, 1, 8)).toBe("both");
  });

  it("tolerates a pin-caused over-long day rather than poisoning every placement in it (delta)", () => {
    const eng = hours("eng", "t1");
    const board = boardOf([math, phys, eng]);
    // A dirty board handed over by the author: t1 is already pinned across a 10-period day.
    board.place("dp1", "math", 1, 1, "both", true);
    board.place("dp1", "phys", 1, 10, "both", true);

    // The candidate does not WORSEN the span (it is already 10) — it must still be placeable.
    expect(board.fitsAt("dp1", eng, 1, 5)).toBe("both");
  });
});
