import type { SupabaseClient } from "@/shared/api";
import type { UserTarget, UserTargetInput } from "../model/schemas";
import { invokeAdminUsers } from "./invoke-admin-users";

/** Remove an account (S-411). The plans that account created stay, credited to nobody. */
export const deleteAccount = (supabase: SupabaseClient, { userId }: UserTargetInput): Promise<UserTarget> =>
  invokeAdminUsers(supabase, { op: "delete", userId });
