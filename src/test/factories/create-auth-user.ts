import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@/shared/api";
import { registerUser } from "./teardown";

export type AuthUser = { id: string; email: string };

/**
 * Create a confirmed Auth user with no password, register it for teardown, and return its id.
 * For a suite that needs a user to own rows (a profile) without signing in as it: no password
 * grant, so no cost against GoTrue's sign-in rate limit, and nobody can ever sign in as it.
 *
 * `supabase` must be the service-role client; created through the admin API, never `signUp`.
 * Teardown deletes the user, and its profile with it (`profiles.user_id` cascades).
 */
export async function createAuthUser(supabase: SupabaseClient): Promise<AuthUser> {
  const email = `auth-user-${randomUUID()}@example.test`;
  const { data, error } = await supabase.auth.admin.createUser({ email, email_confirm: true });
  if (error) throw new Error(`createAuthUser: ${error.message}`);
  registerUser(data.user.id);
  return { id: data.user.id, email };
}
