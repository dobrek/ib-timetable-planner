import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv/dist/2020.js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  assembleGeneratorSnapshot,
  canonicalizeResult,
  canonicalizeSnapshot,
  canonicalizeSolveRequest,
  canonicalStringify,
  computeSnapshotHash,
  course,
  placement,
  type GenerationResult,
  type SolveRequest,
  type WireSnapshot,
} from "@/entities/timetable";
import { readJson, readText } from "./read-json";

/**
 * The TS half of the both-suites contract gate (`services/solver/tests/test_contract.py` is the other).
 *
 * It lives in `bench/` rather than `contracts/` because a test at `contracts/**\/*.test.ts` is
 * collected by NO vitest project (`vitest.config.ts` roots are `src/` and `bench/`) — it would be
 * green CI with zero coverage. `bench/**\/*.test.ts` is already inside `pnpm test`, already outside
 * the FSD graph, and already sits beside the format's producer.
 *
 * Three properties, and each one fails for a different reason:
 *   1. schema conformance — a producer drifted from the frozen contract;
 *   2. byte-parity of the canonical form against the raw fixture bytes — either the canonicalizer
 *      changed, or something REFORMATTED the goldens. That second case is why `contracts/` is in
 *      `.prettierignore`: lefthook runs `prettier --write` on staged `.json` with `stage_fixed: true`,
 *      which silently collapses arrays and re-indents. This assertion is the permanent tripwire.
 *   3. TS-type assignability — the goldens are pinned to `WireSnapshot`/`GenerationResult` at the
 *      parse site, so a type change on the TS side that the schema does not describe fails to compile.
 */
const CONTRACTS = join(process.cwd(), "contracts");
const SCHEMA_PATH = join(CONTRACTS, "generation-wire.schema.json");
const SNAPSHOT_GOLDEN = join(CONTRACTS, "fixtures", "generator-snapshot.json");
const RESULT_GOLDEN = join(CONTRACTS, "fixtures", "generation-result.json");
const SOLVE_REQUEST_GOLDEN = join(CONTRACTS, "fixtures", "solve-request.json");
const GOLDENS = [SNAPSHOT_GOLDEN, RESULT_GOLDEN, SOLVE_REQUEST_GOLDEN];

const SCHEMA_ID = "https://ib-timetable-planner.dev/contracts/generation-wire.schema.json";

/**
 * The recorded digest of the snapshot golden. The IDENTICAL literal is asserted in
 * `services/solver/tests/test_contract.py` against `cpsat_engine.wire.snapshot_hash`.
 *
 * This is the one property byte-parity of the canonical form does not already buy: the app writes
 * `generation_jobs.snapshot_hash` from here, the solver binds its dispatched body against it from
 * there, and a text-encoding or hex-formatting difference would split the two digests while leaving
 * every round-trip assertion in both suites green.
 */
const SNAPSHOT_GOLDEN_SHA256 = "8ab77d79e1138f7ed0c054ff51429330998e32df40c4dea42c1d95ac85c8698b";

let validateSnapshot: ValidateFunction;
let validateResult: ValidateFunction;
let validateSolveRequest: ValidateFunction;

beforeAll(() => {
  // `strict: true` is the point: it rejects a schema with unknown keywords or a mistyped `$ref`,
  // so an unusable contract document fails here rather than silently validating nothing.
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addSchema(readJson(SCHEMA_PATH));
  validateSnapshot = getValidator(ajv, "GeneratorSnapshot");
  validateResult = getValidator(ajv, "GenerationResult");
  validateSolveRequest = getValidator(ajv, "SolveRequest");
});

