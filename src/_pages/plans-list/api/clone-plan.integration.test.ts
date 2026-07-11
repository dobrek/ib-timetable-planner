import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import {
  computeGroupingsFor,
  createPlan as createFactoryPlan,
  placeCourse,
  registerPlan,
  seedPlanCatalog,
  teardown,
} from "@/test/factories";

// Drives the clone_plan RPC directly against the local Supabase with the
// service_role/secret client (bypasses RLS for setup + assertions). Skips when the
// env/stack is unavailable.
//
// Coverage (plan.md Phase 2 #5): deep-copy completeness (row counts per table),
// UUID remap (no cloned row references a source-plan row), cross-plan isolation
// under mutation, per-plan teachers.code uniqueness, and repeated cloning.
//
// Plan-rooted isolation: the source is a factory-owned, CSV-seeded plan carrying a
// full output graph (a dp2 placement + dp2 groupings, staged so the dp1-focused
// test below can't collide). Every created/cloned plan is registered for teardown.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

const PLAN_TABLES = [
  "teachers",
  "courses",
  "course_teachers",
  "students",
  "student_choices",
  "course_overlaps",
  "course_merges",
  "placements",
  "bundles",
  "course_groupings",
  "course_grouping_members",
] as const;

// The catalog travels with a catalog-only clone; the board resets to empty. Together
// they cover every plan-scoped table the clone_plan RPC touches (superset of PLAN_TABLES).
const CATALOG_TABLES = [
  "teachers",
  "teacher_availability",
  "courses",
  "course_teachers",
  "students",
  "student_choices",
  "course_overlaps",
  "course_merges",
] as const;

const BOARD_TABLES = [
  "bundles",
  "placements",
  "course_groupings",
  "course_grouping_members",
  "shelf_bundles",
  "shelf_bundle_courses",
] as const;

