import type { SupabaseClient } from "@/shared/api";
import type { UserTarget, UserTargetInput } from "../model/schemas";
import { invokeAdminUsers } from "./invoke-admin-users";

/** Ban an account (S-411). The function pauses it and stops sign-in, or refuses. */
export const banUser = (supabase: SupabaseClient, { userId }: UserTargetInput): Promise<UserTarget> =>
  invokeAdminUsers(supabase, { op: "ban", userId });
