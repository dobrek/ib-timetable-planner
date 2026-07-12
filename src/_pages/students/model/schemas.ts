import { z } from "zod";
import { cohortSchema } from "@/shared/config";

/**
 * Single source of truth for student validation, imported by both the Astro Actions
 * (`input` — the authoritative server gate) and the react-hook-form resolvers.
 * Every mutation carries `planId` — students are plan-owned.
 */

export const studentInput = z.object({
  planId: z.uuid(),
  fullName: z.string().trim().min(1, "Name is required"),
  cohort: cohortSchema,
  // The student's full course-choice set. Empty is valid (no min/max choice count — decided).
  // The server independently re-checks every id belongs to the plan + cohort (assertChoicesInCohort).
  // Deduped + bounded: the MultiSelect can't produce duplicates or 64+ picks, but a crafted
  // call could — a duplicate would hit the UNIQUE constraint as a 500 instead of failing here.
  choiceCourseIds: z
    .array(z.uuid())
    .max(64, "Too many choices")
    .default([])
    .transform((ids) => [...new Set(ids)]),
});

export const updateStudentInput = studentInput.extend({
  id: z.uuid(),
});

/** One deduped, bounded course-id set — the add and remove pickers share this shape (modeled on `choiceCourseIds`). */
const bulkCourseIds = z
  .array(z.uuid())
  .max(64, "Too many courses")
  .default([])
  .transform((ids) => [...new Set(ids)]);

/**
 * Bulk course-choice edit across a selected student set — shared by the action `input`
 * (authoritative server gate) and the RHF resolver. Either picker may be used alone, but
 * not both empty, and no course may be both added and removed. The server independently
 * re-checks students + add-courses against plan + cohort (assertStudentsInCohort /
 * assertChoicesInCohort); the atomic RPC applies the whole set or nothing.
 */
export const bulkChoiceInput = z
  .object({
    planId: z.uuid(),
    cohort: cohortSchema,
    studentIds: z.array(z.uuid()).min(1, "Select at least one student").max(500, "Too many students selected"),
    addCourseIds: bulkCourseIds,
    removeCourseIds: bulkCourseIds,
  })
  .refine((v) => v.addCourseIds.length + v.removeCourseIds.length > 0, {
    message: "Pick at least one course to add or remove",
    path: ["addCourseIds"],
  })
  .refine((v) => !v.addCourseIds.some((id) => v.removeCourseIds.includes(id)), {
    message: "A course can't be both added and removed",
    path: ["removeCourseIds"],
  });

export const deleteStudentInput = z.object({
  planId: z.uuid(),
  id: z.uuid(),
});

/** Raw form field shape before Zod transforms — what the RHF form holds. */
export type StudentFormValues = z.input<typeof studentInput>;
/** Parsed shape after transforms — what the action receives and the client submits. */
export type StudentInput = z.output<typeof studentInput>;
export type UpdateStudentInput = z.output<typeof updateStudentInput>;
export type DeleteStudentInput = z.infer<typeof deleteStudentInput>;
/** Raw bulk-edit field shape before transforms — what the RHF form holds. */
export type BulkChoiceFormValues = z.input<typeof bulkChoiceInput>;
/** Parsed bulk-edit shape after transforms — what the action receives and the client submits. */
export type BulkChoiceInput = z.output<typeof bulkChoiceInput>;
