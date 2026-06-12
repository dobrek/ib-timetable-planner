import type { Database, SupabaseClient } from "@/shared/api";
import { unwrapRow } from "@/shared/lib/postgrest";
import type { CreatePlanInput } from "../model/schemas";

type PlanRecord = Database["public"]["Tables"]["plans"]["Row"];

/** Insert a blank plan (name + grid preset); the catalog starts empty. */
export const createPlan = async (supabase: SupabaseClient, input: CreatePlanInput): Promise<PlanRecord> =>
  unwrapRow(
    await supabase.from("plans").insert({ name: input.name, slot_grid_preset: input.slotGridPreset }).select().single(),
    { failure: "Failed to create plan" },
  );
