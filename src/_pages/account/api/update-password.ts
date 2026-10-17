import type { SupabaseClient } from "@/shared/api";
import type { UpdatePasswordInput } from "../model/schemas";
import { unwrapAuth } from "./unwrap-auth";

/**
 * Change the caller's password. GoTrue keeps this session and deletes every other session of the
 * user, so their other devices are signed out on their next request.
 *
 * Exactly `{ password }`: on this server (PKCE) client an `email` would write a code-verifier cookie,
 * and a different one would start an email change.
 */
export const updatePassword = async (supabase: SupabaseClient, input: UpdatePasswordInput): Promise<void> => {
  unwrapAuth(await supabase.auth.updateUser({ password: input.password }));
};
