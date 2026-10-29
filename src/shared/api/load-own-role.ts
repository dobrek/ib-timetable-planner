import type { SupabaseClient } from "@/shared/api";
import type { AppRole } from "@/shared/config";
import { DomainError } from "@/shared/lib/errors";
import { Constants } from "./database.types";
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
  toKnownRole(unwrapMaybeRow(await supabase.rpc("own_app_role"), "Failed to read your role"));

// A role this build does not know (an enum value a migration added before the Worker that knows it
// deployed) is a failed read, not a grant: `grants()` holds no capabilities for it.
function toKnownRole(value: unknown): AppRole | null {
  if (value === null) return null;
  if (isKnownRole(value)) return value;
  throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to read your role: unknown role ${JSON.stringify(value)}`);
}

const isKnownRole = (value: unknown): value is AppRole =>
  (Constants.public.Enums.app_role as readonly unknown[]).includes(value);
