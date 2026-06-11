import { describe, expect, it } from "vitest";
import { deleteStudentInput, studentInput, updateStudentInput } from "./schemas";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const PLAN_ID = "33333333-3333-4333-8333-333333333333";

const validStudent = {
  planId: PLAN_ID,
  fullName: "Alice Parker",
  cohort: "dp1" as const,
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

  it("rejects an unknown cohort value", () => {
    expect(studentInput.safeParse({ ...validStudent, cohort: "dp3" }).success).toBe(false);
  });

  it("rejects a missing planId", () => {
    const { planId: _omit, ...withoutPlan } = validStudent;
    expect(studentInput.safeParse(withoutPlan).success).toBe(false);
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

  it("dedupes repeated choice ids", () => {
    const choiceCourseIds = [UUID_A, UUID_B, UUID_A];
    expect(studentInput.parse({ ...validStudent, choiceCourseIds }).choiceCourseIds).toEqual([UUID_A, UUID_B]);
  });

  it("rejects more than 64 choices", () => {
    const choiceCourseIds = Array.from({ length: 65 }, (_, i) => UUID_A.replace("8111", `8${String(100 + i)}`));
    expect(studentInput.safeParse({ ...validStudent, choiceCourseIds }).success).toBe(false);
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
  it("accepts a valid plan + id pair", () => {
    expect(deleteStudentInput.safeParse({ planId: PLAN_ID, id: UUID_A }).success).toBe(true);
  });

  it("rejects a missing id", () => {
    expect(deleteStudentInput.safeParse({ planId: PLAN_ID }).success).toBe(false);
  });

  it("rejects a missing planId", () => {
    expect(deleteStudentInput.safeParse({ id: UUID_A }).success).toBe(false);
  });
});
