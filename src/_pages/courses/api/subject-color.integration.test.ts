import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCohortCourses, type Database } from "@/shared/api";
import { computeCatalogHash } from "@/shared/lib/catalog-hash";
import { createPlan, registerPlan, seedPlanCatalog, teardown } from "@/test/factories";
import { loadCatalog } from "./loader";

// Subject-color persistence across the DB/SQL/SSR seams that pass type-check + unit tests but
// can only break end-to-end (per lessons.md — catalog integration belongs in the harness):
//   1. round-trip — a colored course read back through BOTH read paths (board + catalog);
//   2. clone carry — clone_plan preserves color (the explicit-column-list silent-drop guard);
//   3. isolation — a color-only edit leaves the catalog hash unchanged (color ⇏ stale).
// Drives the local Supabase with the service_role client; skips when the stack is unavailable.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

(hasEnv ? describe : describe.skip)("subject color persistence (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;

  beforeAll(() => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
  });

  afterAll(async () => {
    await teardown(supabase);
  });

  it("round-trips a course color through both read paths (board + catalog)", async () => {
    const planId = await createPlan(supabase, { name: "Subject Color Round-Trip" });
    await seedPlanCatalog(supabase, planId);

    // Pick a course that appears in the board projection, then color it.
    const before = await loadCohortCourses(supabase, planId, "dp1");
    const courseId = [...before.courseDisplay.keys()][0];
    expect(courseId).toBeDefined();
    await supabase.from("courses").update({ color: "rose" }).eq("id", courseId);

    // Board read path: the display side map carries the resolved color key.
    const board = await loadCohortCourses(supabase, planId, "dp1");
    expect(board.courseDisplay.get(courseId)?.color).toBe("rose");

    // Catalog read path: CourseRow.color pre-fills the editor swatch.
    const catalog = await loadCatalog(supabase, planId);
    expect(catalog.ok).toBe(true);
    if (!catalog.ok) throw new Error("catalog unavailable");
    expect(catalog.value.courses.find((c) => c.id === courseId)?.color).toBe("rose");
  });

  it("carries a course color through clone_plan (silent-drop guard)", async () => {
    const planId = await createPlan(supabase, { name: "Subject Color Clone Source" });
    await seedPlanCatalog(supabase, planId);

    const board = await loadCohortCourses(supabase, planId, "dp1");
    const courseId = [...board.courseDisplay.keys()][0];
    await supabase.from("courses").update({ color: "emerald" }).eq("id", courseId);

    const { data: cloneId, error } = await supabase.rpc("clone_plan", {
      p_source_plan_id: planId,
      p_name: "Subject Color Clone Dest",
    });
    if (error) throw error;
    registerPlan(cloneId);

    const countColored = async (plan: string): Promise<number> => {
      const { count, error: countError } = await supabase
        .from("courses")
        .select("*", { count: "exact", head: true })
        .eq("plan_id", plan)
        .eq("color", "emerald");
      if (countError) throw countError;
      return count ?? 0;
    };
    // The source has exactly one emerald course; the clone must too — a dropped column reads 0.
    expect(await countColored(planId)).toBe(1);
    expect(await countColored(cloneId)).toBe(1);
  });

  it("leaves groupings non-stale after a color-only edit (isolation)", async () => {
    const planId = await createPlan(supabase, { name: "Subject Color Isolation" });
    await seedPlanCatalog(supabase, planId);

    // Hash the live dp1 projection and store it on a groupings row (the enumeration itself is
    // irrelevant to isolation; we only need a stored catalog_hash to compare staleness against —
    // mirrors the clone suite's direct-insert pattern, far lighter than full grouping compute).
    const before = await loadCohortCourses(supabase, planId, "dp1");
    const storedHash = await computeCatalogHash(before.courses);
    const { error: insertError } = await supabase
      .from("course_groupings")
      .insert({ plan_id: planId, cohort: "dp1", coverage_count: 1, score: 1, catalog_hash: storedHash });
    if (insertError) throw insertError;

    // Edit ONLY a course's color.
    const courseId = [...before.courseDisplay.keys()][0];
    await supabase.from("courses").update({ color: "violet" }).eq("id", courseId);

    // The GroupingCourse projection excludes color, so the recomputed hash is unchanged → not stale.
    const after = await loadCohortCourses(supabase, planId, "dp1");
    expect(await computeCatalogHash(after.courses)).toBe(storedHash);
  });
});
