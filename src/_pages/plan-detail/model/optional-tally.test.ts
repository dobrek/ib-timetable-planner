import { describe, expect, it } from "vitest";
import { placement } from "@/entities/timetable";
import { deriveOptionalTally } from "./optional-tally";

const optional = (id: string, courseId: string, day: number, period: number) => ({
  ...placement(id, courseId, day, period),
  isOptional: true,
});

describe("deriveOptionalTally", () => {
  it("returns an empty tally when nothing is optional", () => {
    expect(deriveOptionalTally([placement("p1", "A", 1, 1)])).toEqual({ optionalByCourse: [], optionalCount: 0 });
  });

  it("counts optional placements per course and in total", () => {
    const tally = deriveOptionalTally([
      optional("p1", "A", 1, 1),
      optional("p2", "A", 2, 2),
      optional("p3", "B", 3, 3),
      placement("p4", "B", 4, 4),
    ]);
    expect(tally.optionalByCourse).toEqual(
      expect.arrayContaining([
        { courseId: "A", count: 2 },
        { courseId: "B", count: 1 },
      ]),
    );
    expect(tally.optionalByCourse).toHaveLength(2);
    expect(tally.optionalCount).toBe(3);
  });

  it("keeps the headline total equal to the sum of the per-course counts (single derivation)", () => {
    const tally = deriveOptionalTally([optional("p1", "A", 1, 1), optional("p2", "B", 2, 2)]);
    expect(tally.optionalCount).toBe(tally.optionalByCourse.reduce((sum, row) => sum + row.count, 0));
  });
});
