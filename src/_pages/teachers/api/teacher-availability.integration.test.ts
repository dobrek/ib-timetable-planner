import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { clearCell, setCell, setColumn, setRow } from "./teacher-availability";

// Drives the availability domain functions directly against local Supabase with the
// service_role/secret client (bypasses RLS for setup + assertions), mirroring the
// slot-bundles harness. The Astro Action couples to astro:env, so we exercise the same
// domain functions the handler runs rather than the HTTP layer. Skips when unavailable.
//
// Coverage (plan.md Phase 2 #2): set/clear/bulk round-trips, upsert-overwrites-severity,
// unique-constraint idempotency. Unlike slot_bundles, availability needs a real teacher
// (composite FK to teachers (plan_id, id)), so each test seeds a bare plan + one teacher.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RUN_ID = randomUUID().slice(0, 8);
const GRID_PRESET = "5x10";

const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

(hasEnv ? describe : describe.skip)("teacher_availability persistence (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;
  const createdPlanIds: string[] = [];

  beforeAll(() => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
  });

  afterAll(async () => {
    // Deleting the plans rows cascades teachers + their availability.
    if (createdPlanIds.length > 0) await supabase.from("plans").delete().in("id", createdPlanIds);
  });

  // A bare plan with exactly one teacher, owned by this test.
  const seed = async (label: string): Promise<{ planId: string; teacherId: string }> => {
    const { data: plan, error: planError } = await supabase
      .from("plans")
      .insert({ name: `Availability Test — ${label} (${RUN_ID})`, slot_grid_preset: GRID_PRESET })
      .select("id")
      .single();
    if (planError) throw planError;
    createdPlanIds.push(plan.id);

    const { data: teacher, error: teacherError } = await supabase
      .from("teachers")
      .insert({ plan_id: plan.id, code: `T-${label}`, full_name: `Teacher ${label}` })
      .select("id")
      .single();
    if (teacherError) throw teacherError;

    return { planId: plan.id, teacherId: teacher.id };
  };

  const rows = async (planId: string, teacherId: string) => {
    const { data, error } = await supabase
      .from("teacher_availability")
      .select("day, period, severity")
      .eq("plan_id", planId)
      .eq("teacher_id", teacherId)
      .order("day")
      .order("period");
    if (error) throw error;
    return data;
  };

  it("set → overwrite → clear round-trip for one cell", async () => {
    const { planId, teacherId } = await seed("cell");

    await setCell(supabase, { planId, teacherId, day: 2, period: 3, severity: "soft" });
    expect(await rows(planId, teacherId)).toEqual([{ day: 2, period: 3, severity: "soft" }]);

    // Upsert overwrites the severity in place — still exactly one row.
    await setCell(supabase, { planId, teacherId, day: 2, period: 3, severity: "strong" });
    expect(await rows(planId, teacherId)).toEqual([{ day: 2, period: 3, severity: "strong" }]);

    // Idempotent: re-setting the same coordinate+severity does not error or duplicate.
    await setCell(supabase, { planId, teacherId, day: 2, period: 3, severity: "strong" });
    expect(await rows(planId, teacherId)).toEqual([{ day: 2, period: 3, severity: "strong" }]);

    await clearCell(supabase, { planId, teacherId, day: 2, period: 3 });
    expect(await rows(planId, teacherId)).toEqual([]);

    // Clearing an absent cell is a no-op, not an error.
    await clearCell(supabase, { planId, teacherId, day: 2, period: 3 });
    expect(await rows(planId, teacherId)).toEqual([]);
  });

  it("bulk-sets a whole column, then clears it", async () => {
    const { planId, teacherId } = await seed("column");

    await setColumn(supabase, { planId, teacherId, day: 4, periods: 3, severity: "strong" });
    expect(await rows(planId, teacherId)).toEqual([
      { day: 4, period: 1, severity: "strong" },
      { day: 4, period: 2, severity: "strong" },
      { day: 4, period: 3, severity: "strong" },
    ]);

    // Re-running the column upsert with a new severity overwrites every cell, no duplicates.
    await setColumn(supabase, { planId, teacherId, day: 4, periods: 3, severity: "soft" });
    expect(await rows(planId, teacherId)).toEqual([
      { day: 4, period: 1, severity: "soft" },
      { day: 4, period: 2, severity: "soft" },
      { day: 4, period: 3, severity: "soft" },
    ]);

    await setColumn(supabase, { planId, teacherId, day: 4, periods: 3, severity: null });
    expect(await rows(planId, teacherId)).toEqual([]);
  });

  it("bulk-sets a whole row, then clears it", async () => {
    const { planId, teacherId } = await seed("row");

    await setRow(supabase, { planId, teacherId, period: 2, days: 3, severity: "soft" });
    expect(await rows(planId, teacherId)).toEqual([
      { day: 1, period: 2, severity: "soft" },
      { day: 2, period: 2, severity: "soft" },
      { day: 3, period: 2, severity: "soft" },
    ]);

    await setRow(supabase, { planId, teacherId, period: 2, days: 3, severity: null });
    expect(await rows(planId, teacherId)).toEqual([]);
  });
});
