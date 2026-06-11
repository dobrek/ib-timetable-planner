import { describe, expect, it } from "vitest";
import { deleteStudentInput, studentInput, updateStudentInput } from "./schemas";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

const validStudent = {
  fullName: "Alice Parker",
  cohortId: UUID_A,
};

describe("studentInput", () => {
  it("accepts a valid student", () => {
    expect(studentInput.parse(validStudent)).toEqual({ ...validStudent, choiceCourseIds: [] });
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

  it("defaults choiceCourseIds to an empty array when omitted", () => {
    expect(studentInput.parse(validStudent).choiceCourseIds).toEqual([]);
  });

  it("accepts a set of uuid choices", () => {
    const choiceCourseIds = [UUID_A, UUID_B];
    expect(studentInput.parse({ ...validStudent, choiceCourseIds }).choiceCourseIds).toEqual(choiceCourseIds);
  });

  it("rejects a non-uuid choice id", () => {
    expect(studentInput.safeParse({ ...validStudent, choiceCourseIds: ["not-a-uuid"] }).success).toBe(false);
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
