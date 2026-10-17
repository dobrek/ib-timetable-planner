import type { SupabaseClient } from "@/shared/api";
import { unwrapMaybeRow } from "./postgrest";

/**
 * The caller's display name, or `null` when they have not set one. Throws on a read error like
 * every loader here: the app shell catches it and falls back to the email, while `/account` lets it
 * fail rather than show an empty field that reads as "no name".
 */
export const loadOwnProfile = async (supabase: SupabaseClient, userId: string): Promise<string | null> => {
  const row = unwrapMaybeRow(
    await supabase.from("profiles").select("display_name").eq("user_id", userId).maybeSingle(),
    "Failed to load your profile",
  );
  return row?.display_name ?? null;
};
