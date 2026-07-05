import type { SupabaseClient } from "@/shared/api";
import { unwrapMany } from "./postgrest";

/** Teacher display names by id: `full_name` with the `code` as fallback. Empty input → `{}`. */
export const loadTeacherNames = async (supabase: SupabaseClient, ids: string[]): Promise<Record<string, string>> => {
  if (ids.length === 0) return {};
  const rows = unwrapMany(
    await supabase.from("teachers").select("id, full_name, code").in("id", ids),
    "Failed to load teacher names",
  );
  return Object.fromEntries(rows.map((row) => [row.id, row.full_name ?? row.code]));
};
