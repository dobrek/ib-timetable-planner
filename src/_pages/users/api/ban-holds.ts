import { unwrapMaybeRow, type SupabaseClient } from "@/shared/api";

/**
 * Whether a ban is recorded (`user_directory.banned_at`, S-411). A recorded ban holds the account's
 * pause, so a write that would end it or strand it is refused while it holds: Reactivate, and every
 * role write. A missing directory row holds no ban: there is nothing to keep. `failure` is the
 * message a failed read reports.
 */
export const banHolds = async (supabase: SupabaseClient, userId: string, failure: string): Promise<boolean> => {
  const row = unwrapMaybeRow(
    await supabase.from("user_directory").select("banned_at").eq("user_id", userId).maybeSingle(),
    failure,
  );
  return (row?.banned_at ?? null) !== null;
};
