import type { SupabaseClient } from "@/shared/api";
import type { ChangeUserEmailInput, UserTarget } from "../model/schemas";
import { invokeAdminUsers } from "./invoke-admin-users";

/** Set a new address immediately (S-411). No confirmation link is sent. */
export const changeUserEmail = (
  supabase: SupabaseClient,
  { userId, email }: ChangeUserEmailInput,
): Promise<UserTarget> => invokeAdminUsers(supabase, { op: "change_email", userId, email });
