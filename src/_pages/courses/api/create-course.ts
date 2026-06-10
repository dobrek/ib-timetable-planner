import type { SupabaseClient } from "@/shared/api";
import { unwrapRow } from "@/shared/lib/postgrest";
import type { CourseInput } from "../model/schemas";
import { DUPLICATE_COURSE_MESSAGE } from "./constants";
import { toCourseRecord } from "./course-record";

/** Insert a single atomic course. */
export const createCourse = async (supabase: SupabaseClient, input: CourseInput) =>
  unwrapRow(await supabase.from("courses").insert(toCourseRecord(input)).select().single(), {
    conflict: DUPLICATE_COURSE_MESSAGE,
    failure: "Failed to create course",
  });
