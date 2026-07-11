import { describe, expect, it } from "vitest";
import { course, placement } from "../__fixtures__/builders";
import { deriveGenerationDeficits } from "./deficits";

// `course()` fixes hours at 4; override where a case needs a different requirement.
const withHours = (id: string, hours: number) => ({ ...course(id, "t1"), hours });

describe("deriveGenerationDeficits", () => {
  it("reports required minus placed for a course with board rows", () => {
    const catalog = [withHours("math", 4)];
    const placements = [placement("p1", "math", 1, 1), placement("p2", "math", 2, 1)];

    expect(deriveGenerationDeficits(placements, catalog, [])).toEqual([{ courseId: "math", missing: 2 }]);
  });

  it("subtracts parked coverage per member entry (multiset)", () => {
    const catalog = [withHours("math", 4)];

    expect(deriveGenerationDeficits([], catalog, ["math", "math"])).toEqual([{ courseId: "math", missing: 2 }]);
  });

  it("drops a course whose deficit is fully covered by parked members", () => {
    const catalog = [withHours("math", 2), withHours("eng", 2)];

    expect(deriveGenerationDeficits([], catalog, ["math", "math"])).toEqual([{ courseId: "eng", missing: 2 }]);
  });

  it("clamps at zero per course — over-parking never nets against another course's deficit", () => {
    const catalog = [withHours("math", 1), withHours("eng", 2)];

    expect(deriveGenerationDeficits([], catalog, ["math", "math", "math"])).toEqual([{ courseId: "eng", missing: 2 }]);
  });

  it("ignores parked entries for unknown or non-deficit courses", () => {
    const catalog = [withHours("math", 2)];
    const placements = [placement("p1", "math", 1, 1), placement("p2", "math", 2, 1)];

    expect(deriveGenerationDeficits(placements, catalog, ["ghost", "math"])).toEqual([]);
  });

  it("never reports a 0-hour merge-child or an over-placed course", () => {
    const catalog = [withHours("merge-child", 0), withHours("eng", 1)];
    const placements = [placement("p1", "eng", 1, 1), placement("p2", "eng", 2, 1)];

    expect(deriveGenerationDeficits(placements, catalog, [])).toEqual([]);
  });
});
