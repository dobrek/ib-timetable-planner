import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { deleteOverride, insertOverride } from "./slot-bundles";

// Drives the slot-bundle domain functions directly against the seeded local
// Supabase with the service_role/secret client (bypasses RLS for setup +
// assertions), mirroring the students-crud / clone-plan harnesses. The Astro
// Action couples to astro:env, so we exercise the same domain functions the
// handler runs rather than the HTTP layer. Skips when the env/stack is unavailable.
//
// Coverage (plan.md Phase 1 #9): override insert idempotency, insert→delete
// round-trip, and clone_plan copying an override to the cloned plan by coordinate.
//
// Each test owns an isolated plan cloned from the seed (clone_plan is atomic), so
// parallel suites mutating the seed plan can't make these assertions flaky.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PLAN_NAME = "Seed Plan A";

const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

(hasEnv ? describe : describe.skip)("slot_bundles persistence (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;
  const createdPlanIds: string[] = [];

  beforeAll(() => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
  });

  afterAll(async () => {
    // Deleting the plans rows cascades each cloned scenario (incl. its slot_bundles).
    if (createdPlanIds.length > 0) await supabase.from("plans").delete().in("id", createdPlanIds);
  });

  const freshPlan = async (name: string): Promise<string> => {
    const { data: seed, error } = await supabase.from("plans").select("id").eq("name", PLAN_NAME).limit(1).single();
    if (error) throw new Error(`Seed plan "${PLAN_NAME}" not found — re-run supabase db reset: ${error.message}`);
    const { data: cloneId, error: rpcError } = await supabase.rpc("clone_plan", {
      p_source_plan_id: seed.id,
      p_name: name,
    });
    if (rpcError) throw rpcError;
    createdPlanIds.push(cloneId);
    return cloneId;
  };

  const countOverrides = async (planId: string, day: number, period: number): Promise<number> => {
    const { count, error } = await supabase
      .from("slot_bundles")
      .select("*", { count: "exact", head: true })
      .eq("plan_id", planId)
      .eq("cohort", "dp1")
      .eq("day", day)
      .eq("period", period);
    if (error) throw error;
    return count ?? 0;
  };

  it("inserts an override idempotently, then deletes it (round-trip)", async () => {
    const planId = await freshPlan("Slot Bundle Test 1");
    const cell = { planId, cohort: "dp1" as const, day: 3, period: 4 };

    await insertOverride(supabase, cell);
    expect(await countOverrides(planId, 3, 4)).toBe(1);

    // Idempotent on slot_bundles_unique: a second insert swallows the conflict.
    await insertOverride(supabase, cell);
    expect(await countOverrides(planId, 3, 4)).toBe(1);

    await deleteOverride(supabase, cell);
    expect(await countOverrides(planId, 3, 4)).toBe(0);

    // Deleting an absent override is a no-op, not an error.
    await deleteOverride(supabase, cell);
    expect(await countOverrides(planId, 3, 4)).toBe(0);
  });

  it("clone_plan copies an override to the cloned plan by coordinate", async () => {
    const sourceId = await freshPlan("Slot Bundle Test 2 (source)");
    await insertOverride(supabase, { planId: sourceId, cohort: "dp1", day: 2, period: 5 });

    const { data: cloneId, error } = await supabase.rpc("clone_plan", {
      p_source_plan_id: sourceId,
      p_name: "Slot Bundle Test 2 (clone)",
    });
    if (error) throw error;
    createdPlanIds.push(cloneId);

    // The clone carries the same coordinate override and nothing else.
    expect(await countOverrides(cloneId, 2, 5)).toBe(1);
    const { count: total } = await supabase
      .from("slot_bundles")
      .select("*", { count: "exact", head: true })
      .eq("plan_id", cloneId);
    expect(total ?? 0).toBe(1);
  });
});
