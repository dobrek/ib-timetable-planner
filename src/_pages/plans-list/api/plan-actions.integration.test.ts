import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCohortCourses, type Database } from "@/shared/api";
import { computeCatalogHash } from "@/shared/lib/catalog-hash";
import { DomainError } from "@/shared/lib/errors";
import { createPlan } from "./create-plan";
import { clonePlan } from "./clone-plan";
import { renamePlan } from "./rename-plan";
import { deletePlan } from "./delete-plan";

// Drives the plan-hub domain functions directly against the seeded local Supabase
// with the service_role/secret client, mirroring the other suites. Skips when the
// env/stack is unavailable.
//
// Coverage (plan.md Phase 4 #4): create → rename → delete round-trip; delete
// cascades the full scenario; the clonePlan domain function leaves cloned
// groupings non-stale (hash matches a fresh computeCatalogHash over the clone's
// catalog). Like the clone-RPC suite, it snapshots "Seed Plan A" first so
// parallel files mutating the seed plan can't race it.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PLAN_NAME = "Seed Plan A";

const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

(hasEnv ? describe : describe.skip)("plan actions (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;
  let basePlanId: string;
  const createdPlanIds: string[] = [];

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

    const { data: seedPlan, error } = await supabase.from("plans").select("id").eq("name", PLAN_NAME).limit(1).single();
    if (error) throw new Error(`Seed plan "${PLAN_NAME}" not found — re-run supabase db reset: ${error.message}`);

    // Atomic snapshot of the seed plan: the frozen source for the clone tests.
    const base = await clonePlan(supabase, { sourcePlanId: seedPlan.id, name: "Plan Actions Base" });
    basePlanId = base.id;
    createdPlanIds.push(basePlanId);
  });

  afterAll(async () => {
    if (createdPlanIds.length > 0) await supabase.from("plans").delete().in("id", createdPlanIds);
  });

  const countRows = async (table: "students" | "courses" | "placements", planId: string): Promise<number> => {
    const { count, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("plan_id", planId);
    if (error) throw error;
    return count ?? 0;
  };

  it("creates a blank plan, renames it, and deletes it", async () => {
    const created = await createPlan(supabase, { name: "Plan Actions CRUD", slotGridPreset: "5x8" });
    createdPlanIds.push(created.id);
    expect(created.slot_grid_preset).toBe("5x8");

    // Blank by design: no catalog rows arrive with a created plan.
    expect(await countRows("students", created.id)).toBe(0);
    expect(await countRows("courses", created.id)).toBe(0);

    const renamed = await renamePlan(supabase, { id: created.id, name: "Plan Actions CRUD v2" });
    expect(renamed.name).toBe("Plan Actions CRUD v2");

    await deletePlan(supabase, { id: created.id });
    const { data: gone } = await supabase.from("plans").select("id").eq("id", created.id).maybeSingle();
    expect(gone).toBeNull();
  });

  it("rejects renaming a plan that does not exist", async () => {
    await expect(
      renamePlan(supabase, { id: "00000000-0000-4000-8000-000000000000", name: "ghost" }),
    ).rejects.toBeInstanceOf(DomainError);
  });

  it("delete cascades the full scenario and leaves the source untouched", async () => {
    const clone = await clonePlan(supabase, { sourcePlanId: basePlanId, name: "Plan Actions Cascade" });
    createdPlanIds.push(clone.id);

    const baseCounts = {
      students: await countRows("students", basePlanId),
      courses: await countRows("courses", basePlanId),
    };
    expect(await countRows("students", clone.id)).toBeGreaterThan(0);
    expect(await countRows("courses", clone.id)).toBeGreaterThan(0);

    await deletePlan(supabase, { id: clone.id });

    expect(await countRows("students", clone.id)).toBe(0);
    expect(await countRows("courses", clone.id)).toBe(0);
    expect(await countRows("placements", clone.id)).toBe(0);
    expect(await countRows("students", basePlanId)).toBe(baseCounts.students);
    expect(await countRows("courses", basePlanId)).toBe(baseCounts.courses);
  });

  it("clonePlan leaves cloned groupings non-stale (hash recomputed over the clone's catalog)", async () => {
    // The seed ships no groupings, so stage real ones on the base first — with a
    // deliberately wrong stored hash so a copied-as-is hash can't pass by accident.
    const { data: baseCourses } = await supabase
      .from("courses")
      .select("id")
      .eq("plan_id", basePlanId)
      .eq("cohort", "dp1")
      .limit(2);
    const memberIds = (baseCourses ?? []).map((c) => c.id);
    if (memberIds.length < 2) throw new Error("base plan has fewer than two dp1 courses");

    const { error: rpcError } = await supabase.rpc("replace_cohort_groupings", {
      p_plan_id: basePlanId,
      p_cohort: "dp1",
      p_catalog_hash: "pre-clone-stale-hash",
      p_groupings: [{ coverage_count: 2, score: 1.5, member_ids: memberIds }],
    });
    if (rpcError) throw rpcError;

    const clone = await clonePlan(supabase, { sourcePlanId: basePlanId, name: "Plan Actions Warm Clone" });
    createdPlanIds.push(clone.id);

    const { courses } = await loadCohortCourses(supabase, clone.id, "dp1");
    const freshHash = await computeCatalogHash(courses);
    expect(freshHash).not.toBe("pre-clone-stale-hash");

    const { data: cloneGroupings } = await supabase
      .from("course_groupings")
      .select("catalog_hash")
      .eq("plan_id", clone.id)
      .eq("cohort", "dp1");
    expect(cloneGroupings).toHaveLength(1);
    expect(cloneGroupings?.[0]?.catalog_hash).toBe(freshHash);
  });
});
