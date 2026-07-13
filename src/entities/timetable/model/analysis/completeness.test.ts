import { describe, expect, it } from "vitest";
import { course } from "../__fixtures__/builders";
import { deriveGenerationDeficits } from "../generation/deficits";
import { analyzed, block } from "./__fixtures__/builders";
import { deriveCompleteness } from "./completeness";

// `hours` is explicit throughout: the shared builders' `hours: 4` default is inert for the collision
// rules but load-bearing here — completeness IS the hours arithmetic.
const chemistry = analyzed(course("chem", "OT", ["s1"]), { name: "Chemistry", level: "HL", hours: 6 });
const advisory = analyzed(course("advisory", "KK", ["s1"]), { name: "Advisory", hours: 1 });

describe("deriveCompleteness", () => {
  it("reports zero unplaced hours for a fully placed cohort", () => {
    const rows = [...block("dp1", "chem", 1, 9, 2), ...block("dp1", "chem", 2, 1, 2), ...block("dp1", "chem", 4, 7, 2)];

    expect(deriveCompleteness(rows, [chemistry], [])).toEqual({ unplacedHours: 0, unplaced: [] });
  });

  it("reports the missing hours per course — the number a slot count must never be printed without", () => {
    // The engine's real dp1 failure: 2 of Chemistry HL's 6 hours placed, 4 abandoned.
    const rows = block("dp1", "chem", 1, 9, 2);

    expect(deriveCompleteness(rows, [chemistry, advisory], [])).toEqual({
      unplacedHours: 5,
      unplaced: [
        { courseId: "chem", missing: 4 },
        { courseId: "advisory", missing: 1 },
      ],
    });
  });

  it("counts a parked bundle member as covering one of its course's hours", () => {
    const rows = block("dp1", "chem", 1, 9, 2);

    expect(deriveCompleteness(rows, [chemistry], ["chem", "chem"])).toMatchObject({ unplacedHours: 2 });
  });

  it("means exactly what the generator means by unplaced", () => {
    const rows = block("dp1", "chem", 1, 9, 3);

    const wrapped = deriveCompleteness(rows, [chemistry, advisory], ["chem"]);
    const generator = deriveGenerationDeficits(
      rows.map((row, index) => ({ ...row, id: `p${index}`, isOptional: false })),
      [chemistry, advisory],
      ["chem"],
    );

    expect(wrapped.unplaced).toEqual(generator);
  });
});
