import { shelveCourses as shelveCoursesDomain, type ShelveCoursesInput } from "@/_pages/plan-detail/api/shelf";
import type { SupabaseClient } from "@/shared/api";

/** Caller-facing input: the courses to park, by id. */
export type ShelveCoursesFactoryInput = Omit<ShelveCoursesInput, "members"> & { courseIds: string[] };

/**
 * Produce a parked shelf bundle (a `shelf_bundles` row and its `shelf_bundle_courses`) by driving
 * the real `shelveCourses` domain function (the `shelve_courses` RPC), so the shelf is written by
 * the code under test. Every member parks on `both` weeks and is not optional, so call sites stay
 * agnostic of both axes.
 */
export function shelveCourses(supabase: SupabaseClient, input: ShelveCoursesFactoryInput) {
  const { courseIds, ...target } = input;
  return shelveCoursesDomain(supabase, {
    ...target,
    members: courseIds.map((courseId) => ({ courseId, week: "both", isOptional: false })),
  });
}
