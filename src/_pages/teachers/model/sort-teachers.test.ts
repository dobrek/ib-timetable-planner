import { describe, expect, it } from "vitest";
import { sortTeachers } from "./sort-teachers";
import type { TeacherRow } from "./teacher";

const teacher = (id: string, code: string, fullName: string | null): TeacherRow => ({
  id,
  code,
  fullName,
  assignments: [],
});

describe("sortTeachers", () => {
  it("orders by full name case-insensitively", () => {
    const rows = [teacher("t1", "ZZ", "zoe Adams"), teacher("t2", "AA", "Ben Brown")];
    expect(sortTeachers(rows).map((t) => t.id)).toEqual(["t2", "t1"]);
  });

  it("puts teachers without a name last", () => {
    const rows = [teacher("t1", "AA", null), teacher("t2", "ZZ", "Zoe Adams")];
    expect(sortTeachers(rows).map((t) => t.id)).toEqual(["t2", "t1"]);
  });

  it("breaks name ties by code", () => {
    const rows = [teacher("t1", "BB", null), teacher("t2", "AA", null)];
    expect(sortTeachers(rows).map((t) => t.id)).toEqual(["t2", "t1"]);
  });

  it("does not mutate its input", () => {
    const rows = [teacher("t1", "BB", null), teacher("t2", "AA", null)];
    sortTeachers(rows);
    expect(rows.map((t) => t.id)).toEqual(["t1", "t2"]);
  });
});
