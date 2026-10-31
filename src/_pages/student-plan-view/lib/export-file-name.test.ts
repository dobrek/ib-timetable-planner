import { describe, expect, it } from "vitest";
import { studentExportFileName } from "./export-file-name";

describe("studentExportFileName", () => {
  it("assembles <plan-slug>-<cohort>-<student-slug>.xlsx", () => {
    expect(studentExportFileName("IB 2027 draft", false, "dp1", "Jan Kowalski")).toBe(
      "ib-2027-draft-dp1-jan-kowalski.xlsx",
    );
  });

  it("marks the current plan between the plan slug and the cohort", () => {
    expect(studentExportFileName("IB 2027 draft", true, "dp1", "Jan Kowalski")).toBe(
      "ib-2027-draft-current-dp1-jan-kowalski.xlsx",
    );
  });

  it("interpolates the cohort literal verbatim and slugifies both name segments", () => {
    expect(studentExportFileName("IB 2027", false, "dp2", "Anna Nowak")).toBe("ib-2027-dp2-anna-nowak.xlsx");
  });

  it("folds diacritics in the student name", () => {
    expect(studentExportFileName("IB 2027", false, "dp1", "Paweł Głąb")).toBe("ib-2027-dp1-pawel-glab.xlsx");
  });

  it("falls back to 'plan' for a name with no alphanumerics", () => {
    expect(studentExportFileName("", false, "dp1", "!!!")).toBe("plan-dp1-plan.xlsx");
  });
});
