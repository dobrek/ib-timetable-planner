import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { createPlan as createFactoryPlan, placeCourse, seedPlanCatalog, teardown } from "@/test/factories";
import { loadPlannerData } from "./load";
import { insertPlacement } from "./placements";
import type { PlannerPlacement } from "../model/placement";

// Risk #4 (placed work survives reload) + Risk #2 (the move-duplicate hazard) driven through the
// PRODUCTION read boundary — `loadPlannerData`, the exact loader a browser reload re-runs
// (load.ts:64,94-100). Plus the only DB-enforced rule's idempotent handling (double-drop).
// Service-role client (bypasses RLS for setup + assertions); skips when the stack is absent.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

/** Stable order for set-equality on placement rows. */
const byId = (a: PlannerPlacement, b: PlannerPlacement) => a.id.localeCompare(b.id);

/** Load the plan the way a reload does, unwrapping the Result (a load error fails the test loudly). */
async function loadPlacements(supabase: SupabaseClient<Database>, planId: string): Promise<PlannerPlacement[]> {
  const result = await loadPlannerData(supabase, planId, "dp1");
  if (!result.ok) throw new Error(`loadPlannerData failed: ${JSON.stringify(result.error)}`);
  return result.value.props.placements;
}

(hasEnv ? describe : describe.skip)("reload-restore through loadPlannerData (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;
  let agnosticCourseId: string;
  let biweeklyA: string;
  let biweeklyB: string;

  beforeAll(() => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
  });

  afterAll(async () => {
    await teardown(supabase);
  });

  /** A freshly-seeded, placement-free plan so a round-trip can assert exact equality (no stragglers). */
  async function freshPlan(name: string): Promise<string> {
    const planId = await createFactoryPlan(supabase, { name });
    const catalog = await seedPlanCatalog(supabase, planId);
    const dp1 = catalog.courses.filter((c) => c.cohort === "dp1");
    const agnostic = dp1.find((c) => c.week_mode === "agnostic");
    const biweekly = dp1.filter((c) => c.week_mode === "biweekly");
    if (!agnostic || biweekly.length < 2) throw new Error("seed needs an agnostic + two bi-weekly dp1 courses");
    agnosticCourseId = agnostic.id;
    biweeklyA = biweekly[0].id;
    biweeklyB = biweekly[1].id;
    return planId;
  }

  describe("round-trip", () => {
    it("restores exactly the placed rows across weeks both/a/b", async () => {
      const planId = await freshPlan("Reload Restore Round-trip");

      // Place across all three week values — the a/b branch, not just `both`.
      const both = await placeCourse(supabase, {
        planId,
        cohort: "dp1",
        courseId: agnosticCourseId,
        day: 1,
        period: 1,
        week: "both",
      });
      const weekA = await placeCourse(supabase, {
        planId,
        cohort: "dp1",
        courseId: biweeklyA,
        day: 2,
        period: 2,
        week: "a",
      });
      const weekB = await placeCourse(supabase, {
        planId,
        cohort: "dp1",
        courseId: biweeklyB,
        day: 3,
        period: 3,
        week: "b",
      });

      const restored = await loadPlacements(supabase, planId);

      // Exact equality: id/courseId/day/period/week all round-trip, with no extra or missing rows.
      expect([...restored].sort(byId)).toEqual([both, weekA, weekB].sort(byId));
    });
  });

  describe("move-duplicate divergence (hazard documentation, not a fix)", () => {
    it("surfaces the course in BOTH cells when the origin cleanup never ran", async () => {
      const planId = await freshPlan("Reload Restore Move Duplicate");

      // Reproduce the move old-row-cleanup failure at the persistence layer: the destination
      // insert succeeds, but the origin DELETE never lands — exactly the unrecovered state from
      // use-placements.ts:177-182, where a failed origin DELETE only sets an error and does NOT
      // roll back. The live board shows only the destination; the DB holds both.
      // FOLLOW-UP: the "make the move atomic / roll back on origin-DELETE failure" change (see
      // plan.md "Follow-up") will make this state unreachable — this test then reds out by design.
      const origin = await placeCourse(supabase, {
        planId,
        cohort: "dp1",
        courseId: agnosticCourseId,
        day: 4,
        period: 1,
        week: "both",
      });
      const destination = await placeCourse(supabase, {
        planId,
        cohort: "dp1",
        courseId: agnosticCourseId,
        day: 4,
        period: 2,
        week: "both",
      });

      const restored = await loadPlacements(supabase, planId);
      const forCourse = restored.filter((p) => p.courseId === agnosticCourseId);

      // The duplicate the live board never showed: same course persisted at two cells.
      expect(forCourse.map((p) => p.id).sort()).toEqual([origin.id, destination.id].sort());
      expect(new Set(forCourse.map((p) => `${p.day}:${p.period}`))).toEqual(new Set(["4:1", "4:2"]));
    });
  });

  describe("double-drop idempotency", () => {
    it("returns the same row and leaves exactly one on a repeated identical insert", async () => {
      const planId = await freshPlan("Reload Restore Double Drop");

      const args = {
        planId,
        cohort: "dp1" as const,
        courseId: agnosticCourseId,
        day: 5,
        period: 1,
        week: "both" as const,
      };
      const first = await insertPlacement(supabase, args);
      const second = await insertPlacement(supabase, args);

      // placements_unique (plan, cohort, day, period, course) → second insert loads the existing row.
      expect(second.id).toBe(first.id);

      const restored = await loadPlacements(supabase, planId);
      const matching = restored.filter((p) => p.courseId === agnosticCourseId && p.day === 5 && p.period === 1);
      expect(matching).toHaveLength(1);
      expect(matching[0].id).toBe(first.id);
    });
  });
});
