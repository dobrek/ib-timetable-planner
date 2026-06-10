import { describe, expect, it } from "vitest";
import { deleteTeacherInput, teacherInput, updateTeacherInput } from "./schemas";

const UUID_A = "11111111-1111-4111-8111-111111111111";

const validTeacher = {
  code: "AP",
  fullName: "Alice Parker",
};

describe("teacherInput", () => {
  it("accepts a valid teacher with full name", () => {
    expect(teacherInput.parse(validTeacher)).toEqual(validTeacher);
  });

  it("trims the code", () => {
    expect(teacherInput.parse({ ...validTeacher, code: "  ZZ  " }).code).toBe("ZZ");
  });

  it("rejects an empty code", () => {
    expect(teacherInput.safeParse({ ...validTeacher, code: "   " }).success).toBe(false);
  });

  it("accepts a teacher without fullName", () => {
    expect(teacherInput.parse({ code: "AP" })).toEqual({ code: "AP", fullName: undefined });
  });

  it("normalizes empty/blank fullName to undefined", () => {
    expect(teacherInput.parse({ code: "AP", fullName: "  " }).fullName).toBeUndefined();
  });

  it("trims fullName", () => {
    expect(teacherInput.parse({ code: "AP", fullName: "  Jane  " }).fullName).toBe("Jane");
  });
});

describe("updateTeacherInput", () => {
  it("accepts a valid teacher with an id", () => {
    expect(updateTeacherInput.safeParse({ ...validTeacher, id: UUID_A }).success).toBe(true);
  });

  it("rejects a missing id", () => {
    expect(updateTeacherInput.safeParse(validTeacher).success).toBe(false);
  });
});

describe("deleteTeacherInput", () => {
  it("accepts a valid id", () => {
    expect(deleteTeacherInput.safeParse({ id: UUID_A }).success).toBe(true);
  });

  it("rejects a missing id", () => {
    expect(deleteTeacherInput.safeParse({}).success).toBe(false);
  });
});
