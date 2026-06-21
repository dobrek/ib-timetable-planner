import { z } from "zod";
import { cohortSchema } from "@/shared/config";
import { LEVEL_NONE } from "./course";

/**
 * Single source of truth for catalog validation, imported by both the Astro Actions
 * (`input` — the authoritative server gate) and the react-hook-form resolvers.
 *
 * Every mutation carries `planId` — the catalog is plan-owned, and the domain
 * functions insert/guard within that plan (composite FKs backstop them).
 *
 * These schemas encode app-layer rules the DB deliberately does NOT enforce:
 *   - `teacherIds` requires at least one teacher here; the DB has no ≥1 trigger (the
 *     invariant is app-enforced: this `.min(1)`, the delete-guard, and the seed abort).
 * `level` is optional free text (matching the permissive `courses.level` column) so
 * composite merge-parent levels (`AB+SL`, …) round-trip through the editor; an empty
 * level normalizes to `"none"`. `hoursPerWeek` mirrors the DB `check (hours_per_week >= 0)`
 * so 0-hour merge children remain editable.
 */

/** IB group index. 0 is the "none" sentinel; 1–3 are the authorable groups. */
export const COURSE_GROUP_INDICES = [0, 1, 2, 3] as const;

export type CourseGroupIndex = (typeof COURSE_GROUP_INDICES)[number];

/** Whether a stored number is one of the authorable group indices. */
export const isCourseGroupIndex = (value: number): value is CourseGroupIndex =>
  (COURSE_GROUP_INDICES as readonly number[]).includes(value);

/** Coerce a stored group_index to one of the authorable options (defaults to 0 / none). */
export const toGroupIndex = (value: number): CourseGroupIndex => (isCourseGroupIndex(value) ? value : 0);

export const courseInput = z.object({
  planId: z.uuid(),
  name: z.string().trim().min(1, "Name is required"),
  // Optional: an empty level means "none".
  level: z
    .string()
    .trim()
    .transform((value) => (value.length > 0 ? value : LEVEL_NONE)),
  groupIndex: z.literal(COURSE_GROUP_INDICES),
  hoursPerWeek: z.int().min(0, "Weekly hours cannot be negative"),
  cohort: cohortSchema,
  // A course is co-taught by a set of one-or-more equal teachers (app-enforced ≥1).
  teacherIds: z.array(z.uuid()).min(1, "At least one teacher is required"),
});

export const updateCourseInput = courseInput.extend({
  id: z.uuid(),
});

export const overlapInput = z
  .object({
    planId: z.uuid(),
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
 * (via `deriveMergeParent`) to prevent client spoofing. `cohort` is carried only to
 * assert against the children-derived cohort — never trusted as the parent's cohort.
 */
export const mergeInput = z.object({
  planId: z.uuid(),
  childCourseIds: z.array(z.uuid()).min(2, "Select at least 2 courses to merge"),
  hoursPerWeek: z.int().min(0, "Weekly hours cannot be negative"),
  cohort: cohortSchema,
});

export const deleteCourseInput = z.object({ planId: z.uuid(), id: z.uuid() });

export const deleteOverlapInput = z.object({
  planId: z.uuid(),
  baseCourseId: z.uuid(),
  dependentCourseId: z.uuid(),
});

export const dissolveMergeInput = z.object({ planId: z.uuid(), parentCourseId: z.uuid() });

export const updateMergeHoursInput = z.object({
  planId: z.uuid(),
  parentCourseId: z.uuid(),
  hoursPerWeek: z.int().min(0, "Weekly hours cannot be negative"),
});

/** Raw form field shapes before Zod transforms — what the RHF forms hold. */
export type CourseFormValues = z.input<typeof courseInput>;
export type MergeFormValues = z.input<typeof mergeInput>;

export type CourseInput = z.output<typeof courseInput>;
export type UpdateCourseInput = z.infer<typeof updateCourseInput>;
export type OverlapInput = z.infer<typeof overlapInput>;
export type MergeInput = z.output<typeof mergeInput>;
export type DeleteCourseInput = z.infer<typeof deleteCourseInput>;
export type DeleteOverlapInput = z.infer<typeof deleteOverlapInput>;
export type DissolveMergeInput = z.infer<typeof dissolveMergeInput>;
export type UpdateMergeHoursInput = z.infer<typeof updateMergeHoursInput>;
