import { z } from "zod";

/**
 * Single source of truth for teacher validation, imported by both the Astro Actions
 * (`input` — the authoritative server gate) and the react-hook-form resolvers.
 */

export const teacherInput = z.object({
  code: z.string().trim().min(1, "Code is required"),
  fullName: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
});

export const updateTeacherInput = teacherInput.extend({
  id: z.uuid(),
});

export const deleteTeacherInput = z.object({
  id: z.uuid(),
});

/** Raw form field shape before Zod transforms — what the RHF form holds. */
export type TeacherFormValues = z.input<typeof teacherInput>;
/** Parsed shape after transforms — what the action receives and the client submits. */
export type TeacherInput = z.output<typeof teacherInput>;
export type UpdateTeacherInput = z.infer<typeof updateTeacherInput>;
export type DeleteTeacherInput = z.infer<typeof deleteTeacherInput>;
