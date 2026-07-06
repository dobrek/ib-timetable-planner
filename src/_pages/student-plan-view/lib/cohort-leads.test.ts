import { describe, expect, it } from "vitest";
import type { StudentSummary } from "../api/loader";
import { cohortLeads } from "./cohort-leads";

const student = (id: string, fullName: string, cohort: StudentSummary["cohort"]): StudentSummary => ({
  id,
  fullName,
  cohort,
});

describe("cohortLeads", () => {
  it("returns the first student of each cohort when both are populated", () => {
    const students = [
      student("a", "Ada", "dp1"),
      student("b", "Bo", "dp2"),
      student("c", "Cy", "dp1"),
      student("d", "Di", "dp2"),
    ];

    const leads = cohortLeads(students);

    expect(leads.dp1?.id).toBe("a");
    expect(leads.dp2?.id).toBe("b");
  });

  it("preserves input order rather than re-sorting", () => {
    // Input is deliberately not name-sorted; the helper must trust the order it is given.
    const students = [student("z", "Zoe", "dp1"), student("a", "Ada", "dp1")];

    expect(cohortLeads(students).dp1?.id).toBe("z");
  });

  it("yields undefined for a cohort with no students (single-cohort list)", () => {
    const leads = cohortLeads([student("a", "Ada", "dp1")]);

    expect(leads.dp1?.id).toBe("a");
    expect(leads.dp2).toBeUndefined();
  });

  it("yields undefined for both cohorts on an empty list", () => {
    const leads = cohortLeads([]);

    expect(leads.dp1).toBeUndefined();
    expect(leads.dp2).toBeUndefined();
  });
});
