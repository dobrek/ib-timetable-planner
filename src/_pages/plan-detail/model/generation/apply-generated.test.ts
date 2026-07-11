import { describe, expect, it } from "vitest";
import type { GeneratedPlacement } from "@/entities/timetable";
import type { AffectedSlice } from "../history/history-entry";
import { buildGeneratedSegments, buildRegionPayload, generationHistoryEntry } from "./apply-generated";

const gen = (cohort: "dp1" | "dp2", courseId: string, day: number, period: number): GeneratedPlacement => ({
  cohort,
  courseId,
  day,
  period,
  week: "both",
});

const pinSlice: AffectedSlice = {
  placements: [{ id: "pin-1", courseId: "pin", day: 1, period: 1, week: "a", isOptional: true }],
  cards: [],
};
const emptySlice: AffectedSlice = { placements: [], cards: [] };

let nextId = 0;
const tempId = () => `tmp-${nextId++}`;

describe("buildGeneratedSegments", () => {
  it("builds one segment per cohort with rows, deduping cells and staging entries", () => {
    const segments = buildGeneratedSegments(
      [gen("dp1", "a", 1, 1), gen("dp1", "b", 1, 1), gen("dp2", "c", 2, 3)],
      (cohort) => (cohort === "dp1" ? pinSlice : emptySlice),
      tempId,
    );

    expect(segments).toHaveLength(2);
    expect(segments[0].cohort).toBe("dp1");
    expect(segments[0].scope.cells).toEqual(["1:1"]);
    expect(segments[0].before).toBe(pinSlice);
    expect(segments[0].entries.map(({ spec }) => spec.courseId)).toEqual(["a", "b"]);
    expect(segments[1].cohort).toBe("dp2");
    expect(segments[1].scope.cells).toEqual(["2:3"]);
  });

  it("skips a cohort with nothing generated", () => {
    const segments = buildGeneratedSegments([gen("dp2", "c", 2, 3)], () => emptySlice, tempId);

    expect(segments.map((segment) => segment.cohort)).toEqual(["dp2"]);
  });
});

describe("buildRegionPayload", () => {
  it("tags cells per cohort and lists existing rows (live week/flag) before generated rows", () => {
    const segments = buildGeneratedSegments(
      [gen("dp1", "a", 1, 1), gen("dp2", "c", 2, 3)],
      (cohort) => (cohort === "dp1" ? pinSlice : emptySlice),
      tempId,
    );

    const payload = buildRegionPayload(segments);

    expect(payload.cells).toEqual([
      { cohort: "dp1", day: 1, period: 1 },
      { cohort: "dp2", day: 2, period: 3 },
    ]);
    expect(payload.placements).toEqual([
      { cohort: "dp1", courseId: "pin", day: 1, period: 1, week: "a", isOptional: true },
      { cohort: "dp1", courseId: "a", day: 1, period: 1, week: "both", isOptional: false },
      { cohort: "dp2", courseId: "c", day: 2, period: 3, week: "both", isOptional: false },
    ]);
  });
});

describe("generationHistoryEntry", () => {
  it("records one entry whose sibling carries the second cohort (one undo press, both cohorts)", () => {
    const segments = buildGeneratedSegments([gen("dp1", "a", 1, 1), gen("dp2", "c", 2, 3)], () => emptySlice, tempId);

    const entry = generationHistoryEntry(segments);

    expect(entry).toMatchObject({ cohort: "dp1", label: "Generate plan" });
    expect(entry?.target).toBe(segments[0].before);
    expect(entry?.sibling).toMatchObject({ cohort: "dp2" });
  });

  it("omits the sibling for a single-cohort generation and is null for an empty one", () => {
    const single = generationHistoryEntry(buildGeneratedSegments([gen("dp2", "c", 2, 3)], () => emptySlice, tempId));
    expect(single?.cohort).toBe("dp2");
    expect(single?.sibling).toBeUndefined();

    expect(generationHistoryEntry([])).toBeNull();
  });
});
