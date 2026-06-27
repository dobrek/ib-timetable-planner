import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { createPlan as createFactoryPlan, placeCourse, seedPlanCatalog, teardown } from "@/test/factories";
import { loadCombinedPlannerData } from "./load";
import { moveBundleMembers } from "./placements";

// Drives the S-06 combined loader + cross-cohort occupancy against local Supabase with the
// service_role client (bypasses RLS for setup + assertions). A teacher shared across cohorts (AP,
// from the seeded catalog) placed in BOTH cohorts must surface SYMMETRIC cross-cohort occupancy, and
// a within-cohort move must re-derive the sibling's occupancy without leaking across cohorts. The
// cross-cohort *move guard* lives in the pure `resolveCombinedDrop` (unit-tested); here we pin its
// server safety net — `moveBundleMembers` is cohort-scoped, so a cross-cohort relocation is
// unrepresentable. Skips when the stack is unavailable.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

type OccupancyCell = { teacherKey: string; day: number; period: number };
const occupiedAt = (cells: OccupancyCell[], teacherKey: string, day: number, period: number): boolean =>
  cells.some((cell) => cell.teacherKey === teacherKey && cell.day === day && cell.period === period);

(hasEnv ? describe : describe.skip)("combined two-cohort loader (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;
  let planId: string;
  let apId: string;
  let dp1CourseId: string;
  let dp2CourseId: string;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
    planId = await createFactoryPlan(supabase, { name: "Combined View Base" });
    await seedPlanCatalog(supabase, planId);

    const { data: teachers, error } = await supabase.from("teachers").select("id, code").eq("plan_id", planId);
    if (error) throw new Error(error.message);
    const ap = teachers.find((teacher) => teacher.code === "AP");
    if (!ap) throw new Error("expected the shared teacher AP in the seeded catalog");
    apId = ap.id;

    // Pick a CATALOG course taught by AP in each cohort — guaranteed resolvable AND cross-cohort shared.
    const seeded = await loadCombinedPlannerData(supabase, planId);
    if (!seeded.ok) throw new Error("combined load failed in setup");
    const dp1Course = seeded.value.dp1.catalog.find((course) => course.teacherKeys.includes(apId));
    const dp2Course = seeded.value.dp2.catalog.find((course) => course.teacherKeys.includes(apId));
    if (!dp1Course || !dp2Course) throw new Error("expected AP to teach a course in each cohort");
    dp1CourseId = dp1Course.id;
    dp2CourseId = dp2Course.id;
  });

  afterAll(async () => {
    await teardown(supabase);
  });

  it("returns both cohorts editable with symmetric cross-cohort occupancy after a commit in each", async () => {
    await placeCourse(supabase, { planId, cohort: "dp1", courseId: dp1CourseId, day: 1, period: 1, week: "both" });
    await placeCourse(supabase, { planId, cohort: "dp2", courseId: dp2CourseId, day: 1, period: 1, week: "both" });

    const result = await loadCombinedPlannerData(supabase, planId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { dp1, dp2 } = result.value;

    // Both cohorts fully editable — each carries its own committed placement.
    expect(dp1.placements.some((p) => p.courseId === dp1CourseId && p.day === 1 && p.period === 1)).toBe(true);
    expect(dp2.placements.some((p) => p.courseId === dp2CourseId && p.day === 1 && p.period === 1)).toBe(true);

    // Symmetric: each cohort's cross-cohort occupancy is derived from the OTHER's placement (FR-006).
    expect(occupiedAt(dp1.crossCohortOccupancy, apId, 1, 1)).toBe(true); // from dp2's placement
    expect(occupiedAt(dp2.crossCohortOccupancy, apId, 1, 1)).toBe(true); // from dp1's placement
  });

  it("a within-cohort move re-derives the sibling's occupancy and never leaks across cohorts", async () => {
    // Move the dp1 placement within dp1 from (1,1) → (3,4). `moveBundleMembers` is cohort-scoped, so
    // a cross-cohort relocation cannot even be expressed at this layer (the guard's server net).
    await moveBundleMembers(supabase, {
      planId,
      cohort: "dp1",
      day: 1,
      period: 1,
      courseIds: [dp1CourseId],
      targetDay: 3,
      targetPeriod: 4,
    });

    const result = await loadCombinedPlannerData(supabase, planId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { dp1, dp2 } = result.value;

    // dp1's placement moved within dp1; dp2's stayed put (no cross-cohort leak).
    expect(dp1.placements.some((p) => p.courseId === dp1CourseId && p.day === 3 && p.period === 4)).toBe(true);
    expect(dp2.placements.some((p) => p.courseId === dp2CourseId && p.day === 1 && p.period === 1)).toBe(true);

    // dp2's cross-cohort occupancy follows the moved dp1 placement (AP now at 3:4, no longer 1:1).
    expect(occupiedAt(dp2.crossCohortOccupancy, apId, 3, 4)).toBe(true);
    expect(occupiedAt(dp2.crossCohortOccupancy, apId, 1, 1)).toBe(false);
  });
});
