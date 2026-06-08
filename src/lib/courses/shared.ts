import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";

/**
 * The typed Supabase client the course domain functions operate on. A type-only import
 * (no `astro:env` runtime), so these modules stay importable under Vitest. Mirrors the
 * alias already used by the grouping adapter.
 */
export type Supabase = SupabaseClient<Database>;

/** PostgREST surfaces a Postgres unique-constraint violation with this SQLSTATE. */
export const UNIQUE_VIOLATION = "23505";

export const DUPLICATE_COURSE_MESSAGE = "A course with this name, level, and group already exists in this cohort.";
