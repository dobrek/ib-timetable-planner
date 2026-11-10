import type { SupabaseClient } from "@/shared/api";
import type { CreateAccountInput, TemporaryPassword } from "../model/schemas";
import { invokeAdminUsers } from "./invoke-admin-users";

/** Create an account with a temporary password the function generates, and reveal it once (S-409, FR-403). */
export const createAccount = (
  supabase: SupabaseClient,
  { email, role }: CreateAccountInput,
): Promise<TemporaryPassword> => invokeAdminUsers(supabase, { op: "create", email, role });
