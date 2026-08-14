/* eslint-disable no-console -- the printed comparison IS this runner's product (bench precedent). */
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@/shared/api";
import { loadPlacements, unwrapMany } from "@/shared/api";
import { COHORT_VALUES, type Cohort } from "@/shared/config";
import {
  assembleGeneratorSnapshot,
  generatePlanGreedy,
  runVerifiedGeneration,
  type GenerationDiagnostics,
  type GeneratorSnapshot,
  type PlannerPlacement,
} from "@/entities/timetable";
import { copyFixtureSkeleton, type CourseIdentity, type SkeletonRow } from "./fixture-courses";
import { loadPlanAnalysis, type LoadedPlan } from "@/_pages/plan-comparison/api";
import { createLocalSupabase } from "./local-supabase";
import { buildReport, printPlanReports } from "./plan-report";

/**
 * `pnpm experiment:generation` — the measurement loop of the whole quality-tuning change, as ONE
 * command against the local stack:
 *
 *   clone the source plan catalog-only → (optionally) copy its fixture skeleton by course identity
 *   → assemble the snapshot (the clone's placements ARE the pins) → generate with the shipped,
 *   default-tuned engine → gate on `verifyGeneration` → persist via `apply_generated_placements`
 *   (so the board is viewable in-app) → analyze the result side by side with the source plan.
 *
 *   SOURCE_PLAN_ID=<golden-id> [PIN_SKELETON=1] [LABEL="…"] [BUDGET_MS=20000] pnpm experiment:generation
 *
 * Nobody clicks through the app and nobody hand-pins: a mis-pinned skeleton is the one error this
 * loop makes impossible. Skeleton POSITIONS are always copied from the source board (never
 * hardcoded); the fixture ROSTER is the curated name list in `fixture-courses.ts`.
 *
 * Plans are addressed **by id, never by name** (the loader lesson). Dev tooling — the Workers-runtime
 * constraints do not apply here.
 */
const SOURCE_PLAN_ID = process.env.SOURCE_PLAN_ID;
const PIN_SKELETON = process.env.PIN_SKELETON === "1";
/** The greedy engine's solve budget, as the in-page Generate path used to set it (20 s). That path
 *  is gone — Generate now enqueues a server-side CP-SAT job — so this is the experiment's OWN knob
 *  and nothing in the app pins it. Override with `BUDGET_MS`. */
const BUDGET_MS = Number(process.env.BUDGET_MS ?? 20_000);

const USAGE =
  "Skipping the generation experiment. Usage: SOURCE_PLAN_ID=<plan-id> [PIN_SKELETON=1] [LABEL=…] " +
  "pnpm experiment:generation (needs the local Supabase stack up and SUPABASE_URL / " +
  "SUPABASE_SERVICE_ROLE_KEY in .env.test.local).";

const ready = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && SOURCE_PLAN_ID);

