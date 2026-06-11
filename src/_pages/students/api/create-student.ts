import type { SupabaseClient } from "@/shared/api";
import { unwrapRow } from "@/shared/lib/postgrest";
import type { StudentInput } from "../model/schemas";

/** Insert a student row. (Choices handling joins in Phase 2.) */
export const createStudent = async (supabase: SupabaseClient, input: StudentInput) =>
  unwrapRow(
    await supabase.from("students").insert({ cohort_id: input.cohortId, full_name: input.fullName }).select().single(),
    { failure: "Failed to create student" },
  );
