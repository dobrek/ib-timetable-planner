import type { SupabaseClient } from "@/shared/api";
import { creditFor, type Credit } from "../model/credit";
import { loadCreditedUsers } from "./load-credited-users";

/** The credit for one id: a single-person `loadCreditedUsers`, which queries nothing for a null id. */
export async function loadCredit(supabase: SupabaseClient, id: string | null): Promise<Credit> {
  return creditFor(id, await loadCreditedUsers(supabase, [id]));
}