describe("generation experiment", () => {
  // The usage line lives inside a test on purpose: a `console.log` at collection time is swallowed by
  // the reporter, so a bare `describe.skip` would exit silently — an unhelpful no-op run.
  it.runIf(!ready)("explains how to run when no source plan id is supplied", () => {
    console.log(USAGE);
    expect(ready).toBe(false);
  });

  it.runIf(ready)("clones, pins, generates, verifies, persists and compares", async () => {
    if (!SOURCE_PLAN_ID) throw new Error(USAGE);
    const supabase = createLocalSupabase();
    const source = await loadPlanAnalysis(supabase, SOURCE_PLAN_ID);

    const clonePlanId = await clonePlanCatalogOnly(supabase, SOURCE_PLAN_ID, label());
    console.log(`\n=== Experiment — clone ${clonePlanId} of ${source.name} (${source.id}) ===`);
    console.log(`skeleton: ${PIN_SKELETON ? "PINNED (fixture courses copied from the source board)" : "none"}`);

    if (PIN_SKELETON) {
      const clone = await loadPlanAnalysis(supabase, clonePlanId);
      const skeleton = copyFixtureSkeleton(identitiesOf(source), identitiesOf(clone), source.board);
      await persistRegion(supabase, clonePlanId, skeleton, []);
      console.log(`pinned ${skeleton.length} fixture rows`);
    }

    const pins = await loadPins(supabase, clonePlanId);
    const clone = await loadPlanAnalysis(supabase, clonePlanId);
    const snapshot = toSnapshot(clone, pins);

    const startedAt = Date.now();
    const outcome = await runVerifiedGeneration(generatePlanGreedy, snapshot, { budgetMs: BUDGET_MS });
    const elapsedMs = Date.now() - startedAt;
    if (!outcome.ok) {
      throw new Error(`Precondition failed — the pinned board already violates the oracle:\n${reasons(outcome)}`);
    }
    printSolve(outcome.result.diagnostics, elapsedMs, outcome.verdict.softWarnCount);
    if (!outcome.verdict.ok) {
      // The clone (and, under PIN_SKELETON, its skeleton) is already on disk by now — only the
      // GENERATED rows are withheld. Say so precisely and leave the clone for inspection: the board
      // that failed is exactly what you want to look at, and deleting it here would take the pinned
      // skeleton with it. Orphans accumulate in the local DB; drop them by hand when they pile up.
      throw new Error(
        `The engine's board FAILED verification — no generated rows persisted.\n` +
          `Clone ${clonePlanId} left in place (catalog${PIN_SKELETON ? " + pinned skeleton" : ""}) ` +
          `for inspection at /plans/${clonePlanId}.\n${reasons(outcome)}`,
      );
    }

    await persistRegion(supabase, clonePlanId, outcome.result.placements, pinRows(pins));
    const generated = await loadPlanAnalysis(supabase, clonePlanId);

    printPlanReports([buildReport(source), buildReport(generated)]);
    console.log(`\nBoard viewable at /plans/${clonePlanId}`);

    expect(outcome.verdict.ok).toBe(true);
  });
});

const label = (): string => process.env.LABEL ?? `Experiment ${new Date().toISOString().slice(0, 16)}`;

/** Catalog-only clone (`p_include_board = false`): courses, teachers, availability, choices,
 *  overlaps, merges — everything the catalog settings carry — with an empty board. */
const clonePlanCatalogOnly = async (supabase: SupabaseClient, sourcePlanId: string, name: string): Promise<string> => {
  const { data, error } = await supabase.rpc("clone_plan", {
    p_source_plan_id: sourcePlanId,
    p_name: name,
    p_include_board: false,
  });
  if (error) throw new Error(`clone_plan failed for ${sourcePlanId}: ${error.message}`);
  // Typed `string` by the generated client, but a `null` here would sail into `persistRegion` as the
  // target plan id — fail loudly instead, like every other identity the harness resolves.
  if (!data) throw new Error(`clone_plan returned no plan id for ${sourcePlanId}`);
  return data;
};

/** The clone's board as pins — `PlannerPlacement` rows, the shape `assembleGeneratorSnapshot` takes. */
const loadPins = async (supabase: SupabaseClient, planId: string): Promise<Record<Cohort, PlannerPlacement[]>> => {
  const perCohort = await Promise.all(
    COHORT_VALUES.map(async (cohort) => {
      const rows = unwrapMany(
        await loadPlacements(supabase, planId, cohort),
        `Failed to load ${cohort} placements for plan ${planId}`,
      );
      return [
        cohort,
        rows.map(
          (row): PlannerPlacement => ({
            id: row.id,
            courseId: row.course_id,
            day: row.day,
            period: row.period,
            week: row.week,
            isOptional: row.is_optional,
          }),
        ),
      ] as const;
    }),
  );
  return Object.fromEntries(perCohort) as Record<Cohort, PlannerPlacement[]>;
};

