import type { SupabaseClient } from "@/shared/api";
import { unwrapRow } from "@/shared/lib/postgrest";
import type { UpdateCourseInput } from "../model/schemas";
import { DUPLICATE_COURSE_MESSAGE } from "./constants";
import { toCourseRecord } from "./course-record";

/** Update an existing atomic course by id. */
export const updateCourse = async (supabase: SupabaseClient, input: UpdateCourseInput) =>
  unwrapRow(await supabase.from("courses").update(toCourseRecord(input)).eq("id", input.id).select().single(), {
    conflict: DUPLICATE_COURSE_MESSAGE,
    notFound: "Course not found.",
    failure: "Failed to update course",
  });
