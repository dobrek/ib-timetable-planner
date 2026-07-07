import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import {
  createPlan as createFactoryPlan,
  placeCourse,
  registerPlan,
  seedPlanCatalog,
  teardown,
} from "@/test/factories";

// Drives the shelf RPCs (shelve_bundle / unshelve_bundle / delete_shelf_bundle) and the
// clone_plan shelf blocks directly against local Supabase with the service_role client
// (bypasses RLS for setup + assertions). The shelf is the parked bundle's OWN durable
// representation; park tears down the board representation and unshelve rebuilds it via
// place_course. Skips when the stack is unavailable.
//
// Coverage (plan.md Phase 1 #6): round-trip (shelve tears down placements + empties the
// bundle row; unshelve restores with a fresh bundle_id), merge-onto-occupied, cohort-scope
// isolation, cohort-integrity (unshelve places into the shelf's OWN stored cohort, never the
// caller's), clone carries the shelf under fresh ids, A/B week fidelity, and discard
// (delete_shelf_bundle cascades its courses and is plan-/cohort-scoped).

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

(hasEnv ? describe : describe.skip)("shelf RPCs (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;
  let planId: string;
  let courseA: string;
  let courseB: string;
  let courseC: string;
  let biweekly: string;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

    planId = await createFactoryPlan(supabase, { name: "Shelf Ops Base" });
    const catalog = await seedPlanCatalog(supabase, planId);
    const dp1 = catalog.courses.filter((c) => c.cohort === "dp1");
    if (dp1.length < 3) throw new Error("seed needs at least three dp1 courses");
    [courseA, courseB, courseC] = [dp1[0].id, dp1[1].id, dp1[2].id];
    const bi = catalog.courses.find((c) => c.cohort === "dp1" && c.week_mode === "biweekly");
    if (!bi) throw new Error("seed has no bi-weekly dp1 course");
    biweekly = bi.id;
  });

  afterAll(async () => {
    await teardown(supabase);
  });

  const place = async (
    day: number,
    period: number,
    courseId: string,
    week?: "both" | "a" | "b",
    cohort: "dp1" | "dp2" = "dp1",
  ) => placeCourse(supabase, { planId, cohort, courseId, day, period, ...(week ? { week } : {}) });

  const shelve = async (day: number, period: number, cohort: "dp1" | "dp2" = "dp1") => {
    const { data, error } = await supabase.rpc("shelve_bundle", {
      p_plan_id: planId,
      p_cohort: cohort,
      p_day: day,
      p_period: period,
    });
    if (error) throw error;
    return data;
  };

  const unshelve = async (
    shelfBundleId: string,
    targetDay: number,
    targetPeriod: number,
    cohort: "dp1" | "dp2" = "dp1",
  ) => {
    const { data, error } = await supabase.rpc("unshelve_bundle", {
      p_plan_id: planId,
      p_cohort: cohort,
      p_shelf_bundle_id: shelfBundleId,
      p_target_day: targetDay,
      p_target_period: targetPeriod,
    });
    if (error) throw error;
    return data;
  };

  const discard = async (shelfBundleId: string) => {
    const { error } = await supabase.rpc("delete_shelf_bundle", {
      p_plan_id: planId,
      p_shelf_bundle_id: shelfBundleId,
    });
    if (error) throw error;
  };

  const placementsAt = async (day: number, period: number, cohort: "dp1" | "dp2" = "dp1") => {
    const { data, error } = await supabase
      .from("placements")
      .select("id, course_id, bundle_id, week")
      .eq("plan_id", planId)
      .eq("cohort", cohort)
      .eq("day", day)
      .eq("period", period);
    if (error) throw error;
    return data;
  };

  const bundleAt = async (day: number, period: number, cohort: "dp1" | "dp2" = "dp1"): Promise<string | null> => {
    const { data, error } = await supabase
      .from("bundles")
      .select("id")
      .eq("plan_id", planId)
      .eq("cohort", cohort)
      .eq("day", day)
      .eq("period", period)
      .maybeSingle();
    if (error) throw error;
    return data?.id ?? null;
  };

  const shelfCourses = async (shelfBundleId: string) => {
    const { data, error } = await supabase
      .from("shelf_bundle_courses")
      .select("course_id, week")
      .eq("plan_id", planId)
      .eq("shelf_bundle_id", shelfBundleId);
    if (error) throw error;
    return data;
  };

  const shelfBundleExists = async (id: string): Promise<boolean> => {
    const { data, error } = await supabase.from("shelf_bundles").select("id").eq("id", id).maybeSingle();
    if (error) throw error;
    return data !== null;
  };

  it("round-trip: shelve tears down the board representation; unshelve restores it with a fresh bundle id", async () => {
    const a = await place(1, 1, courseA);
    await place(1, 1, courseB);
    const placedBundle = a.bundleId;

    const shelf = await shelve(1, 1);

    // The shelf header + its course set captured the membership.
    expect(shelf.cohort).toBe("dp1");
    const parked = await shelfCourses(shelf.id);
    expect(new Set(parked.map((p) => p.course_id))).toEqual(new Set([courseA, courseB]));
    for (const p of parked) expect(p.week).toBe("both");

    // The board representation is gone: no placements, no bundle row at the cell.
    expect(await placementsAt(1, 1)).toHaveLength(0);
    expect(await bundleAt(1, 1)).toBeNull();

    // Unshelve onto an empty cell restores the placements with a FRESH bundle id.
    const restored = await unshelve(shelf.id, 1, 2);
    expect(new Set(restored.map((p) => p.course_id))).toEqual(new Set([courseA, courseB]));
    const newBundle = await bundleAt(1, 2);
    expect(newBundle).not.toBeNull();
    expect(newBundle).not.toBe(placedBundle); // identity not preserved across the park boundary
    for (const p of restored) expect(p.bundle_id).toBe(newBundle);
    // The shelf row is gone (courses cascaded).
    expect(await shelfBundleExists(shelf.id)).toBe(false);
    expect(await shelfCourses(shelf.id)).toHaveLength(0);
  });

  it("merge: unshelve onto an occupied cell joins the destination bundle, no error", async () => {
    // Park a bundle of A, B.
    await place(2, 1, courseA);
    await place(2, 1, courseB);
    const shelf = await shelve(2, 1);

    // Occupy the target cell with C.
    const tgtC = await place(2, 2, courseC);
    const tgtBundle = tgtC.bundleId;

    await unshelve(shelf.id, 2, 2);

    // A, B joined the destination bundle alongside C.
    const here = await placementsAt(2, 2);
    expect(new Set(here.map((p) => p.course_id))).toEqual(new Set([courseA, courseB, courseC]));
    for (const p of here) expect(p.bundle_id).toBe(tgtBundle);
    expect(await shelfBundleExists(shelf.id)).toBe(false);
  });

  it("cohort-scope: a dp1 shelf row is not returned by a dp2-filtered read", async () => {
    await place(3, 1, courseA, undefined, "dp1");
    const dp1Shelf = await shelve(3, 1, "dp1");

    const { data: dp2Rows, error } = await supabase
      .from("shelf_bundles")
      .select("id")
      .eq("plan_id", planId)
      .eq("cohort", "dp2");
    if (error) throw error;
    expect(dp2Rows.some((r) => r.id === dp1Shelf.id)).toBe(false);

    const { data: dp1Rows } = await supabase
      .from("shelf_bundles")
      .select("id")
      .eq("plan_id", planId)
      .eq("cohort", "dp1");
    expect((dp1Rows ?? []).some((r) => r.id === dp1Shelf.id)).toBe(true);
  });

  it("cohort-integrity: unshelve places the bundle into its OWN stored cohort, ignoring a wrong caller cohort", async () => {
    // Park a dp1 bundle, then place it back with the WRONG caller cohort (dp2). Because
    // place_course does not couple a course to a cohort, a trusted p_cohort would land the
    // dp1 course on the dp2 board. unshelve_bundle must derive the cohort from the shelf row,
    // so the bundle returns to dp1 regardless of what the caller passes (the S-06 safety net).
    await place(6, 1, courseA, undefined, "dp1");
    const shelf = await shelve(6, 1, "dp1");
    expect(shelf.cohort).toBe("dp1");

    const restored = await unshelve(shelf.id, 6, 2, "dp2"); // caller lies: passes dp2
    expect(restored).toHaveLength(1);
    expect(restored.every((p) => p.cohort === "dp1")).toBe(true);

    // Landed on dp1 (the shelf's stored cohort), never on dp2 (the wrong caller cohort).
    expect(await placementsAt(6, 2, "dp1")).toHaveLength(1);
    expect(await placementsAt(6, 2, "dp2")).toHaveLength(0);
    expect(await shelfBundleExists(shelf.id)).toBe(false);
  });

  it("week fidelity: an A/B parked course round-trips its week", async () => {
    await place(4, 1, biweekly, "a");
    const shelf = await shelve(4, 1);

    const parked = await shelfCourses(shelf.id);
    expect(parked).toHaveLength(1);
    expect(parked[0].week).toBe("a");

    const restored = await unshelve(shelf.id, 4, 2);
    expect(restored).toHaveLength(1);
    expect(restored[0].week).toBe("a");
  });

  it("optional fidelity: a marked member's flag survives park → shelf twin → unpark", async () => {
    await placeCourse(supabase, { planId, cohort: "dp1", courseId: courseC, day: 4, period: 3, isOptional: true });
    const shelf = await shelve(4, 3);

    // The shelf twin carries the flag while parked (no invisible pending-decision state).
    const { data: parked, error } = await supabase
      .from("shelf_bundle_courses")
      .select("course_id, is_optional")
      .eq("plan_id", planId)
      .eq("shelf_bundle_id", shelf.id);
    if (error) throw error;
    expect(parked[0]?.is_optional).toBe(true);

    // Unshelve re-places through place_course with the stored flag — the placement is optional again.
    const restored = await unshelve(shelf.id, 4, 4);
    expect(restored[0]?.is_optional).toBe(true);
  });

  it("merge: unshelve onto a cell already holding the course preserves the board row's optional flag", async () => {
    // Board twin: a placed course with a pending optional decision.
    const placed = await placeCourse(supabase, {
      planId,
      cohort: "dp1",
      courseId: courseC,
      day: 7,
      period: 1,
      isOptional: true,
    });
    // Shelf twin of the SAME course, parked non-optional (e.g. parked before the decision was made).
    const { data: card, error } = await supabase.rpc("shelve_courses", {
      p_plan_id: planId,
      p_cohort: "dp1",
      p_course_ids: [courseC],
      p_weeks: ["both"],
      p_optionals: [false],
    });
    if (error) throw error;

    // The merge case: place-back lands on the twin's cell. place_course hits placements_unique;
    // its conflict update must NOT clobber the board row's flag with the shelf twin's
    // (20260707140000 — is_optional is single-writer, applied to fresh inserts only).
    const restored = await unshelve(card.id, 7, 1);
    expect(restored).toHaveLength(1);
    expect(restored[0].id).toBe(placed.id);
    expect(restored[0].is_optional).toBe(true);

    const { data: row } = await supabase.from("placements").select("is_optional").eq("id", placed.id).single();
    expect(row?.is_optional).toBe(true);
  });

  it("shelve_courses parks explicit optional flags via the third parallel array (and defaults false without it)", async () => {
    const { data: withFlags, error: flagErr } = await supabase.rpc("shelve_courses", {
      p_plan_id: planId,
      p_cohort: "dp1",
      p_course_ids: [courseA, courseB],
      p_weeks: ["both", "both"],
      p_optionals: [true, false],
    });
    if (flagErr) throw flagErr;
    const { data: parked } = await supabase
      .from("shelf_bundle_courses")
      .select("course_id, is_optional")
      .eq("plan_id", planId)
      .eq("shelf_bundle_id", withFlags.id);
    expect(parked?.find((m) => m.course_id === courseA)?.is_optional).toBe(true);
    expect(parked?.find((m) => m.course_id === courseB)?.is_optional).toBe(false);

    // The 4-arg legacy call still resolves (p_optionals defaults null → coalesced false per member).
    const { data: withoutFlags, error: legacyErr } = await supabase.rpc("shelve_courses", {
      p_plan_id: planId,
      p_cohort: "dp1",
      p_course_ids: [courseC],
      p_weeks: ["both"],
    });
    if (legacyErr) throw legacyErr;
    const { data: legacyParked } = await supabase
      .from("shelf_bundle_courses")
      .select("is_optional")
      .eq("plan_id", planId)
      .eq("shelf_bundle_id", withoutFlags.id);
    expect(legacyParked?.[0]?.is_optional).toBe(false);
  });

  it("guard: shelve_bundle on an empty cell raises and mints no orphan shelf header", async () => {
    const { count: before } = await supabase
      .from("shelf_bundles")
      .select("id", { count: "exact", head: true })
      .eq("plan_id", planId);

    const { error } = await supabase.rpc("shelve_bundle", {
      p_plan_id: planId,
      p_cohort: "dp1",
      p_day: 3,
      p_period: 4,
    });
    expect(error?.message).toContain("shelve_bundle: no placements at cell");

    const { count: after } = await supabase
      .from("shelf_bundles")
      .select("id", { count: "exact", head: true })
      .eq("plan_id", planId);
    expect(after).toBe(before);
  });

  it("guard: shelve_courses with an empty course set raises and mints no orphan shelf header", async () => {
    const { count: before } = await supabase
      .from("shelf_bundles")
      .select("id", { count: "exact", head: true })
      .eq("plan_id", planId);

    const { error } = await supabase.rpc("shelve_courses", {
      p_plan_id: planId,
      p_cohort: "dp1",
      p_course_ids: [],
      p_weeks: [],
    });
    expect(error?.message).toContain("shelve_courses: empty course set");

    const { count: after } = await supabase
      .from("shelf_bundles")
      .select("id", { count: "exact", head: true })
      .eq("plan_id", planId);
    expect(after).toBe(before);
  });

  it("shelve_courses parks an arbitrary course-set directly with the given weeks", async () => {
    // The off-board park (a palette grouping never placed): no cell, no placements read.
    const { data, error } = await supabase.rpc("shelve_courses", {
      p_plan_id: planId,
      p_cohort: "dp1",
      p_course_ids: [courseA, biweekly],
      p_weeks: ["both", "a"],
    });
    if (error) throw error;
    expect(data.cohort).toBe("dp1");

    const parked = await shelfCourses(data.id);
    expect(new Set(parked.map((p) => p.course_id))).toEqual(new Set([courseA, biweekly]));
    expect(parked.find((p) => p.course_id === biweekly)?.week).toBe("a");
    expect(parked.find((p) => p.course_id === courseA)?.week).toBe("both");
  });

  it("discard: delete_shelf_bundle removes the header and cascades its courses (plan-/cohort-scoped)", async () => {
    // A dp1 shelf to discard, and a dp2 sibling shelf that must stay untouched.
    await place(5, 1, courseA, undefined, "dp1");
    const dp1Shelf = await shelve(5, 1, "dp1");
    await place(5, 1, courseB, undefined, "dp2");
    const dp2Shelf = await shelve(5, 1, "dp2");

    expect(await shelfCourses(dp1Shelf.id)).toHaveLength(1);

    await discard(dp1Shelf.id);

    expect(await shelfBundleExists(dp1Shelf.id)).toBe(false);
    expect(await shelfCourses(dp1Shelf.id)).toHaveLength(0); // courses cascaded
    // The sibling cohort's shelf row is untouched.
    expect(await shelfBundleExists(dp2Shelf.id)).toBe(true);
    expect(await shelfCourses(dp2Shelf.id)).toHaveLength(1);
  });

  it("clone: clone_plan carries a parked bundle under fresh, internally-consistent ids", async () => {
    // Self-contained source: a CSV-seeded catalog + one parked bundle (A, B) on dp1.
    const srcId = await createFactoryPlan(supabase, { name: "Shelf Clone Source" });
    const catalog = await seedPlanCatalog(supabase, srcId);
    const dp1 = catalog.courses.filter((c) => c.cohort === "dp1");
    if (dp1.length < 2) throw new Error("seed needs two dp1 courses");
    await placeCourse(supabase, { planId: srcId, cohort: "dp1", courseId: dp1[0].id, day: 1, period: 1 });
    await placeCourse(supabase, { planId: srcId, cohort: "dp1", courseId: dp1[1].id, day: 1, period: 1 });
    const { data: srcShelf, error: shelveErr } = await supabase.rpc("shelve_bundle", {
      p_plan_id: srcId,
      p_cohort: "dp1",
      p_day: 1,
      p_period: 1,
    });
    if (shelveErr) throw shelveErr;

    const { data: cloneId, error: cloneErr } = await supabase.rpc("clone_plan", {
      p_source_plan_id: srcId,
      p_name: "Shelf Clone Dest",
    });
    if (cloneErr) throw cloneErr;
    registerPlan(cloneId);

    // The clone has exactly one shelf bundle, under a fresh id, with its course set remapped.
    const { data: cloneShelves } = await supabase.from("shelf_bundles").select("id, cohort").eq("plan_id", cloneId);
    expect(cloneShelves).toHaveLength(1);
    const cloneShelf = cloneShelves?.[0];
    if (!cloneShelf) throw new Error("clone has no shelf bundle");
    expect(cloneShelf.id).not.toBe(srcShelf.id); // fresh id
    expect(cloneShelf.cohort).toBe("dp1");

    const cloneCourseIds = new Set(
      (await supabase.from("courses").select("id").eq("plan_id", cloneId)).data?.map((c) => c.id) ?? [],
    );
    const { data: cloneShelfCourses } = await supabase
      .from("shelf_bundle_courses")
      .select("course_id")
      .eq("plan_id", cloneId)
      .eq("shelf_bundle_id", cloneShelf.id);
    expect(cloneShelfCourses).toHaveLength(2);
    for (const sc of cloneShelfCourses ?? []) {
      expect(cloneCourseIds.has(sc.course_id), "shelf course references the clone's own course").toBe(true);
    }
  });
});
