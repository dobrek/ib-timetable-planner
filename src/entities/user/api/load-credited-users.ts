import type { SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";
import type { CreditedUser } from "../model/credit";
import { buildCreditedUsers } from "../model/credited-users";

/**
 * The people behind a page's credits (S-407), by id, in one batch: the directory and the profiles,
 * read in parallel under the caller's own session. Any role holder reads every human's directory row
 * and profile (S-403, S-406), so an id that comes back missing is a machine user, which RLS hides, or
 * an account deleted since: `creditFor` reads both as unknown.
 *
 * Nulls and repeats are dropped first, and with no id left nothing is queried. A failed read throws.
 *
 * **Client-safe imports only.** This module sits behind the `entities/user` barrel, which islands
 * import for `UserCredit`. `@/shared/api`'s own barrel re-exports `createClient`, which reads
 * `astro:env/server` and fails a client build when it loads, so it is imported for types alone. That
 * is why this checks its two reads itself, the way `assertNoQueryErrors` does, rather than calling it:
 * reaching that helper by its own path is a public-API sidestep (`pnpm steiger`).
 */
export async function loadCreditedUsers(
  supabase: SupabaseClient,
  ids: readonly (string | null)[],
): Promise<Map<string, CreditedUser>> {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map();

  const [directory, profiles] = await Promise.all([
    supabase.from("user_directory").select("user_id, email, is_service_account").in("user_id", unique),
    supabase.from("profiles").select("user_id, display_name").in("user_id", unique),
  ]);
  const failed = [directory.error, profiles.error].find((error) => error !== null);
  if (failed) throw new DomainError("INTERNAL_SERVER_ERROR", `Credited users lookup failed: ${failed.message}`);

  return buildCreditedUsers({ directory: directory.data ?? [], profiles: profiles.data ?? [] });
}
