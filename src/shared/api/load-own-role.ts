import type { SupabaseClient } from "@/shared/api";
import type { AppRole } from "@/shared/config";
import { unwrapMaybeRow } from "./postgrest";

/**
 * The caller's role, or `null` when they hold none (S-403). The app's single role read, through
 * `public.own_app_role()`, which returns exactly what the RLS policies see. Throws on an error, which
 * the middleware maps to `unavailable`, never to "no role".
 *
 * The generated `Returns` is a non-null `app_role`, but the SQL function returns null for a user with
 * no role row, so the result is widened here rather than in the generated file.
 */
export const loadOwnRole = async (supabase: SupabaseClient): Promise<AppRole | null> =>
  unwrapMaybeRow(await supabase.rpc("own_app_role"), "Failed to read your role");