/** The exact assembly the app runs at Generate-click, fed from DB rows instead of board state —
 *  so a harness board is indistinguishable from an in-app generation by construction. */
const toSnapshot = (clone: LoadedPlan, pins: Record<Cohort, PlannerPlacement[]>): GeneratorSnapshot =>
  assembleGeneratorSnapshot(
    {
      days: clone.input.days,
      periods: clone.input.periods,
      availability: clone.input.availability,
      finishesEarlyByCourseId: clone.snapshot.finishesEarlyByCourseId,
    },
    {
      dp1: {
        courses: clone.input.courses.dp1,
        placements: pins.dp1,
        parkedCourseIds: clone.input.parkedCourseIds.dp1,
      },
      dp2: {
        courses: clone.input.courses.dp2,
        placements: pins.dp2,
        parkedCourseIds: clone.input.parkedCourseIds.dp2,
      },
    },
  );

/**
 * Region replace over the rows' own cells — the same RPC the app's apply path uses. `existing` are
 * the rows already on the board that must SURVIVE: a generated row can land in a cell a pin already
 * occupies, and a region replace states the cell's COMPLETE final content, so omitting the pin would
 * delete it.
 */
const persistRegion = async (
  supabase: SupabaseClient,
  planId: string,
  rows: SkeletonRow[],
  existing: SkeletonRow[],
): Promise<void> => {
  if (rows.length === 0) return;
  const cellKeys = new Set(rows.map(cellOf));
  const survivors = existing.filter(
    (row) => cellKeys.has(cellOf(row)) && !rows.some((target) => rowKey(target) === rowKey(row)),
  );
  const { error } = await supabase.rpc("apply_generated_placements", {
    p_plan_id: planId,
    p_cells: [...cellKeys].map((key) => {
      const [cohort, day, period] = key.split("|");
      return { cohort, day: Number(day), period: Number(period) };
    }),
    p_placements: [...rows, ...survivors].map((row) => ({
      cohort: row.cohort,
      course_id: row.courseId,
      day: row.day,
      period: row.period,
      week: row.week,
      is_optional: false,
    })),
  });
  if (error) throw new Error(`apply_generated_placements failed for plan ${planId}: ${error.message}`);
};

const printSolve = (diagnostics: GenerationDiagnostics, elapsedMs: number, softWarnCount: number): void => {
  const unplaced = COHORT_VALUES.map(
    (cohort) => `${cohort} ${diagnostics.cohorts[cohort].unplaced.reduce((sum, deficit) => sum + deficit.missing, 0)}h`,
  ).join(" · ");
  console.log(
    `solve: ${diagnostics.engine} · ${elapsedMs} ms · stop=${diagnostics.stopReason ?? "?"} · ` +
      `unplaced ${unplaced} · soft warns ${softWarnCount}`,
  );
};

const identitiesOf = (plan: LoadedPlan): CourseIdentity[] =>
  COHORT_VALUES.flatMap((cohort) =>
    plan.input.courses[cohort].map((course) => ({
      id: course.id,
      cohort,
      name: course.name,
      level: course.level,
      groupIndex: course.groupIndex,
    })),
  );

const pinRows = (pins: Record<Cohort, PlannerPlacement[]>): SkeletonRow[] =>
  COHORT_VALUES.flatMap((cohort) =>
    pins[cohort].map((pin) => ({
      cohort,
      courseId: pin.courseId,
      day: pin.day,
      period: pin.period,
      week: pin.week,
    })),
  );

const reasons = (outcome: { verdict: { reasons: string[] } }): string =>
  outcome.verdict.reasons.map((reason) => `  ✗ ${reason}`).join("\n");

const cellOf = (row: { cohort: Cohort; day: number; period: number }): string =>
  `${row.cohort}|${row.day}|${row.period}`;

const rowKey = (row: SkeletonRow): string => `${cellOf(row)}|${row.courseId}`;
