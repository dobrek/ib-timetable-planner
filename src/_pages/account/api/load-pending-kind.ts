import { type SupabaseClient, unwrapMaybeRow } from "@/shared/api";
import { type PendingKind, pendingKindOf } from "../model/pending-account";

/**
 * Why the caller is pending, read from their own `user_directory` row, which RLS lets a user without
 * a role read. Called only for a caller the middleware found pending (`password_change_required`).
 *
 * Throws on a read error, as `loadOwnProfile` does: `/account` fails rather than greet an invitee as
 * someone given a temporary password.
 */
export const loadPendingKind = async (supabase: SupabaseClient, userId: string): Promise<PendingKind> => {
  const row = unwrapMaybeRow(
    await supabase.from("user_directory").select("invited_at").eq("user_id", userId).maybeSingle(),
    "Failed to read your account state",
  );
  return pendingKindOf(row?.invited_at ?? null);
};