describe("contract goldens", () => {
  it("validates the snapshot golden against $defs/GeneratorSnapshot", () => {
    expect(errorsOf(validateSnapshot, readJson(SNAPSHOT_GOLDEN))).toEqual([]);
  });

  it("validates the result golden against $defs/GenerationResult", () => {
    expect(errorsOf(validateResult, readJson(RESULT_GOLDEN))).toEqual([]);
  });

  it("keeps the snapshot golden byte-identical to its canonical form", () => {
    // Also the anti-reformat tripwire — prettier's collapse/indent changes these bytes.
    expect(canonicalizeSnapshot(readJson<WireSnapshot>(SNAPSHOT_GOLDEN))).toBe(readText(SNAPSHOT_GOLDEN));
  });

  it("keeps the result golden byte-identical to its canonical form", () => {
    expect(canonicalizeResult(readJson<GenerationResult>(RESULT_GOLDEN))).toBe(readText(RESULT_GOLDEN));
  });

  it("validates the solve-request golden against $defs/SolveRequest", () => {
    expect(errorsOf(validateSolveRequest, readJson(SOLVE_REQUEST_GOLDEN))).toEqual([]);
  });

  it("keeps the solve-request golden byte-identical to its canonical form", () => {
    expect(canonicalizeSolveRequest(readJson<SolveRequest>(SOLVE_REQUEST_GOLDEN))).toBe(readText(SOLVE_REQUEST_GOLDEN));
  });

  it("exercises the envelope's one optional key rather than only its required half", () => {
    // A `warmStart`-less fixture would leave omit-vs-present — the rule most likely to drift between
    // the two canonicalizers — completely ungated.
    const request = readJson<SolveRequest>(SOLVE_REQUEST_GOLDEN);
    expect(request.formatVersion).toBe(1);
    expect(request.warmStart?.length).toBeGreaterThan(0);
  });

  it("stores every golden already in the declared array order", () => {
    // `canonicalStringify` sorts keys but never reorders arrays, so this passes only if the committed
    // bytes already carry the declared sorts — proving the ordering rules are baked into the files.
    for (const golden of GOLDENS) expect(canonicalStringify(readJson(golden))).toBe(readText(golden));
  });

  it("digests the snapshot golden to the hash the Python suite records", async () => {
    expect(await computeSnapshotHash(readJson<WireSnapshot>(SNAPSHOT_GOLDEN))).toBe(SNAPSHOT_GOLDEN_SHA256);
  });

  it("contains no null anywhere — optionals are omitted on this wire, never nulled", () => {
    for (const golden of GOLDENS) expect(readText(golden)).not.toContain("null");
  });

  it("carries opaque ids only — no display text survives the wire projection", () => {
    // The dump the snapshot golden derives from is UUID-only by construction; this pins that the
    // projection did not smuggle a name/level/colour in through a widened course shape. The
    // solve-request golden embeds a snapshot, so it inherits the same fixture rule.
    for (const golden of [SNAPSHOT_GOLDEN, SOLVE_REQUEST_GOLDEN])
      expect(readText(golden)).not.toMatch(/"(name|level|color|fullName|groupIndex)"/);
  });
});

describe("the single assembly path", () => {
  it("produces a schema-valid snapshot through assembleGeneratorSnapshot", () => {
    const assembled = assembleGeneratorSnapshot(
      {
        days: 5,
        periods: 10,
        availability: [{ teacherKey: "t1", day: 2, period: 3, severity: "soft" }],
        finishesEarlyByCourseId: ["hist"],
      },
      {
        dp1: {
          courses: [course("math", "t1", ["s1"])],
          placements: [placement("row-1", "math", 1, 2)],
          parkedCourseIds: ["math", "math"],
        },
        dp2: { courses: [course("chem", "t2")], placements: [], parkedCourseIds: [] },
      },
    );

    expect(errorsOf(validateSnapshot, JSON.parse(canonicalizeSnapshot(assembled)))).toEqual([]);
  });
});

const getValidator = (ajv: Ajv2020, def: string): ValidateFunction => {
  const validate = ajv.getSchema(`${SCHEMA_ID}#/$defs/${def}`);
  if (!validate) throw new Error(`The contract schema has no $defs/${def} — its $id or its shape changed.`);
  return validate;
};

/** ajv reports failures on the validator instance; surfacing them as data makes a red test readable. */
const errorsOf = (validate: ValidateFunction, payload: unknown): string[] => {
  if (validate(payload)) return [];
  return (validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message ?? "invalid"}`);
};
