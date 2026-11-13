import type { SupabaseClient } from "@/shared/api";
import type { AccountTarget, AccountTargetInput, ChangeUserEmailInput } from "../model/schemas";
import { invokeAdminUsers } from "./invoke-admin-users";

/** Ban an account (S-411). The function pauses it and stops sign-in, or refuses. */
export const banUser = (supabase: SupabaseClient, { userId }: AccountTargetInput): Promise<AccountTarget> =>
  invokeAdminUsers(supabase, { op: "ban", userId });

/** Lift a ban. A pause that was already in place stays. */
export const unbanUser = (supabase: SupabaseClient, { userId }: AccountTargetInput): Promise<AccountTarget> =>
  invokeAdminUsers(supabase, { op: "unban", userId });

/** Remove an account. The plans that account created stay, credited to nobody. */
export const deleteAccount = (supabase: SupabaseClient, { userId }: AccountTargetInput): Promise<AccountTarget> =>
  invokeAdminUsers(supabase, { op: "delete", userId });

/** Set a new address immediately. No confirmation link is sent. */
export const changeUserEmail = (
  supabase: SupabaseClient,
  { userId, email }: ChangeUserEmailInput,
): Promise<AccountTarget> => invokeAdminUsers(supabase, { op: "change_email", userId, email });
