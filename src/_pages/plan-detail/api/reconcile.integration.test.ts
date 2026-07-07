import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { createPlan, seedPlanCatalog, teardown } from "@/test/factories";
import { loadCombinedPlannerData } from "./load";
import {
  moveBundleMembers,
  placeCourse,
  removeBundleMembers,
  updatePlacementOptional,
  updatePlacementWeek,
} from "./placements";
import { deleteShelfBundle, shelveBundle, shelveCourses, unshelveBundle } from "./shelf";
import { cellKey, type PlannerPlacement } from "@/entities/timetable";
import { memberSetKey, placementBusinessKey, sliceAt } from "../model/history/affected-slice";
import type { AffectedScope } from "../model/history/history-entry";
import { diffReconcile } from "../model/history/reconcile";
import { executeReconcilePlan, type ReconcileDeps } from "../model/history/reconcile-exec";
import type { ParkedBundle } from "../model/placement/parked";

// Risk-driving the undo executor end-to-end: for every editing op, snapshot S0, apply the forward
// edit via the domain fns, then drive `executeReconcilePlan` (over the SAME domain fns, real
// Supabase) to reconcile back — and assert the `load.ts` projection re-hydrates to S0. Exercises the
// real one-bundle-per-cell index, the `== 0` bundle cleanup + find-or-create re-mint, the
// unique-key-excludes-week semantics, and `placements`↔`shelf_*` two-store consistency. Identity is
// NOT preserved across replay, so equality is by business key (placements) / member-set (cards).
// Service-role client; skips when the stack is absent.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

const COHORT = "dp1" as const;

let supabase: SupabaseClient<Database>;
let AG: string; // an agnostic dp1 course (week `both`)
let B1: string; // a bi-weekly dp1 course
let B2: string; // a second bi-weekly dp1 course

const keysOf = (placements: PlannerPlacement[]): string[] =>
  placements.map((p) => `${p.courseId}|${p.day}|${p.period}|${p.week}|${p.isOptional}`).sort();
const cardsOf = (cards: ParkedBundle[]): string[] => cards.map((c) => memberSetKey(c.members)).sort();

async function loadCohort(planId: string): Promise<{ placements: PlannerPlacement[]; parkedBundles: ParkedBundle[] }> {
  const result = await loadCombinedPlannerData(supabase, planId);
  if (!result.ok) throw new Error(`load failed: ${JSON.stringify(result.error)}`);
  return { placements: result.value.dp1.placements, parkedBundles: result.value.dp1.parkedBundles };
}

function domainDeps(
  planId: string,
  cardIdByMemberSet: Map<string, string>,
  placementIdByKey: Map<string, string>,
): ReconcileDeps {
  return {
    moveMembers: (source, target, courseIds) =>
      moveBundleMembers(supabase, {
        planId,
        cohort: COHORT,
        day: source.day,
        period: source.period,
        courseIds,
        targetDay: target.day,
        targetPeriod: target.period,
      }),
    shelve: (cell) => shelveBundle(supabase, { planId, cohort: COHORT, day: cell.day, period: cell.period }),
    unshelve: (shelfBundleId, target) =>
      unshelveBundle(supabase, {
        planId,
        cohort: COHORT,
        shelfBundleId,
        targetDay: target.day,
        targetPeriod: target.period,
      }),
    place: (spec) =>
      placeCourse(supabase, {
        planId,
        cohort: COHORT,
        courseId: spec.courseId,
        day: spec.day,
        period: spec.period,
        week: spec.week,
        isOptional: spec.isOptional,
      }),
    removeMembers: (cell, courseIds) =>
      removeBundleMembers(supabase, { planId, cohort: COHORT, day: cell.day, period: cell.period, courseIds }),
    setOptional: (placementId, isOptional) => updatePlacementOptional(supabase, { id: placementId, isOptional }),
    createCard: (members) => shelveCourses(supabase, { planId, cohort: COHORT, members }),
    deleteCard: (shelfBundleId) => deleteShelfBundle(supabase, { planId, shelfBundleId }),
    resolveCardId: (members) => cardIdByMemberSet.get(memberSetKey(members)),
    resolvePlacementId: (key) => placementIdByKey.get(placementBusinessKey(key)),
  };
}

