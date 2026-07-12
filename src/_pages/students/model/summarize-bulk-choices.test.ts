import { describe, expect, it } from "vitest";
import type { StudentRow } from "./student";
import { summarizeBulkChoices } from "./summarize-bulk-choices";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const student = (id: string, choiceCourseIds: string[]): StudentRow => ({
  id,
  cohort: "dp1",
  fullName: `Student ${id}`,
  choiceCourseIds,
});

describe("summarizeBulkChoices", () => {
  it("counts gains as the students currently missing each add-course", () => {
    // s1 has A, s2 has nothing, s3 has A — adding A gains only s2 (2 already hold it).
    const students = [student("1", [A]), student("2", []), student("3", [A])];
    const summary = summarizeBulkChoices(students, [A], []);
    expect(summary).toEqual({ studentCount: 3, adds: [{ courseId: A, gains: 1 }], removes: [] });
  });

  it("counts losses as the students currently holding each remove-course", () => {
    const students = [student("1", [B]), student("2", [B]), student("3", [])];
    const summary = summarizeBulkChoices(students, [], [B]);
    expect(summary).toEqual({ studentCount: 3, adds: [], removes: [{ courseId: B, losses: 2 }] });
  });

  it("preserves zero counts (all-already-have add, none-have remove) rather than filtering them out", () => {
    // Everyone already has A (0 gains); nobody has C (0 losses) — the story's assurance line.
    const students = [student("1", [A]), student("2", [A])];
    const summary = summarizeBulkChoices(students, [A], [C]);
    expect(summary.adds).toEqual([{ courseId: A, gains: 0 }]);
    expect(summary.removes).toEqual([{ courseId: C, losses: 0 }]);
  });

  it("handles mixed add + remove sets across several students", () => {
    const students = [student("1", [A, B]), student("2", [A]), student("3", [])];
    const summary = summarizeBulkChoices(students, [C], [B]);
    expect(summary).toEqual({
      studentCount: 3,
      adds: [{ courseId: C, gains: 3 }],
      removes: [{ courseId: B, losses: 1 }],
    });
  });

  it("returns empty add/remove lists and zero students for an empty selection", () => {
    expect(summarizeBulkChoices([], [], [])).toEqual({ studentCount: 0, adds: [], removes: [] });
  });
});
