import type { SupabaseClient } from "@/shared/api";
import type { UserTarget, UserTargetInput } from "../model/schemas";
import { invokeAdminUsers } from "./invoke-admin-users";

/** Lift a ban (S-411). A pause that was already in place stays. */
export const unbanUser = (supabase: SupabaseClient, { userId }: UserTargetInput): Promise<UserTarget> =>
  invokeAdminUsers(supabase, { op: "unban", userId });
