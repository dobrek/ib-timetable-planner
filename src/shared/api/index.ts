import type { SupabaseClient as SupabaseClientGeneric } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export { createClient } from "./supabase";
export { toOrderedCohorts, type CohortOption } from "./cohorts";
export type { Database, Json } from "./database.types";

/** Canonical typed Supabase client alias — replaces per-module duplicates. */
export type SupabaseClient = SupabaseClientGeneric<Database>;
