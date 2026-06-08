import { z } from "zod";

/**
 * Single source of truth for catalog validation, imported by both the Astro Actions
 * (`input` — the authoritative server gate) and the react-hook-form resolvers.
 *
 * These schemas encode app-layer rules the DB deliberately does NOT enforce
 * (lessons: "port the mechanism, not the legacy type shape"):
 *   - `teacherId` is required here, but `courses.teacher_id` is nullable in the DB.
 * `level` is optional free text (matching the permissive `courses.level` column) so
 * composite merge-parent levels (`AB+SL`, …) round-trip through the editor; an empty
 * level normalizes to `"none"`. `hoursPerWeek` mirrors the DB `check (hours_per_week >= 0)`
 * so 0-hour merge children remain editable.
 */

/** IB group index. 0 is the "none" sentinel; 1–3 are the authorable groups. */
export const COURSE_GROUP_INDICES = [0, 1, 2, 3] as const;

export const courseInput = z.object({
  name: z.string().trim().min(1, "Name is required"),
  // Optional: an empty level means "none".
  level: z
    .string()
    .trim()
    .transform((value) => (value.length > 0 ? value : "none")),
  groupIndex: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  hoursPerWeek: z.int().min(0, "Weekly hours cannot be negative"),
  cohortId: z.uuid(),
  // Stricter than the nullable DB column: a course must have a teacher.
  teacherId: z.uuid("A teacher is required"),
});

export const updateCourseInput = courseInput.extend({
  id: z.uuid(),
});

export const overlapInput = z
  .object({
    baseCourseId: z.uuid(),
    dependentCourseId: z.uuid(),
  })
  // A course cannot overlap itself.
  .refine((value) => value.baseCourseId !== value.dependentCourseId, {
    message: "A course cannot overlap itself",
    path: ["baseCourseId"],
  });

/**
 * Authoritative input contract for `createMerge`, shared between the action gate and
 * the builder dialog's resolver. Carries only the raw author inputs; the parent's
 * derived fields (name, level, teacher) are computed server-side from the children
 * (via `deriveMergeParent`) to prevent client spoofing. `cohortId` is carried only to
 * assert against the children-derived cohort — never trusted as the parent's cohort.
 */
export const mergeInput = z.object({
  childCourseIds: z.array(z.uuid()).min(2, "Select at least 2 courses to merge"),
  hoursPerWeek: z.int().min(0, "Weekly hours cannot be negative"),
  cohortId: z.uuid(),
});

export const deleteCourseInput = z.object({ id: z.uuid() });

export const deleteOverlapInput = z.object({ baseCourseId: z.uuid(), dependentCourseId: z.uuid() });

export const dissolveMergeInput = z.object({ parentCourseId: z.uuid() });

export const updateMergeHoursInput = z.object({
  parentCourseId: z.uuid(),
  hoursPerWeek: z.int().min(0, "Weekly hours cannot be negative"),
});

export type CourseInput = z.infer<typeof courseInput>;
export type UpdateCourseInput = z.infer<typeof updateCourseInput>;
export type OverlapInput = z.infer<typeof overlapInput>;
export type MergeInput = z.infer<typeof mergeInput>;
export type DeleteCourseInput = z.infer<typeof deleteCourseInput>;
export type DeleteOverlapInput = z.infer<typeof deleteOverlapInput>;
export type DissolveMergeInput = z.infer<typeof dissolveMergeInput>;
export type UpdateMergeHoursInput = z.infer<typeof updateMergeHoursInput>;
