import type { Database, SupabaseClient } from "@/shared/api";
import { unwrapRow } from "@/shared/lib/postgrest";
import type { RenamePlanInput } from "../model/schemas";

type PlanRecord = Database["public"]["Tables"]["plans"]["Row"];

/** Rename a plan by id. */
export const renamePlan = async (supabase: SupabaseClient, input: RenamePlanInput): Promise<PlanRecord> =>
  unwrapRow(await supabase.from("plans").update({ name: input.name }).eq("id", input.id).select().single(), {
    notFound: "Plan not found.",
    failure: "Failed to rename plan",
  });
