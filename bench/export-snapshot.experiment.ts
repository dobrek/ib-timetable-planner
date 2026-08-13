/* eslint-disable no-console -- the export log (auto-park audit + objective tuple) IS this runner's product (bench precedent). */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { COHORT_VALUES } from "@/shared/config";
import {
  autoParkPhantomCourses,
  generatePlanGreedy,
  runVerifiedGeneration,
  scoreCandidate,
  type AutoParkedEntry,
  type GeneratedPlacement,
  type GenerationResult,
  type GeneratorSnapshot,
} from "@/entities/timetable";
import { loadPlanAnalysis } from "@/_pages/plan-comparison/api";
import { createLocalSupabase } from "./local-supabase";
import { copyFixtureSkeleton } from "./fixture-courses";
import {
  clonePlanCatalogOnly,
  identitiesOf,
  loadPins,
  persistRegion,
  toSnapshot,
  verdictReasons,
} from "./experiment-harness";

/**
 * `pnpm experiment:export` — the CP-SAT POC's export seam. Mirrors the generation experiment's flow
 * up to (not including) persist, then writes a JSON dump instead:
 *
 *   clone catalog-only → optional PIN_SKELETON fixture copy → assemble the snapshot → auto-park
 *   zero-student courses' uncovered hours (assert + log loudly) → greedy-generate on the transformed
 *   snapshot → verify → compute the TS 10-tier objective tuple for the merged greedy board → dump.
 *
 *   SOURCE_PLAN_ID=<plan-id> [PIN_SKELETON=1] [BUDGET_MS=20000] [OUT=path] pnpm experiment:export
 *
 * The dump (schema below) is the Python package's INPUT CONTRACT — the Python side never re-derives
 * the snapshot or re-scores the greedy board; it reads them here. UUIDs only: names, levels, and
 * flags are not in the snapshot type and never enter the dump. The seed-catalog dump is committed as
 * the pytest fixture (`OUT=services/solver/tests/fixtures/seed-plan-a.json`); the golden dump stays
 * gitignored under `services/solver/data/`.
 *
 * Plans are addressed by id, never by name. Dev tooling — the Workers-runtime constraints do not apply.
 */
const SOURCE_PLAN_ID = process.env.SOURCE_PLAN_ID;
const PIN_SKELETON = process.env.PIN_SKELETON === "1";
const BUDGET_MS = Number(process.env.BUDGET_MS ?? 20_000);
const OUT = process.env.OUT ?? (SOURCE_PLAN_ID ? `services/solver/data/${SOURCE_PLAN_ID}-dump.json` : undefined);

/** The export dump — the Python package's input contract. See the Python `schema.py` mirror. */
export type ExportDump = {
  formatVersion: 1;
  meta: {
    sourcePlanId: string;
    clonePlanId: string;
    exportedAt: string;
    pinSkeleton: boolean;
    autoParked: AutoParkedEntry[];
  };
  snapshot: GeneratorSnapshot;
  greedy: { placements: GeneratedPlacement[]; diagnostics: GenerationResult["diagnostics"] };
  objective: number[];
};

const USAGE =
  "Skipping the snapshot export. Usage: SOURCE_PLAN_ID=<plan-id> [PIN_SKELETON=1] [OUT=path] " +
  "pnpm experiment:export (needs the local Supabase stack up and SUPABASE_URL / " +
  "SUPABASE_SERVICE_ROLE_KEY in .env.test.local).";

const ready = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && SOURCE_PLAN_ID);

