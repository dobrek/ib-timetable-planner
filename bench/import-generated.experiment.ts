/* eslint-disable no-console -- the printed comparison IS this runner's product (bench precedent). */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { COHORT_VALUES } from "@/shared/config";
import { verifyGeneration, type GenerationResult, type GeneratorSnapshot } from "@/entities/timetable";
import { loadPlanAnalysis, type LoadedPlan } from "@/_pages/plan-comparison/api";
import { createLocalSupabase } from "./local-supabase";
import { loadPins, persistRegion, pinRows, verdictReasons } from "./experiment-harness";
import { buildReport, printPlanReports } from "./plan-report";

/**
 * `pnpm experiment:import` — the CP-SAT POC's import seam, the mirror of `experiment:export`. Reads a
 * CP-SAT result JSON and its dump, then:
 *
 *   gate the result's placements through `verifyGeneration` **against `dump.snapshot`** — the exact
 *   instance Python solved, never re-assembled → drift-check the live clone still carries that catalog
 *   → persist via the region-replace (pins as survivors, the clone's board they already are) → print
 *   the source-vs-clone reports.
 *
 *   IN=<result.json> DUMP=<dump.json> pnpm experiment:import
 *
 * Verify runs on `dump.snapshot`, not a re-assembly of the clone: the whole point is to judge the
 * Python board against the *same* instance Python saw, so a snapshot re-derivation here could only
 * introduce drift the export already ruled out. Fail loudly if the verdict rejects — the board that
 * failed stays on the clone for inspection at `/plans/<clonePlanId>`.
 *
 * Requires the export's clone to still exist (no `db reset` between export and import). Plans are
 * addressed by id, never by name. Dev tooling — the Workers-runtime constraints do not apply here.
 */
const IN = process.env.IN;
const DUMP = process.env.DUMP;

/** The slice of the export dump the import reads back — snapshot to verify against, ids to resolve. */
type CpSatDump = {
  meta: { sourcePlanId: string; clonePlanId: string };
  snapshot: GeneratorSnapshot;
};

const USAGE =
  "Skipping the CP-SAT import. Usage: IN=<result.json> DUMP=<dump.json> pnpm experiment:import " +
  "(needs the local Supabase stack up, SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.test.local, " +
  "and the export's clone still present — no db reset since the export).";

const ready = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && IN && DUMP);

describe("cp-sat import", () => {
  // The usage line lives inside a test on purpose: a `console.log` at collection time is swallowed by
  // the reporter, so a bare `describe.skip` would exit silently — an unhelpful no-op run.
  it.runIf(!ready)("explains how to run when no result/dump is supplied", () => {
    console.log(USAGE);
    expect(ready).toBe(false);
  });

  it.runIf(ready)("verifies the CP-SAT board against the solved snapshot, persists it, and compares", async () => {
    if (!IN || !DUMP) throw new Error(USAGE);
    const result = JSON.parse(readFileSync(IN, "utf8")) as GenerationResult;
    const { snapshot, meta } = JSON.parse(readFileSync(DUMP, "utf8")) as CpSatDump;
    console.log(`\n=== CP-SAT import — clone ${meta.clonePlanId} (source ${meta.sourcePlanId}) ===`);
    printSolve(result);

    // 1. Gate on the oracle against the EXACT snapshot Python solved — no re-assembly.
    const verdict = verifyGeneration(snapshot, result.placements);
    if (!verdict.ok) {
      throw new Error(
        `The CP-SAT board FAILED verification — refusing to persist an un-shippable board.\n` +
          `Clone ${meta.clonePlanId} left in place for inspection at /plans/${meta.clonePlanId}.\n` +
          verdictReasons({ verdict }),
      );
    }
    console.log(`verify: OK · soft warns ${verdict.softWarnCount}`);

    const supabase = createLocalSupabase();

    // 2. Drift guard: the live clone must still be the instance we solved (a wrong dump/clone pairing
    //    would otherwise persist a board onto a catalog it was never validated against).
    const preClone = await loadPlanAnalysis(supabase, meta.clonePlanId);
    assertCatalogMatches(snapshot, preClone);

    // 3. Persist the CP-SAT rows over their own cells; the clone's pins survive (region-replace).
    const pins = await loadPins(supabase, meta.clonePlanId);
    await persistRegion(supabase, meta.clonePlanId, result.placements, pinRows(pins));

    // 4. Compare the persisted CP-SAT board against the source plan, side by side.
    const source = await loadPlanAnalysis(supabase, meta.sourcePlanId);
    const generated = await loadPlanAnalysis(supabase, meta.clonePlanId);
    printPlanReports([buildReport(source), buildReport(generated)]);
    console.log(`\nBoard viewable at /plans/${meta.clonePlanId}`);

    expect(verdict.ok).toBe(true);
  });
});

const printSolve = (result: GenerationResult): void => {
  const diagnostics = result.diagnostics;
  const unplaced = COHORT_VALUES.map(
    (cohort) => `${cohort} ${diagnostics.cohorts[cohort].unplaced.reduce((sum, deficit) => sum + deficit.missing, 0)}h`,
  ).join(" · ");
  const slots = COHORT_VALUES.map((cohort) => `${cohort} ${diagnostics.cohorts[cohort].occupiedSlotsAfter}`).join(
    " · ",
  );
  console.log(
    `solve: ${diagnostics.engine} · ${diagnostics.elapsedMs} ms · provenOptimal=${diagnostics.provenOptimal ?? false} · ` +
      `${result.placements.length} rows · unplaced ${unplaced} · slots ${slots}`,
  );
};

/** The live clone must carry exactly the catalog the dump was solved against — same course ids per
 *  cohort. Cheap set equality; a mismatch means the clone was reset/re-cloned since the export. */
const assertCatalogMatches = (snapshot: GeneratorSnapshot, clone: LoadedPlan): void => {
  for (const cohort of COHORT_VALUES) {
    const solved = new Set(snapshot.cohorts[cohort].courses.map((course) => course.id));
    const live = new Set(clone.input.courses[cohort].map((course) => course.id));
    if (solved.size !== live.size || [...solved].some((id) => !live.has(id))) {
      throw new Error(
        `drift: clone ${cohort} catalog differs from the solved snapshot — wrong dump/clone pairing, ` +
          `or the clone was reset since the export.`,
      );
    }
  }
};
