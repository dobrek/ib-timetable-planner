import type { SupabaseClient } from "@/shared/api";
import { unwrapMaybeRow } from "./postgrest";

/**
 * Whether the caller is on a temporary password (S-409): their own `user_directory.must_change_password`.
 * Read only for a caller `own_app_role()` answered null for, since the flag is what makes it null.
 *
 * No `user_id` filter, because the middleware runs this before `getUser()` has answered: RLS lets a
 * caller without a role read only their own directory row, so `maybeSingle()` sees at most one. A
 * second row would be an error here, and an error is `unavailable`, never "no flag".
 *
 * Throws on a read error, which the middleware maps to `unavailable`. A missing row reads false.
 */
export const loadMustChangePassword = async (supabase: SupabaseClient): Promise<boolean> => {
  const row = unwrapMaybeRow(
    await supabase.from("user_directory").select("must_change_password").maybeSingle(),
    "Failed to read your account state",
  );
  return row?.must_change_password ?? false;
};
