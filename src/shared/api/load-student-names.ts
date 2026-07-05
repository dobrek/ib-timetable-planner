import type { SupabaseClient } from "@/shared/api";
import { unwrapMany } from "./postgrest";

/** Student display names by id. Empty input → `{}`. */
export const loadStudentNames = async (supabase: SupabaseClient, ids: string[]): Promise<Record<string, string>> => {
  if (ids.length === 0) return {};
  const rows = unwrapMany(
    await supabase.from("students").select("id, full_name").in("id", ids),
    "Failed to load student names",
  );
  return Object.fromEntries(rows.map((row) => [row.id, row.full_name]));
};
