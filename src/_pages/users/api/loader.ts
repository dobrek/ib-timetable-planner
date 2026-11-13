import { assertNoQueryErrors, type SupabaseClient } from "@/shared/api";
import { withSupabase, type LoaderResult } from "@/shared/lib/result";
import { buildUserRows, type UserRow, type UserRowsContext } from "../model/user-rows";

/**
 * Load the Users page's rows (S-406) under the admin's own session. RLS hides machine users from
 * the directory, and only an admin reads every role and the change record. Unavailable when the
 * client is null. `currentUserId` marks the admin's own row, which offers less (`buildUserRows`);
 * `now` decides which invitations have expired (S-410), and a test passes its own.
 */
export const loadUserDirectory = (
  supabase: SupabaseClient | null,
  currentUserId: string,
  now: number = Date.now(),
): Promise<LoaderResult<UserRow[]>> =>
  withSupabase(supabase, (client) => fetchUserRows(client, { now, currentUserId }));

/**
 * All rows of all four tables: tens of users at school scale, each with a handful of records. The
 * record is read newest first, so if it ever outgrew PostgREST's row cap (`max_rows`), the oldest
 * records would be the ones dropped. `occurred_at` is the transaction's start, so `id` orders
 * records written in one transaction.
 */
const fetchUserRows = async (client: SupabaseClient, context: UserRowsContext): Promise<UserRow[]> => {
  const [directory, profiles, roles, changes] = await Promise.all([
    client
      .from("user_directory")
      .select("user_id, email, is_service_account, must_change_password, invited_at, email_confirmed_at, banned_at"),
    client.from("profiles").select("user_id, display_name"),
    client.from("user_roles").select("user_id, role, deactivated_at"),
    client
      .from("access_changes")
      .select("id, target_id, actor_id, actor_kind, occurred_at")
      .not("target_id", "is", null)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false }),
  ]);
  assertNoQueryErrors("User directory", [directory, profiles, roles, changes]);

  return buildUserRows(
    {
      directory: directory.data ?? [],
      profiles: profiles.data ?? [],
      roles: roles.data ?? [],
      changes: changes.data ?? [],
    },
    context,
  );
};
