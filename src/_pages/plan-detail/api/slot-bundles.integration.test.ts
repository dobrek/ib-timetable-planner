import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { deleteOverride, insertOverride } from "./slot-bundles";

// Drives the slot-bundle domain functions directly against local Supabase with the
// service_role/secret client (bypasses RLS for setup + assertions). The Astro Action
// couples to astro:env, so we exercise the same domain functions the handler runs
// rather than the HTTP layer. Skips when the env/stack is unavailable.
//
// Coverage (plan.md Phase 1 #9): override insert idempotency and insert→delete
// round-trip. (clone_plan no longer copies slot_bundles overrides — first-class
// bundles replaced that, so the former clone-by-coordinate test was dropped; the
// whole slot_bundles stack is retired in a later phase.)
//
// Each test owns a freshly-created BARE plan rather than a clone of the shared seed:
// slot_bundles only needs a valid plans FK (it carries its own cohort/day/period and
// references nothing else). This keeps the suite independent of seed contents AND of
// any other data already sitting in the dev DB. A per-run id suffix keeps the created
// plans identifiable and collision-free on a shared stack.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RUN_ID = randomUUID().slice(0, 8);
const GRID_PRESET = "5x10"; // matches the seed's preset; value is opaque to these tests

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

  // A minimal plan owned by this test — no seed clone, so nothing already in the dev DB
  // can leak into the assertions. slot_bundles only needs a valid plans FK.
  const bare = async (label: string): Promise<string> => {
    const { data, error } = await supabase
      .from("plans")
      .insert({ name: `Slot Bundle Test — ${label} (${RUN_ID})`, slot_grid_preset: GRID_PRESET })
      .select("id")
      .single();
    if (error) throw error;
    createdPlanIds.push(data.id);
    return data.id;
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
    const planId = await bare("round-trip");
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
});
