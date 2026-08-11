/* eslint-disable no-console -- the written-file log IS this runner's product (bench precedent). */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalizeResult,
  canonicalizeSnapshot,
  canonicalizeSolveRequest,
  type GenerationResult,
  type GeneratorSnapshot,
} from "@/entities/timetable";
import { readJson } from "./read-json";

/**
 * `pnpm experiment:goldens` — regenerates the three committed contract fixtures in
 * `contracts/fixtures/` through the TS canonicalizer, which is the tool that DEFINES canonical
 * bytes (`wire.ts`).
 *
 *   [DUMP=services/solver/tests/fixtures/seed-plan-a.json] RESULT=<cpsat-result.json> pnpm experiment:goldens
 *
 * Inputs, and why they are what they are:
 *   • the snapshot golden is the `snapshot` key of the committed seed dump, projected to the wire pin
 *     and canonicalized — real-size and UUID-only by construction, the same posture `.gitignore:84-94`
 *     pins for the dump itself.
 *   • the result golden is ONE CP-SAT CLI run over that same dump, canonicalized. The canonicalizer
 *     drops the solver's `"lowerBound": null` keys by specification, which is exactly the omit-when-
 *     absent convention the frozen contract requires. It is a RECORDED artifact, not a reproducible
 *     one: CP-SAT is non-deterministic across worker counts and its `elapsedMs` is wall-clock, so a
 *     regeneration produces a different (equally legal) board. Regenerate only for a `formatVersion`
 *     bump — see `contracts/README.md` §Regeneration for the exact command line.
 *   • the solve-request golden is DERIVED from the other two — that same snapshot as `snapshot`, and
 *     the result's board as `warmStart` (so the optional key is exercised rather than merely
 *     declared). No second CP-SAT run: given the same RESULT it reproduces byte-identically, which
 *     is a criterion of its own in the plan.
 *
 * The `*.experiment.ts` suffix keeps this file out of the `pnpm test` glob and gives it the bench
 * experiment runner (vitest + env-var args + `it.runIf`), matching `export-snapshot.experiment.ts`.
 * No file is written without `RESULT`, so a bare run cannot half-regenerate the set.
 */
const DUMP = process.env.DUMP ?? "services/solver/tests/fixtures/seed-plan-a.json";
const RESULT = process.env.RESULT;

const FIXTURES = join(process.cwd(), "contracts", "fixtures");

/** The slice of the export dump this reads: the snapshot, and nothing else (greedy/objective are bench). */
type DumpSnapshot = { snapshot: GeneratorSnapshot };

const USAGE =
  "Skipping the contract-golden regeneration. Usage: RESULT=<cpsat-result.json> " +
  "[DUMP=services/solver/tests/fixtures/seed-plan-a.json] pnpm experiment:goldens — see contracts/README.md " +
  "for the CP-SAT command line that produces RESULT.";

describe("contract goldens", () => {
  // The usage line lives inside a test on purpose: a `console.log` at collection time is swallowed by
  // the reporter, so a bare `describe.skip` would exit silently — an unhelpful no-op run.
  it.runIf(!RESULT)("explains how to run when no CP-SAT result is supplied", () => {
    console.log(USAGE);
    expect(RESULT).toBeUndefined();
  });

  it.runIf(RESULT)("rewrites every fixture in canonical bytes", () => {
    if (!RESULT) throw new Error(USAGE);
    const { snapshot } = readJson<DumpSnapshot>(DUMP);
    const result = readJson<GenerationResult>(RESULT);

    mkdirSync(FIXTURES, { recursive: true });
    const written = [
      write("generator-snapshot.json", canonicalizeSnapshot(snapshot)),
      write("generation-result.json", canonicalizeResult(result)),
      write(
        "solve-request.json",
        canonicalizeSolveRequest({ formatVersion: 1, snapshot, warmStart: result.placements }),
      ),
    ];

    console.log(`\nregenerated from ${DUMP} + ${RESULT}:`);
    for (const line of written) console.log(`  • ${line}`);
    console.log("Both suites' contract tests must go green in the same commit — the goldens are bilateral.");

    expect(written).toHaveLength(3);
  });
});

/** Canonical bytes exactly as the serializer produced them — no trailing newline, no re-indentation
 *  (`contracts/` is in `.prettierignore` for precisely this reason). */
const write = (name: string, canonical: string): string => {
  const path = join(FIXTURES, name);
  writeFileSync(path, canonical);
  return `${name} (${canonical.length} bytes)`;
};
