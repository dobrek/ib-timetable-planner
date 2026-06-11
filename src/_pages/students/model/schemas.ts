import { z } from "zod";

/**
 * Single source of truth for student validation, imported by both the Astro Actions
 * (`input` — the authoritative server gate) and the react-hook-form resolvers.
 */

export const studentInput = z.object({
  fullName: z.string().trim().min(1, "Name is required"),
  cohortId: z.uuid(),
  // The student's full course-choice set. Empty is valid (no min/max choice count — decided).
  // The server independently re-checks every id belongs to `cohortId` (assertChoicesInCohort).
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

export const deleteStudentInput = z.object({
  id: z.uuid(),
});

/** Raw form field shape before Zod transforms — what the RHF form holds. */
export type StudentFormValues = z.input<typeof studentInput>;
/** Parsed shape after transforms — what the action receives and the client submits. */
export type StudentInput = z.output<typeof studentInput>;
export type UpdateStudentInput = z.infer<typeof updateStudentInput>;
export type DeleteStudentInput = z.infer<typeof deleteStudentInput>;
