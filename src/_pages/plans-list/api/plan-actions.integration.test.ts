import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clonePlan, loadCohortCourses, type Database } from "@/shared/api";
import { computeCatalogHash } from "@/shared/lib/catalog-hash";
import { DomainError } from "@/shared/lib/errors";
import { createPlan as createFactoryPlan, registerPlan, seedPlanCatalog, teardown } from "@/test/factories";
import { createPlan } from "./create-plan";
import { renamePlan } from "./rename-plan";
import { deletePlan } from "./delete-plan";
import { clonePlanGuarded } from "./clone-plan-guarded";

// Drives the plan-hub domain functions directly against the local Supabase with the
// service_role/secret client, mirroring the other suites. Skips when the env/stack
// is unavailable.
//
// Coverage (plan.md Phase 4 #4): create → rename → delete round-trip; delete
// cascades the full scenario; the clonePlan domain function leaves cloned
// groupings non-stale (hash matches a fresh computeCatalogHash over the clone's
// catalog). Plan-rooted isolation: the base is a factory-owned, CSV-seeded plan
// the clone tests source from; every created plan is registered for teardown.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

(hasEnv ? describe : describe.skip)("plan actions (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;
  let basePlanId: string;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

    // Factory-owned, CSV-seeded base: the frozen source for the clone tests.
    basePlanId = await createFactoryPlan(supabase, { name: "Plan Actions Base" });
    await seedPlanCatalog(supabase, basePlanId);
  });

  afterAll(async () => {
    await teardown(supabase);
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
    registerPlan(created.id);
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
    const clone = await clonePlan(supabase, {
      sourcePlanId: basePlanId,
      name: "Plan Actions Cascade",
      includeBoard: true,
    });
    registerPlan(clone.id);

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

    const clone = await clonePlan(supabase, {
      sourcePlanId: basePlanId,
      name: "Plan Actions Warm Clone",
      includeBoard: true,
    });
    registerPlan(clone.id);

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

  /**
   * S-306's guard surface at the ACTION boundary.
   *
   * The plan-scoped ROUTES refuse a pending proposal by rendering a notice, which is what the author
   * sees. These cases pin the layer under that: the hub lists a pending proposal on purpose, so the
   * hub is the one place where an edit affordance and a pending plan are on screen together — and a
   * direct action call must be refused whether or not a page remembered to.
   *
   * Fixtures are hand-made rather than enqueued: `startGeneration` needs a solver transport and lives
   * in another slice, while what is under test here is purely "how does this action react to a
   * `pending_proposal` row and the job that references it". Every combination is set up as rows.
   */
  describe("pending-proposal guards", () => {
    const makeProposal = async (label: string): Promise<{ sourceId: string; proposalId: string }> => {
      const sourceId = await createFactoryPlan(supabase, { name: `Guard source ${label} ${crypto.randomUUID()}` });
      const { id: proposalId } = await clonePlan(supabase, {
        sourcePlanId: sourceId,
        name: `Proposal — Guard ${label}`,
        includeBoard: true,
      });
      registerPlan(proposalId);
      await supabase.from("plans").update({ pending_proposal: true }).eq("id", proposalId);
      return { sourceId, proposalId };
    };

    /** The job row `startGeneration` would have written, in whatever state the case needs. */
    const jobFor = async (
      sourceId: string,
      proposalId: string | null,
      row: Record<string, unknown>,
    ): Promise<string> => {
      const { data, error } = await supabase
        .from("generation_jobs")
        .insert({
          plan_id: sourceId,
          proposal_plan_id: proposalId,
          snapshot: {},
          snapshot_hash: crypto.randomUUID(),
          policy: { clean: true },
          heartbeat_at: new Date().toISOString(),
          ...row,
        })
        .select("id")
        .single();
      if (error) throw new Error(`jobFor: ${error.message}`);
      return data.id;
    };

    const planExists = async (id: string): Promise<boolean> =>
      ((await supabase.from("plans").select("id").eq("id", id)).data ?? []).length > 0;

    it("refuses to rename a pending proposal", async () => {
      // Its name is the only thing on the hub that says what it is and where it came from. Renaming
      // is how the author KEEPS a delivered proposal, so it is deferred, not lost.
      const { sourceId, proposalId } = await makeProposal("rename");
      await jobFor(sourceId, proposalId, { status: "running" });

      await expect(renamePlan(supabase, { id: proposalId, name: "Kept" })).rejects.toThrow(/still being generated/i);
      const { data } = await supabase.from("plans").select("name").eq("id", proposalId).single();
      expect(data?.name).toBe("Proposal — Guard rename");
    });

    it("refuses to clone a pending proposal, while leaving plain clonePlan alone", async () => {
      // The guard lives on the hub's ACTION, not on `shared/api/clone-plan.ts`: the other caller of
      // that function is the generation enqueue, which clones precisely in order to make a pending
      // proposal. Pushing the refusal down would make dispatch refuse itself.
      const { sourceId, proposalId } = await makeProposal("clone");
      await jobFor(sourceId, proposalId, { status: "running" });

      await expect(
        clonePlanGuarded(supabase, { sourcePlanId: proposalId, name: "Copy", includeBoard: true }),
      ).rejects.toThrow(/still being generated/i);

      // The unguarded domain function still works — that is what enqueue depends on.
      const direct = await clonePlan(supabase, { sourcePlanId: proposalId, name: "Copy direct", includeBoard: false });
      registerPlan(direct.id);
      expect(await planExists(direct.id)).toBe(true);
    });

    it("refuses to delete a pending proposal while its job is live", async () => {
      const { sourceId, proposalId } = await makeProposal("delete-active");
      await jobFor(sourceId, proposalId, { status: "running" });

      await expect(deletePlan(supabase, { id: proposalId })).rejects.toThrow(/deliver it first/i);
      expect(await planExists(proposalId)).toBe(true);
    });

    it("refuses to delete a proposal whose board is ready but undelivered", async () => {
      // `proposal_plan_id` is `on delete set null`, and `deliver()` on a null proposal marks the job
      // failed — so a deliberate delete here would surface as a red failure the author never caused.
      // Refusing costs one click and tells the truth.
      const { sourceId, proposalId } = await makeProposal("delete-ready");
      await jobFor(sourceId, proposalId, { status: "succeeded", finished_at: new Date().toISOString() });

      await expect(deletePlan(supabase, { id: proposalId })).rejects.toThrow(/deliver it first/i);
      expect(await planExists(proposalId)).toBe(true);
    });

    it("ALLOWS deleting a pending proposal once its job has failed", async () => {
      // Delete is the one act that must survive a broken job: it is the only way out of a stranded row.
      const { sourceId, proposalId } = await makeProposal("delete-failed");
      await jobFor(sourceId, proposalId, {
        status: "failed",
        error: "infeasible",
        finished_at: new Date().toISOString(),
      });

      await deletePlan(supabase, { id: proposalId });
      expect(await planExists(proposalId)).toBe(false);
    });

    it("ALLOWS deleting a pending proposal that no job references at all", async () => {
      // The stranded case. Without this the only way out would be SQL.
      const { proposalId } = await makeProposal("delete-orphan");

      await deletePlan(supabase, { id: proposalId });
      expect(await planExists(proposalId)).toBe(false);
    });

    it("ALLOWS deleting a pending proposal whose job has gone stale", async () => {
      // Reclaim already treats a job quiet past the grace as dead; this guard must agree, or a
      // container that vanished would leave two undeletable plans behind forever.
      const { sourceId, proposalId } = await makeProposal("delete-stale");
      const longAgo = new Date(Date.now() - 60 * 60_000).toISOString();
      await jobFor(sourceId, proposalId, { status: "running", heartbeat_at: longAgo, created_at: longAgo });

      await deletePlan(supabase, { id: proposalId });
      expect(await planExists(proposalId)).toBe(false);
    });

    it("refuses to delete the SOURCE plan while its job is active", async () => {
      // `generation_jobs.plan_id` is `on delete cascade`, so this deletion would take the job row with
      // it — stranding the clone pending with nothing left that could ever un-pend it, and pulling the
      // row out from under a running solver. Not recoverable through the UI at all.
      const { sourceId, proposalId } = await makeProposal("delete-source");
      await jobFor(sourceId, proposalId, { status: "running" });

      await expect(deletePlan(supabase, { id: sourceId })).rejects.toThrow(/generation is running/i);
      expect(await planExists(sourceId)).toBe(true);
    });

    it("ALLOWS deleting the source once its job is terminal", async () => {
      const { sourceId, proposalId } = await makeProposal("delete-source-done");
      await jobFor(sourceId, proposalId, { status: "failed", finished_at: new Date().toISOString() });

      await deletePlan(supabase, { id: sourceId });
      expect(await planExists(sourceId)).toBe(false);
    });
  });
});
