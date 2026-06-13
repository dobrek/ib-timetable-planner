import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";

// Drives the clone_plan RPC directly against the seeded local Supabase with the
// service_role/secret client (bypasses RLS for setup + assertions), mirroring the
// students-crud harness. Skips when the env/stack is unavailable.
//
// Coverage (plan.md Phase 2 #5): deep-copy completeness (row counts per table),
// UUID remap (no cloned row references a source-plan row), cross-plan isolation
// under mutation, per-plan teachers.code uniqueness, and repeated cloning.
//
// Other integration suites mutate "Seed Plan A" (the endpoint test persists
// groupings) while files run in parallel, so this suite first snapshots the seed
// plan with one atomic clone_plan call and uses that frozen base as its source.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PLAN_NAME = "Seed Plan A";

const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

const PLAN_TABLES = [
  "teachers",
  "courses",
  "students",
  "student_choices",
  "course_overlaps",
  "course_merges",
  "placements",
  "course_groupings",
  "course_grouping_members",
] as const;

(hasEnv ? describe : describe.skip)("clone_plan RPC (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;
  let sourcePlanId: string;
  const createdPlanIds: string[] = [];

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

    const { data: seedPlan, error } = await supabase.from("plans").select("id").eq("name", PLAN_NAME).limit(1).single();
    if (error) throw new Error(`Seed plan "${PLAN_NAME}" not found — re-run supabase db reset: ${error.message}`);

    // Atomic snapshot of the seed plan: the frozen source for every test below.
    sourcePlanId = await clonePlan(seedPlan.id, "Clone Test Base");
  });

  afterAll(async () => {
    // Deleting the plans rows cascades each whole cloned scenario.
    if (createdPlanIds.length > 0) await supabase.from("plans").delete().in("id", createdPlanIds);
  });

  const countRows = async (table: (typeof PLAN_TABLES)[number], planId: string): Promise<number> => {
    const { count, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("plan_id", planId);
    if (error) throw error;
    return count ?? 0;
  };

  const clonePlan = async (source: string, name: string): Promise<string> => {
    const { data, error } = await supabase.rpc("clone_plan", { p_source_plan_id: source, p_name: name });
    if (error) throw error;
    createdPlanIds.push(data);
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

    // The one plain (non-composite) FK: cloned courses' teacher_id values must
    // point at the clone's own teachers, never the source's.
    const sourceTeacherIds = await idsOf("teachers", sourcePlanId);
    const cloneTeacherIds = await idsOf("teachers", cloneId);
    const { data: clonedCourses } = await supabase.from("courses").select("teacher_id").eq("plan_id", cloneId);
    for (const course of clonedCourses ?? []) {
      if (course.teacher_id === null) continue;
      expect(cloneTeacherIds.has(course.teacher_id)).toBe(true);
      expect(sourceTeacherIds.has(course.teacher_id)).toBe(false);
    }

    // teachers.code duplicates across plans without conflict (per-plan unique).
    const codes = async (planId: string) => {
      const { data } = await supabase.from("teachers").select("code").eq("plan_id", planId);
      return (data ?? []).map((t) => t.code).sort();
    };
    expect(await codes(cloneId)).toEqual(await codes(sourcePlanId));
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

    await supabase.from("placements").insert({ plan_id: warmId, cohort: "dp1", day: 1, period: 1, course_id: courseA });
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

  it("clones teacher_availability with teacher_id remapped to the clone's teachers", async () => {
    // Warm plan so the frozen base is never mutated. Give one warm teacher a single
    // availability cell, clone again, and assert the cell carries over with its
    // teacher_id remapped through _teacher_map (not coordinate-only like slot_bundles).
    const warmId = await clonePlan(sourcePlanId, "Clone Test 4 (warm avail)");
    const { data: warmTeacher } = await supabase.from("teachers").select("id").eq("plan_id", warmId).limit(1).single();
    if (!warmTeacher) throw new Error("warm clone has no teachers");

    await supabase
      .from("teacher_availability")
      .insert({ plan_id: warmId, teacher_id: warmTeacher.id, day: 2, period: 3, severity: "strong" });

    const finalId = await clonePlan(warmId, "Clone Test 4 (final avail)");
    const finalTeacherIds = await idsOf("teachers", finalId);
    const warmTeacherIds = await idsOf("teachers", warmId);

    const { data: finalAvail } = await supabase
      .from("teacher_availability")
      .select("teacher_id, day, period, severity")
      .eq("plan_id", finalId);
    expect(finalAvail).toHaveLength(1);
    const row = finalAvail?.[0];
    if (!row) throw new Error("final clone has no availability");
    expect(row.day).toBe(2);
    expect(row.period).toBe(3);
    expect(row.severity).toBe("strong");
    // teacher_id points at the clone's own teachers, never the warm source's.
    expect(finalTeacherIds.has(row.teacher_id)).toBe(true);
    expect(warmTeacherIds.has(row.teacher_id)).toBe(false);
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
