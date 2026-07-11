import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { createPlan as createFactoryPlan, placeCourse, seedPlanCatalog, teardown } from "@/test/factories";
import { applyGeneratedPlacements, type ApplyGeneratedPlacementsInput } from "./placements";

// Drives the real applyGeneratedPlacements domain function (the apply_generated_placements
// region-replace RPC) against the local Supabase with the service_role client. Skips when the
// env/stack is unavailable.
//
// Coverage (plan.md Phase 3 #6): multi-cell insert across both cohorts in one call; multi-course
// cells share one bundle row; pre-existing rows included in the region keep week/is_optional
// (and their ids — the convergent replace); emptied bundles are dropped on the undo-shaped call;
// all-or-nothing on an invalid row; idempotent replay.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

type Cell = { cohort: "dp1" | "dp2"; day: number; period: number };
type Row = ApplyGeneratedPlacementsInput["placements"][number];

(hasEnv ? describe : describe.skip)("apply_generated_placements (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;
  let planId: string;
  let dp1Courses: string[];
  let dp2Courses: string[];

  const gen = (cohort: "dp1" | "dp2", courseId: string, day: number, period: number, over: Partial<Row> = {}): Row => ({
    cohort,
    courseId,
    day,
    period,
    week: "both",
    isOptional: false,
    ...over,
  });

  const rowsAt = async (cell: Cell) =>
    (
      await supabase
        .from("placements")
        .select("id, course_id, week, is_optional, bundle_id")
        .eq("plan_id", planId)
        .eq("cohort", cell.cohort)
        .eq("day", cell.day)
        .eq("period", cell.period)
        .order("course_id")
    ).data ?? [];

  const bundlesAt = async (cell: Cell) =>
    (
      await supabase
        .from("bundles")
        .select("id")
        .eq("plan_id", planId)
        .eq("cohort", cell.cohort)
        .eq("day", cell.day)
        .eq("period", cell.period)
    ).data ?? [];

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
    planId = await createFactoryPlan(supabase, { name: "Apply Generated Base" });
    const catalog = await seedPlanCatalog(supabase, planId);
    dp1Courses = catalog.courses.filter((c) => c.cohort === "dp1").map((c) => c.id);
    dp2Courses = catalog.courses.filter((c) => c.cohort === "dp2").map((c) => c.id);
  });

  afterAll(async () => {
    await teardown(supabase);
  });

  it("inserts across multiple cells and both cohorts in one call, sharing one bundle per cell", async () => {
    const cells: Cell[] = [
      { cohort: "dp1", day: 1, period: 1 },
      { cohort: "dp1", day: 1, period: 2 },
      { cohort: "dp2", day: 1, period: 1 },
    ];
    const result = await applyGeneratedPlacements(supabase, {
      planId,
      cells,
      placements: [
        gen("dp1", dp1Courses[0], 1, 1),
        gen("dp1", dp1Courses[1], 1, 1),
        gen("dp1", dp1Courses[2], 1, 2),
        gen("dp2", dp2Courses[0], 1, 1),
      ],
    });

    expect(result.dp1).toHaveLength(3);
    expect(result.dp2).toHaveLength(1);
    const sharedCell = await rowsAt(cells[0]);
    expect(sharedCell).toHaveLength(2);
    expect(new Set(sharedCell.map((row) => row.bundle_id)).size).toBe(1);
    expect(await bundlesAt(cells[0])).toHaveLength(1);
  });

  it("keeps pre-existing rows in the region — same id, week, and optional flag", async () => {
    const cell: Cell = { cohort: "dp1", day: 2, period: 1 };
    // The pin: placed via the production write path, with a distinctive week + flag.
    const pin = await placeCourse(supabase, {
      planId,
      cohort: "dp1",
      courseId: dp1Courses[3],
      day: 2,
      period: 1,
      week: "a",
      isOptional: true,
    });

    await applyGeneratedPlacements(supabase, {
      planId,
      cells: [cell],
      placements: [
        gen("dp1", dp1Courses[3], 2, 1, { week: "a", isOptional: true }), // the pin, carried through
        gen("dp1", dp1Courses[4], 2, 1), // the generated newcomer
      ],
    });

    const rows = await rowsAt(cell);
    expect(rows).toHaveLength(2);
    const kept = rows.find((row) => row.course_id === dp1Courses[3]);
    expect(kept).toMatchObject({ id: pin.id, week: "a", is_optional: true });
  });

  it("drops emptied bundles on the undo-shaped call (empty target for the region)", async () => {
    const cell: Cell = { cohort: "dp2", day: 3, period: 1 };
    await applyGeneratedPlacements(supabase, {
      planId,
      cells: [cell],
      placements: [gen("dp2", dp2Courses[1], 3, 1), gen("dp2", dp2Courses[2], 3, 1)],
    });
    expect(await bundlesAt(cell)).toHaveLength(1);

    const result = await applyGeneratedPlacements(supabase, { planId, cells: [cell], placements: [] });

    expect(result.dp2).toHaveLength(0);
    expect(await rowsAt(cell)).toHaveLength(0);
    expect(await bundlesAt(cell)).toHaveLength(0);
  });

  it("is all-or-nothing: one invalid row aborts the whole call", async () => {
    const cell: Cell = { cohort: "dp1", day: 4, period: 1 };
    await expect(
      applyGeneratedPlacements(supabase, {
        planId,
        cells: [cell],
        placements: [
          gen("dp1", dp1Courses[5], 4, 1),
          gen("dp1", dp1Courses[6], 4, 2), // cell not listed in p_cells → the RPC raises
        ],
      }),
    ).rejects.toThrow(/not covered by p_cells/);

    expect(await rowsAt(cell)).toHaveLength(0); // the valid row never landed
    expect(await bundlesAt(cell)).toHaveLength(0);
  });

  it("replays idempotently — same payload, same rows, same ids", async () => {
    const cell: Cell = { cohort: "dp1", day: 5, period: 1 };
    const payload: ApplyGeneratedPlacementsInput = {
      planId,
      cells: [cell],
      placements: [gen("dp1", dp1Courses[7], 5, 1), gen("dp1", dp1Courses[8], 5, 1)],
    };

    const first = await applyGeneratedPlacements(supabase, payload);
    const replay = await applyGeneratedPlacements(supabase, payload);

    const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();
    expect(ids(replay.dp1)).toEqual(ids(first.dp1));
    expect(await rowsAt(cell)).toHaveLength(2);
  });
});
