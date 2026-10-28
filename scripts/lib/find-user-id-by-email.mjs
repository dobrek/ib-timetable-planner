// Resolves an Auth user's email to its id, for the operator scripts (provision-solver-user,
// provision-e2e-author, assign-role). GoTrue's admin API has no lookup by email, so this pages
// through the user list. It throws rather than exiting: each caller reports through its own `fail()`.

const PAGE_SIZE = 200;
const MAX_PAGES = 20;

/**
 * The id of the user whose email matches, ignoring case, or undefined when there is none.
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase a service-role client
 * @param {string} email
 * @returns {Promise<string | undefined>}
 */
export async function findUserIdByEmail(supabase, email) {
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw new Error(`Failed to list users: ${error.message}`);
    const match = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (data.users.length < PAGE_SIZE) return undefined;
  }
  return undefined;
}
