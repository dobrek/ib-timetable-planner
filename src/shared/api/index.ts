import type { SupabaseClient as SupabaseClientGeneric } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export { createClient } from "./supabase";
export { isPlanId, isUuid, loadPlanSummary, type PlanSummary } from "./load-plan-summary";
export { loadCohortCourses } from "./load-cohort-courses";
export { loadPlacements } from "./load-placements";
export { loadTeacherAvailability } from "./load-teacher-availability";
export { loadTeacherNames } from "./load-teacher-names";
export { loadStudentNames } from "./load-student-names";
export { loadCourseMerges, type CourseMerge } from "./load-course-merges";
export {
  UNIQUE_VIOLATION,
  NOT_FOUND_ROW,
  unwrapRow,
  unwrapMaybeRow,
  unwrapMany,
  unwrapCompleted,
  assertNoQueryErrors,
} from "./postgrest";
export type { Database, Json } from "./database.types";

/** Canonical typed Supabase client alias — replaces per-module duplicates. */
export type SupabaseClient = SupabaseClientGeneric<Database>;
