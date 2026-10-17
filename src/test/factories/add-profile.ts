import type { SupabaseClient } from "@/shared/api";

export type AddProfileInput = {
  userId: string;
  displayName: string | null;
};

/**
 * Insert one `profiles` row as the service role. `user_id` is always passed: the column defaults
 * to `auth.uid()`, which the service role does not have. The row leaves with its user.
 */
export async function addProfile(supabase: SupabaseClient, input: AddProfileInput): Promise<void> {
  const { error } = await supabase.from("profiles").insert({ user_id: input.userId, display_name: input.displayName });
  if (error) throw new Error(`addProfile: ${error.message}`);
}
