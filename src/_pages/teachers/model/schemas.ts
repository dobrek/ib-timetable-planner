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

export type TeacherInput = z.infer<typeof teacherInput>;
export type UpdateTeacherInput = z.infer<typeof updateTeacherInput>;
export type DeleteTeacherInput = z.infer<typeof deleteTeacherInput>;
