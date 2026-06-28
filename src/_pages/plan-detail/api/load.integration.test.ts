import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { addAvailability, createPlan, seedPlanCatalog, teardown } from "@/test/factories";
import { loadCombinedPlannerData } from "./load";

// Proves `loadCombinedPlannerData` ships the teacher/student name records the collision
// detail Dialog resolves ids through: every `teacherKey`/`studentKey` present in
// the returned dp1 validation catalog must be covered, and a teacher without a
// `full_name` must resolve to their `code` (the factory seeds teachers with code
// only, like the seed). The focus-mode read is now a combined read — assert on
// `result.value.dp1`. Local-only: connects with the service_role/secret key
// (bypasses RLS); skips cleanly when the env or stack is unavailable. Owns a
// factory-seeded plan whose cohorts the board loads.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

// File-level lifecycle: one shared client and a single teardown drained once at
// the end. Both describe blocks register into the same file-scoped plan registry,
// so a per-block afterAll would let the first block's teardown delete the second's
// plan; a single file-level teardown removes that execution-order dependency.
let supabase: SupabaseClient<Database>;

beforeAll(() => {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
});

afterAll(async () => {
  await teardown(supabase);
});

(hasEnv ? describe : describe.skip)("loadCombinedPlannerData name records (dp1)", () => {
  let planId: string;

  beforeAll(async () => {
    planId = await createPlan(supabase);
    await seedPlanCatalog(supabase, planId);
  });

  it("ships name records covering every teacher and student key in the catalog", async () => {
    const result = await loadCombinedPlannerData(supabase, planId);
    if (!result.ok) throw new Error(`loadCombinedPlannerData failed: ${JSON.stringify(result.error)}`);
    const { catalog, teacherNames, studentNames } = result.value.dp1;

    expect(catalog.length).toBeGreaterThan(0);
    expect(Object.keys(teacherNames).length).toBeGreaterThan(0);
    expect(Object.keys(studentNames).length).toBeGreaterThan(0);

    const uncoveredTeachers = catalog.flatMap((course) => course.teacherKeys).filter((key) => !(key in teacherNames));
    expect(uncoveredTeachers).toEqual([]);

    const uncoveredStudents = catalog.flatMap((course) => course.studentKeys).filter((key) => !(key in studentNames));
    expect(uncoveredStudents).toEqual([]);
  });

  it("resolves a teacher without full_name to their code", async () => {
    const result = await loadCombinedPlannerData(supabase, planId);
    if (!result.ok) throw new Error(`loadCombinedPlannerData failed: ${JSON.stringify(result.error)}`);
    const { teacherNames } = result.value.dp1;

    const { data: teachers, error } = await supabase
      .from("teachers")
      .select("id, code, full_name")
      .eq("plan_id", planId)
      .in("id", Object.keys(teacherNames));
    if (error) throw new Error(`Teacher lookup failed: ${error.message}`);

    const nameless = teachers.filter((teacher) => teacher.full_name === null);
    expect(nameless.length).toBeGreaterThan(0); // the factory seeds teachers with code only
    for (const teacher of nameless) expect(teacherNames[teacher.id]).toBe(teacher.code);
  });
});

// Self-contained (factory plan + one teacher + one availability cell) — proves the
// board loader fetches availability by plan only (cohort-independent) and projects
// each row to the island shape. Already bare-plan; now uses the factory for the
// plan lifecycle for consistency.
(hasEnv ? describe : describe.skip)("loadCombinedPlannerData availability shape", () => {
  it("ships availability cells projected to teacherKey/day/period/severity", async () => {
    const planId = await createPlan(supabase, { name: "Avail Load Probe" });

    const { data: teacher, error: teacherError } = await supabase
      .from("teachers")
      .insert({ plan_id: planId, code: "AVL", full_name: "Avail Loader" })
      .select("id")
      .single();
    if (teacherError) throw teacherError;

    await addAvailability(supabase, { planId, teacherId: teacher.id, day: 3, period: 2, severity: "strong" });

    const result = await loadCombinedPlannerData(supabase, planId);
    if (!result.ok) throw new Error(`loadCombinedPlannerData failed: ${JSON.stringify(result.error)}`);
    expect(result.value.dp1.availability).toEqual([{ teacherKey: teacher.id, day: 3, period: 2, severity: "strong" }]);
  });
});
