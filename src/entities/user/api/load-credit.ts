import type { SupabaseClient } from "@/shared/api";
import { creditFor, type Credit } from "../model/credit";
import { loadCreditedUsers } from "./load-credited-users";

/**
 * The credit for one id, best-effort: a single-person `loadCreditedUsers`, which queries nothing for
 * a null id. A credit is a label, so a failed lookup is logged under `context` and answered with
 * null, which every surface renders as no line; the page it sits on never fails for it. A page that
 * credits many people at once (the hub) batches through `loadCreditedUsers` and throws as its other
 * reads do.
 */
export async function loadCredit(supabase: SupabaseClient, id: string | null, context: string): Promise<Credit | null> {
  try {
    return creditFor(id, await loadCreditedUsers(supabase, [id]));
  } catch (error: unknown) {
    // eslint-disable-next-line no-console -- the server log is the only trace a lookup failed
    console.error(`[${context}] credit lookup failed:`, error);
    return null;
  }
}
