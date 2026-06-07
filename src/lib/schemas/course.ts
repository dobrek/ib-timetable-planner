import { z } from "zod";

/**
 * Single source of truth for catalog validation, imported by both the Astro Actions
 * (`input` — the authoritative server gate) and the react-hook-form resolvers.
 *
 * These schemas encode app-layer rules the DB deliberately does NOT enforce
 * (lessons: "port the mechanism, not the legacy type shape"):
 *   - `level` is a fixed atomic-course enum here, but the `courses.level` column is
 *     permissive text so composite merge-parent levels (`AB+SL`, …) stay legal.
 *   - `teacherId` is required here, but `courses.teacher_id` is nullable in the DB.
 *   - `hoursPerWeek >= 1` here, but the DB allows 0 for merge-child sentinel rows.
 * Atomic-course authoring is stricter than the storage layer by design.
 */

/** Atomic-course IB levels. Composite/merge levels live only in storage, never authored here. */
export const COURSE_LEVELS = ["SL", "HL", "AB", "none"] as const;

/** IB group index. 0 is the "none" sentinel; 1 and 2 are the authorable groups. */
export const COURSE_GROUP_INDICES = [0, 1, 2] as const;

export const courseInput = z.object({
  name: z.string().trim().min(1, "Name is required"),
  level: z.enum(COURSE_LEVELS),
  groupIndex: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  // 0 is the merge-child sentinel (not authorable here); atomic courses need >= 1 hour.
  hoursPerWeek: z.int().min(1, "Weekly hours must be at least 1"),
  cohortId: z.uuid(),
  // Stricter than the nullable DB column: an atomic course must have a teacher.
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

export type CourseInput = z.infer<typeof courseInput>;
export type UpdateCourseInput = z.infer<typeof updateCourseInput>;
export type OverlapInput = z.infer<typeof overlapInput>;
