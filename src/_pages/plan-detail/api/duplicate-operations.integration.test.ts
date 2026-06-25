import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { createPlan as createFactoryPlan, seedPlanCatalog, teardown } from "@/test/factories";

// What a duplicate relies on at the persistence layer, proven directly against local Supabase with
// the service-role client (bypasses RLS for setup + assertions): placing a multi-member set at a
// SECOND cell mints an INDEPENDENT bundle and PRESERVES each member's week across the two cells.
//
// This is the cross-cell assertion the existing same-cell find-or-create test
// (bundle-operations.integration.test.ts) does not make. The duplicate verb fans one place_course
// per member at the computed target with the source weeks carried verbatim; here we drive that fan
// out by hand. Skips when the stack is unavailable.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

(hasEnv ? describe : describe.skip)(
  "duplicate persistence — bundle independence + week faithfulness (local Supabase)",
  () => {
    let supabase: SupabaseClient<Database>;
    let planId: string;
    let courseA: string;
    let courseB: string;
    let courseC: string;

    beforeAll(async () => {
      if (!SUPABASE_URL || !SERVICE_KEY) return;
      supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

      planId = await createFactoryPlan(supabase, { name: "Duplicate Ops Base" });
      const catalog = await seedPlanCatalog(supabase, planId);
      const dp1 = catalog.courses.filter((c) => c.cohort === "dp1");
      if (dp1.length < 3) throw new Error("seed needs at least three dp1 courses");
      [courseA, courseB, courseC] = [dp1[0].id, dp1[1].id, dp1[2].id];
    });

    afterAll(async () => {
      await teardown(supabase);
    });

    /** place_course RPC → the inserted/existing placement row. */
    const place = async (day: number, period: number, courseId: string, week: "both" | "a" | "b") => {
      const { data, error } = await supabase.rpc("place_course", {
        p_plan_id: planId,
        p_cohort: "dp1",
        p_course_id: courseId,
        p_day: day,
        p_period: period,
        p_week: week,
      });
      if (error) throw error;
      return data;
    };

    /** The placement rows at a cell, projected to the fields the cross-cell assertions read. */
    const rowsAt = async (day: number, period: number) => {
      const { data, error } = await supabase
        .from("placements")
        .select("course_id, bundle_id, week")
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

    it("placing the same member-set at a second cell mints an independent bundle and preserves each member's week", async () => {
      // Source bundle at X=(1,1) with a mixed A/B/both layout — the layout a duplicate must mirror.
      await place(1, 1, courseA, "a");
      await place(1, 1, courseB, "b");
      await place(1, 1, courseC, "both");
      const bundleX = await bundleAt(1, 1);
      expect(bundleX).not.toBeNull();

      const xRows = await rowsAt(1, 1);
      expect(xRows).toHaveLength(3);
      // All source members share the one bundle minted at X.
      expect(new Set(xRows.map((r) => r.bundle_id))).toEqual(new Set([bundleX]));
      const weekByCourse = new Map(xRows.map((r) => [r.course_id, r.week]));

      // Duplicate into Y=(1,2): one place_course per member, carrying each member's SOURCE week
      // (exactly what duplicateBundle's weekByMember does).
      for (const row of xRows) await place(1, 2, row.course_id, weekByCourse.get(row.course_id) ?? "both");
      const bundleY = await bundleAt(1, 2);
      const yRows = await rowsAt(1, 2);

      // Independence: Y is a brand-new bundle, distinct from X, and the source is untouched.
      expect(bundleY).not.toBeNull();
      expect(bundleY).not.toBe(bundleX);
      expect(new Set(yRows.map((r) => r.bundle_id))).toEqual(new Set([bundleY]));
      expect(await rowsAt(1, 1)).toHaveLength(3); // source still intact (duplicate, not move)

      // Y holds the same course-ids…
      expect(new Set(yRows.map((r) => r.course_id))).toEqual(new Set([courseA, courseB, courseC]));
      // …and each member at Y carries the same week as its counterpart at X.
      for (const row of yRows) expect(row.week).toBe(weekByCourse.get(row.course_id));
    });
  },
);
