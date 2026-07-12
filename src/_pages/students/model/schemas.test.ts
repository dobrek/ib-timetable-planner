import { describe, expect, it } from "vitest";
import { bulkChoiceInput, deleteStudentInput, studentInput, updateStudentInput } from "./schemas";

const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";
const PLAN_ID = "33333333-3333-4333-8333-333333333333";
const STUDENT_ID = "44444444-4444-4444-8444-444444444444";

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

describe("bulkChoiceInput", () => {
  const validBulk = {
    planId: PLAN_ID,
    cohort: "dp1" as const,
    studentIds: [STUDENT_ID],
    addCourseIds: [UUID_A],
    removeCourseIds: [],
  };

  it("accepts an add-only edit", () => {
    expect(bulkChoiceInput.safeParse(validBulk).success).toBe(true);
  });

  it("accepts a remove-only edit", () => {
    expect(bulkChoiceInput.safeParse({ ...validBulk, addCourseIds: [], removeCourseIds: [UUID_B] }).success).toBe(true);
  });

  it("defaults both course sets to empty arrays when omitted (then fails the empty-both refinement)", () => {
    const { addCourseIds: _a, removeCourseIds: _r, ...noCourses } = validBulk;
    const result = bulkChoiceInput.safeParse(noCourses);
    expect(result.success).toBe(false);
  });

  it("rejects an empty student selection", () => {
    expect(bulkChoiceInput.safeParse({ ...validBulk, studentIds: [] }).success).toBe(false);
  });

  it("rejects when neither picker has a course (empty-both refinement, anchored to addCourseIds)", () => {
    const result = bulkChoiceInput.safeParse({ ...validBulk, addCourseIds: [], removeCourseIds: [] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "addCourseIds")).toBe(true);
    }
  });

  it("rejects a course that is both added and removed (overlap refinement, anchored to removeCourseIds)", () => {
    const result = bulkChoiceInput.safeParse({ ...validBulk, addCourseIds: [UUID_A], removeCourseIds: [UUID_A] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".") === "removeCourseIds")).toBe(true);
    }
  });

  it("dedupes repeated ids in both course sets", () => {
    const parsed = bulkChoiceInput.parse({
      ...validBulk,
      addCourseIds: [UUID_A, UUID_A],
      removeCourseIds: [UUID_B, UUID_B],
    });
    expect(parsed.addCourseIds).toEqual([UUID_A]);
    expect(parsed.removeCourseIds).toEqual([UUID_B]);
  });
});
