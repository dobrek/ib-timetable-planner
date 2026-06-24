import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { createPlan as createFactoryPlan, seedPlanCatalog, teardown } from "@/test/factories";

// Drives the transactional bundle RPCs (place_course / move_bundle_members /
// remove_bundle_members) directly against local Supabase with the service_role client
// (bypasses RLS for setup + assertions). The RPCs own bundle identity and the == 0
// cleanup rule atomically; Phase 3 wires the persistence layer onto them. Skips when the
// stack is unavailable.
//
// Coverage (plan.md Phase 2 #2.3–2.7): find-or-create + idempotency; whole-bundle move
// into an empty cell (identity preserved); a partial move minting a fresh bundle; merge
// into an occupied cell (movers join, mergers dropped, source bundle deleted); and the
// == 0 cleanup (bundle deleted exactly when its last member is removed).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

(hasEnv ? describe : describe.skip)("bundle operation RPCs (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;
  let planId: string;
  let courseA: string;
  let courseB: string;
  let courseC: string;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

    planId = await createFactoryPlan(supabase, { name: "Bundle Ops Base" });
    const catalog = await seedPlanCatalog(supabase, planId);
    const dp1 = catalog.courses.filter((c) => c.cohort === "dp1");
    if (dp1.length < 3) throw new Error("seed needs at least three dp1 courses");
    [courseA, courseB, courseC] = [dp1[0].id, dp1[1].id, dp1[2].id];
  });

  afterAll(async () => {
    await teardown(supabase);
  });

  /** place_course RPC → the inserted/existing placement row (week defaults to `both`). */
  const place = async (day: number, period: number, courseId: string, week?: "both" | "a" | "b") => {
    const { data, error } = await supabase.rpc("place_course", {
      p_plan_id: planId,
      p_cohort: "dp1",
      p_course_id: courseId,
      p_day: day,
      p_period: period,
      ...(week ? { p_week: week } : {}),
    });
    if (error) throw error;
    return data;
  };

  const move = async (
    src: { day: number; period: number },
    courseIds: string[],
    tgt: { day: number; period: number },
  ) => {
    const { data, error } = await supabase.rpc("move_bundle_members", {
      p_plan_id: planId,
      p_cohort: "dp1",
      p_day: src.day,
      p_period: src.period,
      p_course_ids: courseIds,
      p_target_day: tgt.day,
      p_target_period: tgt.period,
    });
    if (error) throw error;
    return data;
  };

  const remove = async (cell: { day: number; period: number }, courseIds: string[]) => {
    const { error } = await supabase.rpc("remove_bundle_members", {
      p_plan_id: planId,
      p_cohort: "dp1",
      p_day: cell.day,
      p_period: cell.period,
      p_course_ids: courseIds,
    });
    if (error) throw error;
  };

  const placementsAt = async (day: number, period: number) => {
    const { data, error } = await supabase
      .from("placements")
      .select("id, course_id, bundle_id")
      .eq("plan_id", planId)
      .eq("cohort", "dp1")
      .eq("day", day)
      .eq("period", period);
    if (error) throw error;
    return data;
  };

  const bundleAt = async (day: number, period: number): Promise<string | null> => {
    const { data, error } = await supabase
      .from("bundles")
      .select("id")
      .eq("plan_id", planId)
      .eq("cohort", "dp1")
      .eq("day", day)
      .eq("period", period)
      .maybeSingle();
    if (error) throw error;
    return data?.id ?? null;
  };

  const bundleExists = async (id: string): Promise<boolean> => {
    const { data, error } = await supabase.from("bundles").select("id").eq("id", id).maybeSingle();
    if (error) throw error;
    return data !== null;
  };

  it("place_course on an empty cell creates a 1-member bundle; a second call reuses it", async () => {
    const first = await place(1, 1, courseA);
    const bundle = await bundleAt(1, 1);
    expect(bundle).not.toBeNull();
    expect(first.bundle_id).toBe(bundle);
    expect(await placementsAt(1, 1)).toHaveLength(1);

    const second = await place(1, 1, courseB);
    expect(second.bundle_id).toBe(bundle); // reused, not a new bundle
    expect(await bundleAt(1, 1)).toBe(bundle);
    const here = await placementsAt(1, 1);
    expect(here).toHaveLength(2);
    expect(new Set(here.map((p) => p.bundle_id))).toEqual(new Set([bundle]));
  });

  it("place_course is idempotent on a duplicate course-hour (returns the existing row)", async () => {
    const first = await place(1, 2, courseA);
    const second = await place(1, 2, courseA);
    expect(second.id).toBe(first.id);
    expect(second.bundle_id).toBe(first.bundle_id);
    expect(await placementsAt(1, 2)).toHaveLength(1);
  });

  it("move into an empty cell relocates all members and preserves the bundle id", async () => {
    const a = await place(2, 1, courseA);
    const b = await place(2, 1, courseB);
    const srcBundle = a.bundle_id;
    expect(b.bundle_id).toBe(srcBundle);

    const moved = await move({ day: 2, period: 1 }, [courseA, courseB], { day: 2, period: 2 });

    // Both members landed at the target, identity preserved (same bundle id).
    expect(moved).toHaveLength(2);
    for (const m of moved) expect(m.bundle_id).toBe(srcBundle);
    // Source cell empty, no bundle left there; the bundle relocated to the target.
    expect(await placementsAt(2, 1)).toHaveLength(0);
    expect(await bundleAt(2, 1)).toBeNull();
    expect(await bundleAt(2, 2)).toBe(srcBundle);
  });

  it("move of one course out of a multi-member source into an empty cell mints a new bundle; the source stays", async () => {
    const a = await place(3, 1, courseA);
    await place(3, 1, courseB);
    const srcBundle = a.bundle_id;

    const moved = await move({ day: 3, period: 1 }, [courseA], { day: 3, period: 2 });

    expect(moved).toHaveLength(1);
    expect(moved[0].bundle_id).not.toBe(srcBundle); // mover joined a fresh bundle
    // Source keeps courseB on the original bundle.
    const srcRows = await placementsAt(3, 1);
    expect(srcRows).toHaveLength(1);
    expect(srcRows[0].course_id).toBe(courseB);
    expect(srcRows[0].bundle_id).toBe(srcBundle);
    expect(await bundleAt(3, 1)).toBe(srcBundle);
  });

  it("move into an occupied cell merges: movers join the destination, source deleted, duplicate movers dropped", async () => {
    // Source bundle: A, B.
    const a = await place(4, 1, courseA);
    await place(4, 1, courseB);
    const srcBundle = a.bundle_id;
    // Target bundle (occupied): B (a duplicate of a source mover) + C.
    const tgtB = await place(4, 2, courseB);
    await place(4, 2, courseC);
    const tgtBundle = tgtB.bundle_id;
    expect(tgtBundle).not.toBe(srcBundle);

    const moved = await move({ day: 4, period: 1 }, [courseA, courseB], { day: 4, period: 2 });

    // Target holds A (moved), B (already there — merger dropped, not duplicated), C.
    const tgtRows = await placementsAt(4, 2);
    expect(new Set(tgtRows.map((p) => p.course_id))).toEqual(new Set([courseA, courseB, courseC]));
    expect(tgtRows.filter((p) => p.course_id === courseB)).toHaveLength(1); // no duplicate
    for (const p of tgtRows) expect(p.bundle_id).toBe(tgtBundle); // all on the destination bundle
    // The RPC returns the landed movers (A relocated + B's surviving target row).
    expect(new Set(moved.map((m) => m.course_id))).toEqual(new Set([courseA, courseB]));
    // Source cell empty, source bundle deleted (identity not preserved across a merge).
    expect(await placementsAt(4, 1)).toHaveLength(0);
    expect(await bundleExists(srcBundle)).toBe(false);
  });

  it("remove deletes members and deletes the bundle exactly at membership 0 (not before)", async () => {
    const a = await place(5, 1, courseA);
    await place(5, 1, courseB);
    const bundle = a.bundle_id;

    // Remove one of two members → bundle survives (membership still 1).
    await remove({ day: 5, period: 1 }, [courseA]);
    expect(await placementsAt(5, 1)).toHaveLength(1);
    expect(await bundleExists(bundle)).toBe(true);

    // Remove the last member → bundle deleted (membership 0).
    await remove({ day: 5, period: 1 }, [courseB]);
    expect(await placementsAt(5, 1)).toHaveLength(0);
    expect(await bundleExists(bundle)).toBe(false);
  });

  it("move from an empty source cell fails loudly (no silent no-op)", async () => {
    // No placement at (6, 1): the source bundle is absent. A stale/duplicate/concurrent
    // call must raise, not silently take the 0 = 0 whole-bundle branch and return [].
    await expect(move({ day: 6, period: 1 }, [courseA], { day: 6, period: 2 })).rejects.toThrow(
      /no bundle at source cell/,
    );
  });
});
