import type { SupabaseClient as SupabaseClientGeneric } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export { createClient } from "./supabase";
export { isPlanId, loadPlanSummary, type PlanSummary } from "./load-plan-summary";
export type { Database, Json } from "./database.types";

/** Canonical typed Supabase client alias — replaces per-module duplicates. */
export type SupabaseClient = SupabaseClientGeneric<Database>;
