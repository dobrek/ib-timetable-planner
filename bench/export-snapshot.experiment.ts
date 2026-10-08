/* eslint-disable no-console -- the export log (auto-park audit + objective tuple) IS this runner's product (bench precedent). */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import { COHORT_VALUES } from "@/shared/config";
import {
  autoParkPhantomCourses,
  deriveGenerationDeficits,
  scoreCandidate,
  verifyGeneration,
  type AutoParkedEntry,
  type GeneratedPlacement,
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
 * `pnpm experiment:export` — the CP-SAT file-transport seam. Writes a JSON dump of one plan's
 * generation instance, HINT-FREE, exactly as an app dispatch is:
 *
 *   clone catalog-only → optional PIN_SKELETON fixture copy → assemble the snapshot → auto-park
 *   zero-student courses' uncovered hours (assert + log loudly) → check the pins against the oracle →
 *   compute the TS 10-tier objective tuple for the pins-only board → dump.
 *
 *   SOURCE_PLAN_ID=<plan-id> [PIN_SKELETON=1] [OUT=path] pnpm experiment:export
 *
 * The dump (schema below) is the Python package's INPUT CONTRACT — the Python side never re-derives
 * the snapshot; it reads it here. The `greedy` warm-start block is always EMPTY since S-309 retired
 * the engine that filled it, so a CLI run on a new dump solves what production solves (no hint, no
 * clique cut); `objective` is the pins-only board's tuple, which keeps `parity()` meaningful on it.
 * UUIDs only: names, levels, and flags are not in the snapshot type and never enter the dump.
 *
 * The committed pytest fixture `services/solver/tests/fixtures/seed-plan-a.json` is a greedy-era
 * RECORDED artifact — its warm start, objective tuple and clique bounds came from the retired engine,
 * and the parity gate replays that board. Never regenerate it over the top: write a new dump beside
 * it. Other dumps stay gitignored under `services/solver/data/`.
 *
 * Plans are addressed by id, never by name. Dev tooling — the Workers-runtime constraints do not apply.
 */
const SOURCE_PLAN_ID = process.env.SOURCE_PLAN_ID;
const PIN_SKELETON = process.env.PIN_SKELETON === "1";
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
  /** The warm-start slot `load_dump` still requires — empty on every dump this runner writes. */
  greedy: { placements: GeneratedPlacement[]; diagnostics: Record<string, never> };
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

  it.runIf(ready)("clones, pins, auto-parks, checks the pins and dumps the instance", async () => {
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

    // The same fail-fast precondition Generate runs: the pins-only board already carrying a blocking
    // violation means no solver result could ever pass verify, so the dump would be unsolvable.
    const precondition = verifyGeneration(snapshot, []);
    if (!precondition.ok) {
      throw new Error(
        `Precondition failed — the pinned board already violates the oracle:\n` +
          `Clone ${clonePlanId} left in place for inspection at /plans/${clonePlanId}.\n` +
          verdictReasons({ verdict: precondition }),
      );
    }

    const objective = scoreCandidate(snapshot, [], generationDeficitsOf(snapshot)).objective;
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
      greedy: { placements: [], diagnostics: {} },
      objective: [...objective],
    };

    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, `${JSON.stringify(dump, null, 2)}\n`);
    console.log(`\nobjective (TS 10-tuple, pins-only board): [${objective.join(", ")}]`);
    console.log(`dump written → ${OUT}  (clone ${clonePlanId} MUST survive until import — no db reset)`);

    expect(precondition.ok).toBe(true);
  });
});

const label = (): string => process.env.LABEL ?? `Export ${new Date().toISOString().slice(0, 16)}`;

/** What Generate would ask the solver to place, per course id across both cohorts — the per-cohort
 *  `deriveGenerationDeficits` the app runs. `scoreCandidate` reads tier 1 (`unplacedTotal`) from it
 *  directly (never recomputed from placements). */
const generationDeficitsOf = (snapshot: GeneratorSnapshot): Map<string, number> =>
  new Map(
    COHORT_VALUES.flatMap((cohort) => {
      const { pins, courses, parkedCourseIds } = snapshot.cohorts[cohort];
      return deriveGenerationDeficits(pins, courses, parkedCourseIds);
    }).map(({ courseId, missing }) => [courseId, missing]),
  );

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