describe("snapshot export", () => {
  // The usage line lives inside a test on purpose: a `console.log` at collection time is swallowed by
  // the reporter, so a bare `describe.skip` would exit silently — an unhelpful no-op run.
  it.runIf(!ready)("explains how to run when no source plan id is supplied", () => {
    console.log(USAGE);
    expect(ready).toBe(false);
  });

  it.runIf(ready)("clones, pins, auto-parks, generates, verifies and dumps the instance", async () => {
    if (!SOURCE_PLAN_ID || !OUT) throw new Error(USAGE);
    const supabase = createLocalSupabase();
    const source = await loadPlanAnalysis(supabase, SOURCE_PLAN_ID);

    const clonePlanId = await clonePlanCatalogOnly(supabase, SOURCE_PLAN_ID, label());
    console.log(`\n=== Export — clone ${clonePlanId} of ${source.name} (${source.id}) ===`);
    console.log(`skeleton: ${PIN_SKELETON ? "PINNED (fixture courses copied from the source board)" : "none"}`);

    if (PIN_SKELETON) {
      const clone = await loadPlanAnalysis(supabase, clonePlanId);
      const skeleton = copyFixtureSkeleton(identitiesOf(source), identitiesOf(clone), source.board);
      await persistRegion(supabase, clonePlanId, skeleton, []);
      console.log(`pinned ${skeleton.length} fixture rows`);
    }

    const pins = await loadPins(supabase, clonePlanId);
    const clone = await loadPlanAnalysis(supabase, clonePlanId);
    const rawSnapshot = toSnapshot(clone, pins);

    const { snapshot, autoParked } = autoParkPhantomCourses(rawSnapshot);
    logAutoParked(autoParked);

    const outcome = await runVerifiedGeneration(generatePlanGreedy, snapshot, { budgetMs: BUDGET_MS });
    if (!outcome.ok) {
      throw new Error(
        `Precondition failed — the pinned board already violates the oracle:\n${verdictReasons(outcome)}`,
      );
    }
    if (!outcome.verdict.ok) {
      throw new Error(
        `The greedy board FAILED verification — refusing to dump an un-shippable warm start.\n` +
          `Clone ${clonePlanId} left in place for inspection at /plans/${clonePlanId}.\n${verdictReasons(outcome)}`,
      );
    }

    const objective = scoreCandidate(snapshot, outcome.result.placements, remainingOf(outcome.result)).objective;
    const dump: ExportDump = {
      formatVersion: 1,
      meta: {
        sourcePlanId: source.id,
        clonePlanId,
        exportedAt: new Date().toISOString(),
        pinSkeleton: PIN_SKELETON,
        autoParked,
      },
      snapshot,
      greedy: { placements: outcome.result.placements, diagnostics: outcome.result.diagnostics },
      objective: [...objective],
    };

    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${JSON.stringify(dump, null, 2)}\n`);
    console.log(`\nobjective (TS 10-tuple): [${objective.join(", ")}]`);
    console.log(`greedy unplaced: ${unplacedSummary(outcome.result)}`);
    console.log(`dump written → ${OUT}  (clone ${clonePlanId} MUST survive until import — no db reset)`);

    expect(outcome.verdict.ok).toBe(true);
  });
});

const label = (): string => process.env.LABEL ?? `Export ${new Date().toISOString().slice(0, 16)}`;

/** The generator's per-course remaining hours, keyed by course id across both cohorts — the input
 *  `scoreCandidate` reads tier 1 (`unplacedTotal`) from directly (never recomputed from placements). */
const remainingOf = (result: GenerationResult): Map<string, number> => {
  const remaining = new Map<string, number>();
  for (const cohort of COHORT_VALUES) {
    for (const deficit of result.diagnostics.cohorts[cohort].unplaced) {
      remaining.set(deficit.courseId, deficit.missing);
    }
  }
  return remaining;
};

const logAutoParked = (autoParked: AutoParkedEntry[]): void => {
  if (autoParked.length === 0) {
    console.log("auto-park: no zero-student courses (nothing parked)");
    return;
  }
  console.log("auto-park: zero-student courses parked (roster asserted empty at export):");
  for (const entry of autoParked) {
    console.log(`  • ${entry.cohort} ${entry.courseId} — ${entry.hoursParked} h parked`);
  }
};

const unplacedSummary = (result: GenerationResult): string =>
  COHORT_VALUES.map(
    (cohort) =>
      `${cohort} ${result.diagnostics.cohorts[cohort].unplaced.reduce((sum, deficit) => sum + deficit.missing, 0)}h`,
  ).join(" · ");
