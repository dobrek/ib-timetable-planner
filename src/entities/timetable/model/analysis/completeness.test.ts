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

    expect(deriveCompleteness(rows, [chemistry], [])).toMatchObject({ unplacedHours: 0, unplaced: [] });
  });

  it("reports the missing hours per course — the number a slot count must never be printed without", () => {
    const rows = block("dp1", "chem", 1, 9, 2);

    expect(deriveCompleteness(rows, [chemistry, advisory], [])).toMatchObject({
      unplacedHours: 5,
      unplaced: [
        { courseId: "chem", missing: 4 },
        { courseId: "advisory", missing: 1 },
      ],
    });
  });

  it("reports over-placed hours beside the shortfall, never netted against it", () => {
    // The gold plan's dp1 Chemistry shape: the expert places 6 hours on a course the catalog says
    // needs 2 (its overlap base carries no direct enrolments), while Advisory's hour goes missing.
    // "4 over, 1 short" — not "3 net".
    const twoHourChem = analyzed(course("chem", "OT", ["s1"]), { name: "Chemistry", level: "HL", hours: 2 });
    const rows = [...block("dp1", "chem", 1, 9, 2), ...block("dp1", "chem", 2, 1, 2), ...block("dp1", "chem", 4, 7, 2)];

    expect(deriveCompleteness(rows, [twoHourChem, advisory], [])).toMatchObject({
      unplacedHours: 1,
      overplacedHours: 4,
      overplaced: [{ courseId: "chem", placed: 6, required: 2 }],
    });
  });

  it("counts a placed row whose course never entered the projection", () => {
    // A dropped overlap base leaves rows nobody can account for — invisible to every join, so the
    // count is surfaced rather than lost.
    const rows = [...block("dp1", "chem", 1, 9, 6), ...block("dp1", "ghost", 3, 1, 2)];

    expect(deriveCompleteness(rows, [chemistry], [])).toMatchObject({ uncataloguedRows: 2 });
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
