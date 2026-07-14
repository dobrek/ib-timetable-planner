import { describe, expect, it } from "vitest";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import { deriveGoldenSets, GOLDEN_BAND, GOLDEN_COVERAGE } from "./golden-sets";

/** A catalog course: `id`, its teachers, its roster — the only fields cover-set detection reads. */
const course = (
  id: string,
  teacherKeys: string[],
  studentKeys: string[],
  overrides: Partial<GroupingCourse> = {},
): GroupingCourse => ({
  id,
  hours: 2,
  weekMode: "agnostic",
  teacherKeys,
  studentKeys,
  ...overrides,
});

/** No finishes-early courses in these fixtures — the flagged-exclusion case has its own test. */
const NONE: ReadonlySet<string> = new Set();

describe("deriveGoldenSets", () => {
  it("finds the cover set behind the expert's English A + English B slot", () => {
    // Two courses, disjoint rosters, different teachers — together the whole cohort.
    const sets = deriveGoldenSets([course("en-a", ["t1"], ["s1", "s2"]), course("en-b", ["t2"], ["s3", "s4"])], NONE);
    expect(sets[0]).toEqual(new Set(["en-a", "en-b"]));
  });

  it("finds a composite of three courses", () => {
    const sets = deriveGoldenSets(
      [course("c1", ["t1"], ["s1", "s2"]), course("c2", ["t2"], ["s3"]), course("c3", ["t3"], ["s4"])],
      NONE,
    );
    expect(sets[0]).toEqual(new Set(["c1", "c2", "c3"]));
  });

  it("returns a single-course set when one course already covers the cohort (TOK)", () => {
    expect(deriveGoldenSets([course("tok", ["t1"], ["s1", "s2", "s3"])], NONE)[0]).toEqual(new Set(["tok"]));
  });

  it("never puts two courses sharing a student — or a teacher — in one set", () => {
    // c1/c2 share s2, c1/c3 share t1: neither pair can run in one cell, so no set reaches the cohort.
    const sets = deriveGoldenSets(
      [course("c1", ["t1"], ["s1", "s2"]), course("c2", ["t2"], ["s2", "s3"]), course("c3", ["t1"], ["s3"])],
      NONE,
    );
    expect(sets).toEqual([]);
  });

  it("drops a set that leaves too much of the cohort uncovered", () => {
    // The pair covers 2 of 4 students (50%) — under GOLDEN_COVERAGE, so it is not a golden slot.
    const roster = ["s1", "s2", "s3", "s4"];
    const sets = deriveGoldenSets(
      [
        course("c1", ["t1"], ["s1"]),
        course("c2", ["t2"], ["s2"]),
        course("lonely", ["t3"], roster.slice(2)), // shares nobody, but conflicts with nothing either
      ],
      NONE,
    );
    // c1 + c2 + lonely covers all four — the point is that partial sets alone would not have.
    expect(sets[0]).toEqual(new Set(["c1", "c2", "lonely"]));
    expect(GOLDEN_COVERAGE).toBe(0.9);
  });

  it("keeps a near-golden set — one student short of the cohort is still golden enough (G1)", () => {
    // 10 students; `wide` covers 9 of them, and the course holding the tenth shares its teacher, so
    // nothing can join `wide` in a cell. 90% coverage is exactly the tolerance — the set stands.
    const roster = Array.from({ length: 10 }, (_, i) => `s${i}`);
    const sets = deriveGoldenSets(
      [course("wide", ["t1"], roster.slice(0, 9)), course("absentee", ["t1"], roster.slice(9))],
      NONE,
    );
    expect(sets).toContainEqual(new Set(["wide"]));
  });

  it("excludes biweekly courses — a set built on one is golden in week A and hollow in week B", () => {
    const sets = deriveGoldenSets(
      [
        course("every-week", ["t1"], ["s1", "s2"]),
        course("fortnightly", ["t2"], ["s3", "s4"], { weekMode: "biweekly" }),
      ],
      NONE,
    );
    expect(sets).toEqual([]); // `every-week` alone covers half the roster — below the bar
  });

  it("drops flagged courses from the candidates but still counts their students in the roster", () => {
    // `tok` is finishes-early: it can never anchor a mid-day band, so it may not join a set — but its
    // students are cohort members, so `pair` covering only half of them is NOT a cover set. Handing
    // the detector a pre-filtered catalog would have hidden `tok`'s students and lowered the bar.
    const pair = course("pair", ["t1"], ["s1", "s2"]);
    const tok = course("tok", ["t2"], ["s3", "s4"]);

    expect(deriveGoldenSets([pair, tok], new Set(["tok"]))).toEqual([]);
    // Without the flag, the two together are exactly the expert's cover set.
    expect(deriveGoldenSets([pair, tok], NONE)[0]).toEqual(new Set(["pair", "tok"]));
  });

  it("returns no sets for an empty catalog", () => {
    expect(deriveGoldenSets([], NONE)).toEqual([]);
  });
});

describe("GOLDEN_BAND", () => {
  it("is the expert's mid-day band, P4–P7", () => {
    expect(GOLDEN_BAND).toEqual({ first: 4, last: 7 });
  });
});