(hasEnv ? describe : describe.skip)("clone_plan RPC (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;
  let sourcePlanId: string;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

    // Factory-owned, CSV-seeded source with a full output graph so the deep-copy
    // test exercises placements + groupings copy, not just the catalog. Output is
    // staged on dp2; the warm-clone test below operates on dp1, so they never collide.
    sourcePlanId = await createFactoryPlan(supabase, { name: "Clone Test Base" });
    const catalog = await seedPlanCatalog(supabase, sourcePlanId);
    const dp2Course = catalog.courses.find((c) => c.cohort === "dp2");
    if (!dp2Course) throw new Error("seeded catalog has no dp2 course");
    await placeCourse(supabase, { planId: sourcePlanId, cohort: "dp2", courseId: dp2Course.id, day: 1, period: 1 });
    await computeGroupingsFor(supabase, { planId: sourcePlanId, cohort: "dp2" });
  });

  afterAll(async () => {
    // Cascade-deletes every registered plan (source + all clones).
    await teardown(supabase);
  });

  const countRows = async (
    table: (typeof CATALOG_TABLES)[number] | (typeof BOARD_TABLES)[number],
    planId: string,
  ): Promise<number> => {
    const { count, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("plan_id", planId);
    if (error) throw error;
    return count ?? 0;
  };

  const clonePlan = async (source: string, name: string, includeBoard = true): Promise<string> => {
    const { data, error } = await supabase.rpc("clone_plan", {
      p_source_plan_id: source,
      p_name: name,
      p_include_board: includeBoard,
    });
    if (error) throw error;
    registerPlan(data);
    return data;
  };

  const idsOf = async (table: "teachers" | "courses" | "students", planId: string): Promise<Set<string>> => {
    const { data, error } = await supabase.from(table).select("id").eq("plan_id", planId);
    if (error) throw error;
    return new Set(data.map((r) => r.id));
  };

  it("deep-copies a plan: per-table row counts match and every row is remapped", async () => {
    const cloneId = await clonePlan(sourcePlanId, "Clone Test 1");
    expect(cloneId).not.toBe(sourcePlanId);

    for (const table of PLAN_TABLES) {
      expect(await countRows(table, cloneId), table).toBe(await countRows(table, sourcePlanId));
    }

    // UUID remap: cloned root-table rows share no ids with the source.
    for (const table of ["teachers", "courses", "students"] as const) {
      const sourceIds = await idsOf(table, sourcePlanId);
      const cloneIds = await idsOf(table, cloneId);
      expect(cloneIds.size, table).toBe(sourceIds.size);
      for (const id of cloneIds) expect(sourceIds.has(id), `${table} id leaked from source`).toBe(false);
    }

    // course_teachers double-remap: every cloned junction row references the clone's own
    // course AND its own teacher — never a source-plan id (the composite FKs would have
    // failed the clone loudly otherwise; this asserts the remap, not just survival). The
    // legacy courses.teacher_id scalar was dropped — the junction is the only teacher link.
    const sourceTeacherIds = await idsOf("teachers", sourcePlanId);
    const cloneTeacherIds = await idsOf("teachers", cloneId);
    const sourceCourseIds = await idsOf("courses", sourcePlanId);
    const cloneCourseIds = await idsOf("courses", cloneId);
    const { data: clonedCourseTeachers } = await supabase
      .from("course_teachers")
      .select("course_id, teacher_id")
      .eq("plan_id", cloneId);
    expect((clonedCourseTeachers ?? []).length).toBeGreaterThan(0);
    for (const link of clonedCourseTeachers ?? []) {
      expect(cloneCourseIds.has(link.course_id)).toBe(true);
      expect(sourceCourseIds.has(link.course_id)).toBe(false);
      expect(cloneTeacherIds.has(link.teacher_id)).toBe(true);
      expect(sourceTeacherIds.has(link.teacher_id)).toBe(false);
    }

    // teachers.code duplicates across plans without conflict (per-plan unique).
    const codes = async (planId: string) => {
      const { data } = await supabase.from("teachers").select("code").eq("plan_id", planId);
      return (data ?? []).map((t) => t.code).sort();
    };
    expect(await codes(cloneId)).toEqual(await codes(sourcePlanId));
  });

  it("catalog-only clone (include_board=false): copies the catalog, leaves every board table empty", async () => {
    // The source carries a warm board (dp2 placement + groupings from beforeAll), so the
    // "clone board is empty" assertions below have real contrast rather than 0 === 0.
    expect(await countRows("placements", sourcePlanId)).toBeGreaterThan(0);
    expect(await countRows("course_groupings", sourcePlanId)).toBeGreaterThan(0);

    const cloneId = await clonePlan(sourcePlanId, "Catalog Only Clone", false);
    expect(cloneId).not.toBe(sourcePlanId);

    // (a) Catalog parity: every catalog table matches the source row-for-row.
    for (const table of CATALOG_TABLES) {
      expect(await countRows(table, cloneId), table).toBe(await countRows(table, sourcePlanId));
    }

    // (b) Board reset: every board table is empty on the clone — the standing guard against a
    // future board-table copy being added outside the `if p_include_board` block.
    for (const table of BOARD_TABLES) {
      expect(await countRows(table, cloneId), table).toBe(0);
    }

    // (c) Catalog root ids are freshly minted — nothing leaks from the source.
    for (const table of ["teachers", "courses", "students"] as const) {
      const sourceIds = await idsOf(table, sourcePlanId);
      const cloneIds = await idsOf(table, cloneId);
      expect(cloneIds.size, table).toBe(sourceIds.size);
      for (const id of cloneIds) expect(sourceIds.has(id), `${table} id leaked from source`).toBe(false);
    }
  });

  it("isolates the clone: mutating its catalog leaves the source untouched", async () => {
    const cloneId = await clonePlan(sourcePlanId, "Clone Test 2");
    const sourceStudentCount = await countRows("students", sourcePlanId);
    const sourceChoiceCount = await countRows("student_choices", sourcePlanId);

    // Rename one cloned student.
    const { data: cloneStudent } = await supabase
      .from("students")
      .select("id, full_name")
      .eq("plan_id", cloneId)
      .limit(1)
      .single();
    if (!cloneStudent) throw new Error("clone has no students");
    await supabase.from("students").update({ full_name: "Mutated In Clone" }).eq("id", cloneStudent.id);

    // Delete another cloned student (cascades its choices within the clone only).
    const { data: victim } = await supabase
      .from("students")
      .select("id")
      .eq("plan_id", cloneId)
      .neq("id", cloneStudent.id)
      .limit(1)
      .single();
    if (!victim) throw new Error("clone has fewer than two students");
    await supabase.from("students").delete().eq("id", victim.id);

    expect(await countRows("students", cloneId)).toBe(sourceStudentCount - 1);
    expect(await countRows("students", sourcePlanId)).toBe(sourceStudentCount);
    expect(await countRows("student_choices", sourcePlanId)).toBe(sourceChoiceCount);
    const { count: mutatedInSource } = await supabase
      .from("students")
      .select("*", { count: "exact", head: true })
      .eq("plan_id", sourcePlanId)
      .eq("full_name", "Mutated In Clone");
    expect(mutatedInSource ?? 0).toBe(0);
  });

  it("clones placements and groupings with members remapped to the clone's courses", async () => {
    // Stage a warm plan without touching the base: clone first, then pin its dp1
    // groupings to exactly one (replace_cohort_groupings deletes the rest) and add
    // a placement, then clone that. Assertions scope to dp1 and compare against the
    // warm plan rather than absolute counts — the base snapshot may already carry
    // placements/groupings (e.g. from manual board testing on the seed plan).
    const warmId = await clonePlan(sourcePlanId, "Clone Test 3 (warm)");
    const { data: warmCourses } = await supabase
      .from("courses")
      .select("id")
      .eq("plan_id", warmId)
      .eq("cohort", "dp1")
      .limit(2);
    const [courseA, courseB] = (warmCourses ?? []).map((c) => c.id);
    if (!courseA || !courseB) throw new Error("warm clone has fewer than two dp1 courses");

    await placeCourse(supabase, { planId: warmId, cohort: "dp1", courseId: courseA, day: 1, period: 1 });
    const { error: rpcError } = await supabase.rpc("replace_cohort_groupings", {
      p_plan_id: warmId,
      p_cohort: "dp1",
      p_catalog_hash: "warm-hash",
      p_groupings: [{ coverage_count: 2, score: 1.5, member_ids: [courseA, courseB] }],
    });
    if (rpcError) throw rpcError;

    const finalId = await clonePlan(warmId, "Clone Test 3 (final)");
    const finalCourseIds = await idsOf("courses", finalId);
    const warmCourseIds = await idsOf("courses", warmId);

    const { count: warmPlacementCount } = await supabase
      .from("placements")
      .select("*", { count: "exact", head: true })
      .eq("plan_id", warmId)
      .eq("cohort", "dp1");
    const { data: finalPlacements } = await supabase
      .from("placements")
      .select("course_id, day, period")
      .eq("plan_id", finalId)
      .eq("cohort", "dp1");
    expect(finalPlacements).toHaveLength(warmPlacementCount ?? -1);
    expect(finalPlacements?.length).toBeGreaterThan(0);
    for (const placement of finalPlacements ?? []) {
      expect(finalCourseIds.has(placement.course_id)).toBe(true);
      expect(warmCourseIds.has(placement.course_id), "placement course leaked from source").toBe(false);
    }

    const { data: finalGroupings } = await supabase
      .from("course_groupings")
      .select("id, catalog_hash")
      .eq("plan_id", finalId)
      .eq("cohort", "dp1");
    expect(finalGroupings).toHaveLength(1);
    const grouping = finalGroupings?.[0];
    if (!grouping) throw new Error("final clone has no dp1 grouping");
    // catalog_hash is copied as-is (JS-side recompute happens in the Phase 4
    // domain function, not the RPC).
    expect(grouping.catalog_hash).toBe("warm-hash");

    const { data: members } = await supabase
      .from("course_grouping_members")
      .select("course_id")
      .eq("plan_id", finalId)
      .eq("grouping_id", grouping.id);
    expect(members).toHaveLength(2);
    for (const member of members ?? []) {
      expect(finalCourseIds.has(member.course_id)).toBe(true);
    }
  });

  it("clones bundles with fresh ids and placements referencing them (no source-plan leaks)", async () => {
    // Self-contained source: a CSV-seeded catalog + two placements at distinct cells, so the
    // clone must remap two bundles. Bundle identity (the UUID) is freshly minted per the clone
    // discipline; each cloned placement.bundle_id must point at the clone's OWN bundle, never
    // the source's — the composite FK (plan_id, bundle_id) would have failed the clone loudly
    // otherwise, so this asserts the remap, not just survival.
    const srcId = await createFactoryPlan(supabase, { name: "Bundle Clone Source" });
    const catalog = await seedPlanCatalog(supabase, srcId);
    const dp1 = catalog.courses.filter((c) => c.cohort === "dp1");
    if (dp1.length < 2) throw new Error("seed needs two dp1 courses");
    await placeCourse(supabase, { planId: srcId, cohort: "dp1", courseId: dp1[0].id, day: 1, period: 1 });
    await placeCourse(supabase, { planId: srcId, cohort: "dp1", courseId: dp1[1].id, day: 2, period: 2 });

    const cloneId = await clonePlan(srcId, "Bundle Clone Dest");

    const bundleIds = async (planId: string): Promise<Set<string>> => {
      const { data } = await supabase.from("bundles").select("id").eq("plan_id", planId);
      return new Set((data ?? []).map((b) => b.id));
    };
    const srcBundleIds = await bundleIds(srcId);
    const cloneBundleIds = await bundleIds(cloneId);

    // One bundle per non-empty cell, count preserved, ids freshly minted (no overlap with source).
    expect(cloneBundleIds.size).toBe(2);
    expect(cloneBundleIds.size).toBe(srcBundleIds.size);
    for (const id of cloneBundleIds) expect(srcBundleIds.has(id), "bundle id leaked from source").toBe(false);

    // Every cloned placement references one of the clone's OWN bundles, never the source's.
    const { data: clonePlacements } = await supabase
      .from("placements")
      .select("bundle_id, day, period")
      .eq("plan_id", cloneId);
    expect((clonePlacements ?? []).length).toBe(2);
    for (const p of clonePlacements ?? []) {
      expect(cloneBundleIds.has(p.bundle_id)).toBe(true);
      expect(srcBundleIds.has(p.bundle_id), "placement references a source-plan bundle").toBe(false);
    }

    // The cloned bundles carry the cells over (one bundle per cell), coords copied verbatim.
    const { data: cloneBundles } = await supabase.from("bundles").select("day, period").eq("plan_id", cloneId);
    const cellKey = (r: { day: number | null; period: number | null }) => `${r.day}:${r.period}`;
    expect(new Set((cloneBundles ?? []).map(cellKey))).toEqual(new Set(["1:1", "2:2"]));
  });

  it("clones teacher_availability with teacher_id remapped to the clone's teachers", async () => {
    // Self-contained bare plan + one teacher + one availability cell — isolated from any
    // availability already on the seed plan (e.g. inserted by hand during manual testing).
    // Asserts the cell carries over with its teacher_id remapped through _teacher_map.
    const srcPlanId = await createFactoryPlan(supabase, { name: "Avail Clone Source" });

    const { data: srcTeacher, error: teacherError } = await supabase
      .from("teachers")
      .insert({ plan_id: srcPlanId, code: "AV1", full_name: "Availability Teacher" })
      .select("id")
      .single();
    if (teacherError) throw teacherError;

    await supabase
      .from("teacher_availability")
      .insert({ plan_id: srcPlanId, teacher_id: srcTeacher.id, day: 2, period: 3, severity: "strong" });

    const cloneId = await clonePlan(srcPlanId, "Avail Clone Dest");
    const cloneTeacherIds = await idsOf("teachers", cloneId);

    const { data: cloneAvail } = await supabase
      .from("teacher_availability")
      .select("teacher_id, day, period, severity")
      .eq("plan_id", cloneId);
    expect(cloneAvail).toHaveLength(1);
    const row = cloneAvail?.[0];
    if (!row) throw new Error("clone has no availability");
    expect(row.day).toBe(2);
    expect(row.period).toBe(3);
    expect(row.severity).toBe("strong");
    // teacher_id points at the clone's own teacher, never the source's.
    expect(cloneTeacherIds.has(row.teacher_id)).toBe(true);
    expect(row.teacher_id).not.toBe(srcTeacher.id);
  });

  it("preserves week columns (week_mode, week, opposite_week) through clone", async () => {
    // Self-contained source: a CSV-seeded catalog (carries bi-weekly EE/CAS), a bi-weekly
    // placement on week 'a', and an opposite-week grouping marker inserted directly (the RPC
    // gains opposite_week in Phase 3; here we assert clone_plan copies the column).
    const srcId = await createFactoryPlan(supabase, { name: "Week Clone Source" });
    const catalog = await seedPlanCatalog(supabase, srcId);
    const biweekly = catalog.courses.find((c) => c.cohort === "dp1" && c.week_mode === "biweekly");
    if (!biweekly) throw new Error("seed has no bi-weekly dp1 course");

    await placeCourse(supabase, { planId: srcId, cohort: "dp1", courseId: biweekly.id, day: 4, period: 5, week: "a" });

    const { data: grouping, error: groupingError } = await supabase
      .from("course_groupings")
      .insert({ plan_id: srcId, cohort: "dp1", coverage_count: 1, score: 1, catalog_hash: "wk", opposite_week: true })
      .select("id")
      .single();
    if (groupingError) throw groupingError;
    await supabase
      .from("course_grouping_members")
      .insert({ plan_id: srcId, grouping_id: grouping.id, course_id: biweekly.id });

    const cloneId = await clonePlan(srcId, "Week Clone Dest");

    // week_mode carried on courses (both states present).
    const { data: clonedCourses } = await supabase.from("courses").select("week_mode").eq("plan_id", cloneId);
    expect((clonedCourses ?? []).some((c) => c.week_mode === "biweekly")).toBe(true);
    expect((clonedCourses ?? []).some((c) => c.week_mode === "agnostic")).toBe(true);

    // week carried on placements.
    const { data: clonedPlacements } = await supabase
      .from("placements")
      .select("week")
      .eq("plan_id", cloneId)
      .eq("cohort", "dp1");
    expect((clonedPlacements ?? []).some((p) => p.week === "a")).toBe(true);

    // opposite_week carried on groupings.
    const { data: clonedGroupings } = await supabase
      .from("course_groupings")
      .select("opposite_week")
      .eq("plan_id", cloneId)
      .eq("cohort", "dp1");
    expect((clonedGroupings ?? []).some((g) => g.opposite_week)).toBe(true);
  });

  it("preserves is_optional through clone (placements + parked shelf members)", async () => {
    // Self-contained source: one optional placement + one parked bundle whose member is flagged.
    // Both explicit column lists in clone_plan (sections 7 and 11) must carry the flag — an
    // omission would silently reset every pending optional decision on plan duplication.
    const srcId = await createFactoryPlan(supabase, { name: "Optional Clone Source" });
    const catalog = await seedPlanCatalog(supabase, srcId);
    const dp1 = catalog.courses.filter((c) => c.cohort === "dp1");
    if (dp1.length < 2) throw new Error("seed needs two dp1 courses");

    await placeCourse(supabase, {
      planId: srcId,
      cohort: "dp1",
      courseId: dp1[0].id,
      day: 1,
      period: 1,
      isOptional: true,
    });
    const { error: shelfError } = await supabase.rpc("shelve_courses", {
      p_plan_id: srcId,
      p_cohort: "dp1",
      p_course_ids: [dp1[1].id],
      p_weeks: ["both"],
      p_optionals: [true],
    });
    if (shelfError) throw shelfError;

    const cloneId = await clonePlan(srcId, "Optional Clone Dest");

    const { data: clonedPlacements } = await supabase
      .from("placements")
      .select("is_optional")
      .eq("plan_id", cloneId)
      .eq("cohort", "dp1");
    expect(clonedPlacements).toHaveLength(1);
    expect(clonedPlacements?.[0]?.is_optional).toBe(true);

    const { data: clonedShelfMembers } = await supabase
      .from("shelf_bundle_courses")
      .select("is_optional")
      .eq("plan_id", cloneId);
    expect(clonedShelfMembers).toHaveLength(1);
    expect(clonedShelfMembers?.[0]?.is_optional).toBe(true);
  });

  it("cloning the same source twice produces two independent plans", async () => {
    const firstId = await clonePlan(sourcePlanId, "Clone Twice 1");
    const secondId = await clonePlan(sourcePlanId, "Clone Twice 2");
    expect(firstId).not.toBe(secondId);

    const courseCount = await countRows("courses", sourcePlanId);
    expect(await countRows("courses", firstId)).toBe(courseCount);
    expect(await countRows("courses", secondId)).toBe(courseCount);

    // Deleting one clone leaves the other (and the source) whole.
    await supabase.from("plans").delete().eq("id", firstId);
    expect(await countRows("courses", firstId)).toBe(0);
    expect(await countRows("courses", secondId)).toBe(courseCount);
    expect(await countRows("courses", sourcePlanId)).toBe(courseCount);
  });
});
