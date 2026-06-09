import type { SupabaseClient } from "@/shared/api";

/** Re-export the canonical typed Supabase client alias for course domain functions. */
export type Supabase = SupabaseClient;

/** PostgREST surfaces a Postgres unique-constraint violation with this SQLSTATE. */
export const UNIQUE_VIOLATION = "23505";

export const DUPLICATE_COURSE_MESSAGE = "A course with this name, level, and group already exists in this cohort.";
