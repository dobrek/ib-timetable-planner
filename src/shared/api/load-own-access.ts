import type { SupabaseClient } from "@/shared/api";
import type { OwnAccessRead } from "@/shared/config";
import { loadMustChangePassword } from "./load-must-change-password";
import { loadOwnRole } from "./load-own-role";

/**
 * Everything the middleware needs to tell who the caller is, in one read (S-403, S-409). The role
 * comes first; the temporary-password flag is read only when there is no role, because that flag is
 * why a pending admin has none. A caller holding a role pays for one query, as before.
 */
export const loadOwnAccess = async (supabase: SupabaseClient): Promise<OwnAccessRead> => {
  const role = await loadOwnRole(supabase);
  if (role !== null) return { role, mustChangePassword: false };
  return { role: null, mustChangePassword: await loadMustChangePassword(supabase) };
};
