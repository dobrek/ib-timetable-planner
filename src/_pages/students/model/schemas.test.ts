import { describe, expect, it } from "vitest";
import { deleteStudentInput, studentInput, updateStudentInput } from "./schemas";

const UUID_A = "11111111-1111-4111-8111-111111111111";

const validStudent = {
  fullName: "Alice Parker",
  cohortId: UUID_A,
};

describe("studentInput", () => {
  it("accepts a valid student", () => {
    expect(studentInput.parse(validStudent)).toEqual(validStudent);
  });

  it("trims the full name", () => {
    expect(studentInput.parse({ ...validStudent, fullName: "  Bob  " }).fullName).toBe("Bob");
  });

  it("rejects an empty full name", () => {
    expect(studentInput.safeParse({ ...validStudent, fullName: "   " }).success).toBe(false);
  });

  it("rejects a non-uuid cohort id", () => {
    expect(studentInput.safeParse({ ...validStudent, cohortId: "not-a-uuid" }).success).toBe(false);
  });
});

describe("updateStudentInput", () => {
  it("accepts a valid student with an id", () => {
    expect(updateStudentInput.safeParse({ ...validStudent, id: UUID_A }).success).toBe(true);
  });

  it("rejects a missing id", () => {
    expect(updateStudentInput.safeParse(validStudent).success).toBe(false);
  });
});

describe("deleteStudentInput", () => {
  it("accepts a valid id", () => {
    expect(deleteStudentInput.safeParse({ id: UUID_A }).success).toBe(true);
  });

  it("rejects a missing id", () => {
    expect(deleteStudentInput.safeParse({}).success).toBe(false);
  });
});