/** Snapshot S0, apply the forward edit, reconcile back over the real RPCs, assert load re-hydrates to S0. */
async function roundTrip(planId: string, scope: AffectedScope, forward: () => Promise<unknown>): Promise<void> {
  const s0 = await loadCohort(planId);
  const before = sliceAt(s0.placements, s0.parkedBundles, scope);

  await forward();

  const s1 = await loadCohort(planId);
  const current = sliceAt(s1.placements, s1.parkedBundles, scope);
  const cardIds = new Map(s1.parkedBundles.map((card) => [memberSetKey(card.members), card.id]));
  const placementIds = new Map(s1.placements.map((p) => [placementBusinessKey(p), p.id]));

  await executeReconcilePlan(diffReconcile(current, before), domainDeps(planId, cardIds, placementIds));

  const restored = await loadCohort(planId);
  expect(keysOf(restored.placements)).toEqual(keysOf(s0.placements));
  expect(cardsOf(restored.parkedBundles)).toEqual(cardsOf(s0.parkedBundles));
}

const boardScope = (...cells: [number, number][]): AffectedScope => ({
  cells: cells.map(([day, period]) => cellKey(day, period)),
  cardSets: [],
});

(hasEnv ? describe : describe.skip)("reconcile round-trip — every editing op back to S0 (local Supabase)", () => {
  beforeAll(() => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
  });

  afterAll(async () => {
    await teardown(supabase);
  });

  async function freshPlan(name: string): Promise<string> {
    const planId = await createPlan(supabase, { name });
    const catalog = await seedPlanCatalog(supabase, planId);
    const dp1 = catalog.courses.filter((c) => c.cohort === "dp1");
    const agnostic = dp1.find((c) => c.week_mode === "agnostic");
    const biweekly = dp1.filter((c) => c.week_mode === "biweekly");
    if (!agnostic || biweekly.length < 2) throw new Error("seed needs 1 agnostic + 2 bi-weekly dp1 courses");
    AG = agnostic.id;
    B1 = biweekly[0].id;
    B2 = biweekly[1].id;
    return planId;
  }

  const place = (planId: string, courseId: string, day: number, period: number, week: "both" | "a" | "b" = "both") =>
    placeCourse(supabase, { planId, cohort: COHORT, courseId, day, period, week, isOptional: false });

  it("add", async () => {
    const planId = await freshPlan("recon-add");
    await roundTrip(planId, boardScope([1, 1]), () => place(planId, AG, 1, 1));
  });

  it("group (two courses at one cell)", async () => {
    const planId = await freshPlan("recon-group");
    await roundTrip(planId, boardScope([1, 1]), async () => {
      await place(planId, AG, 1, 1, "both");
      await place(planId, B1, 1, 1, "a");
    });
  });

  it("single-course move", async () => {
    const planId = await freshPlan("recon-move");
    await place(planId, AG, 1, 1);
    await roundTrip(planId, boardScope([1, 1], [2, 2]), () =>
      moveBundleMembers(supabase, {
        planId,
        cohort: COHORT,
        day: 1,
        period: 1,
        courseIds: [AG],
        targetDay: 2,
        targetPeriod: 2,
      }),
    );
  });

  it("whole-bundle move (empty target)", async () => {
    const planId = await freshPlan("recon-bundle-move");
    await place(planId, AG, 1, 1, "both");
    await place(planId, B1, 1, 1, "a");
    await roundTrip(planId, boardScope([1, 1], [3, 3]), () =>
      moveBundleMembers(supabase, {
        planId,
        cohort: COHORT,
        day: 1,
        period: 1,
        courseIds: [AG, B1],
        targetDay: 3,
        targetPeriod: 3,
      }),
    );
  });

  it("merge (move onto a shared-course cell, the lossy branch)", async () => {
    const planId = await freshPlan("recon-merge");
    await place(planId, AG, 1, 1, "both");
    await place(planId, B1, 1, 1, "a");
    await place(planId, AG, 2, 2, "both"); // the twin the move merges onto
    await roundTrip(planId, boardScope([1, 1], [2, 2]), () =>
      moveBundleMembers(supabase, {
        planId,
        cohort: COHORT,
        day: 1,
        period: 1,
        courseIds: [AG, B1],
        targetDay: 2,
        targetPeriod: 2,
      }),
    );
  });

  it("single-course remove", async () => {
    const planId = await freshPlan("recon-remove");
    await place(planId, AG, 1, 1);
    await roundTrip(planId, boardScope([1, 1]), () =>
      removeBundleMembers(supabase, { planId, cohort: COHORT, day: 1, period: 1, courseIds: [AG] }),
    );
  });

  it("whole-bundle remove", async () => {
    const planId = await freshPlan("recon-bundle-remove");
    await place(planId, AG, 1, 1, "both");
    await place(planId, B1, 1, 1, "a");
    await roundTrip(planId, boardScope([1, 1]), () =>
      removeBundleMembers(supabase, { planId, cohort: COHORT, day: 1, period: 1, courseIds: [AG, B1] }),
    );
  });

  it("setWeek (A → B flip)", async () => {
    const planId = await freshPlan("recon-setweek");
    const placed = await place(planId, B1, 1, 1, "a");
    await roundTrip(planId, boardScope([1, 1]), () => updatePlacementWeek(supabase, { id: placed.id, week: "b" }));
  });

  it("setOptional (mark) — undoing the mark restores is_optional = false", async () => {
    const planId = await freshPlan("recon-mark-optional");
    const placed = await place(planId, AG, 1, 1);
    // keysOf includes the flag, so an empty diff (dead history entry) would leave the row marked
    // and fail the S0 equality — this pins both undoability and the non-empty plan.
    await roundTrip(planId, boardScope([1, 1]), () =>
      updatePlacementOptional(supabase, { id: placed.id, isOptional: true }),
    );
    // The flip fast-path updates the row in place — identity survives the undo, proving no
    // delete+insert window where a failure could lose the placement outright.
    const { placements } = await loadCohort(planId);
    expect(placements.find((p) => p.courseId === AG)?.id).toBe(placed.id);
  });

  it("remove of an optional member — undo re-places it AS optional", async () => {
    const planId = await freshPlan("recon-remove-optional");
    await placeCourse(supabase, {
      planId,
      cohort: COHORT,
      courseId: AG,
      day: 1,
      period: 1,
      week: "both",
      isOptional: true,
    });
    await roundTrip(planId, boardScope([1, 1]), () =>
      removeBundleMembers(supabase, { planId, cohort: COHORT, day: 1, period: 1, courseIds: [AG] }),
    );
    // The restored projection must carry the flag (keysOf asserted it); double-check the column.
    const { placements } = await loadCohort(planId);
    expect(placements.find((p) => p.courseId === AG)?.isOptional).toBe(true);
  });

  it("lift (board → shelf)", async () => {
    const planId = await freshPlan("recon-lift");
    await place(planId, AG, 1, 1);
    const scope: AffectedScope = {
      cells: [cellKey(1, 1)],
      cardSets: [[{ courseId: AG, week: "both", isOptional: false }]],
    };
    await roundTrip(planId, scope, () => shelveBundle(supabase, { planId, cohort: COHORT, day: 1, period: 1 }));
  });

  it("place-back (shelf → board)", async () => {
    const planId = await freshPlan("recon-placeback");
    const card = await shelveCourses(supabase, {
      planId,
      cohort: COHORT,
      members: [{ courseId: AG, week: "both", isOptional: false }],
    });
    const scope: AffectedScope = {
      cells: [cellKey(1, 1)],
      cardSets: [[{ courseId: AG, week: "both", isOptional: false }]],
    };
    await roundTrip(planId, scope, () =>
      unshelveBundle(supabase, { planId, cohort: COHORT, shelfBundleId: card.id, targetDay: 1, targetPeriod: 1 }),
    );
  });

  it("park-set (arbitrary set onto the shelf)", async () => {
    const planId = await freshPlan("recon-park");
    const scope: AffectedScope = { cells: [], cardSets: [[{ courseId: B2, week: "a", isOptional: false }]] };
    await roundTrip(planId, scope, () =>
      shelveCourses(supabase, { planId, cohort: COHORT, members: [{ courseId: B2, week: "a", isOptional: false }] }),
    );
  });

  it("discard (delete a parked card)", async () => {
    const planId = await freshPlan("recon-discard");
    const card = await shelveCourses(supabase, {
      planId,
      cohort: COHORT,
      members: [{ courseId: AG, week: "both", isOptional: false }],
    });
    const scope: AffectedScope = { cells: [], cardSets: [[{ courseId: AG, week: "both", isOptional: false }]] };
    await roundTrip(planId, scope, () => deleteShelfBundle(supabase, { planId, shelfBundleId: card.id }));
  });

  it("duplicate (additive copy at a second cell)", async () => {
    const planId = await freshPlan("recon-duplicate");
    await place(planId, AG, 1, 1);
    await roundTrip(planId, boardScope([2, 2]), () => place(planId, AG, 2, 2));
  });
});
