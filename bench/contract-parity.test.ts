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
  SOLVE_POLICY_PRESETS,
  storedStageReportSchema,
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
let validateStageReport: ValidateFunction;

beforeAll(() => {
  // `strict: true` is the point: it rejects a schema with unknown keywords or a mistyped `$ref`,
  // so an unusable contract document fails here rather than silently validating nothing.
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addSchema(readJson(SCHEMA_PATH));
  validateSnapshot = getValidator(ajv, "GeneratorSnapshot");
  validateResult = getValidator(ajv, "GenerationResult");
  validateSolveRequest = getValidator(ajv, "SolveRequest");
  validateStageReport = getValidator(ajv, "StageReport");
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

  it("exercises the envelope's optional keys rather than only its required half", () => {
    // A fixture without `warmStart` / `policy` would leave omit-vs-present — the rule most likely to
    // drift between the two canonicalizers — completely ungated.
    const request = readJson<SolveRequest>(SOLVE_REQUEST_GOLDEN);
    expect(request.formatVersion).toBe(1);
    expect(request.warmStart?.length).toBeGreaterThan(0);
    expect(request.policy).toEqual({ preset: "clean" });
  });

  it("omits `policy` from the canonical form when the request carries none", () => {
    // Absent means "the service default" and must stay absent — a canonicalizer that filled it in
    // would make the app's body disagree with the schema's stated omit-never-null rule.
    const { policy: _policy, ...withoutPolicy } = readJson<SolveRequest>(SOLVE_REQUEST_GOLDEN);
    expect(canonicalizeSolveRequest(withoutPolicy)).not.toContain('"policy"');
  });

  it("rejects a policy preset outside the contract's enum at policy/preset", () => {
    const request = { ...readJson<SolveRequest>(SOLVE_REQUEST_GOLDEN), policy: { preset: "fastest" } };
    expect(errorsOf(validateSolveRequest, request)).toEqual([
      "/policy/preset must be equal to one of the allowed values",
    ]);
  });

  it("declares exactly the presets the TS vocabulary knows", () => {
    // Pinned as data: the TS enum is a projection of the schema, and the Python `PRESETS` table is
    // held against the same list from its side, so the three cannot drift apart silently.
    const schema = readJson<{
      $defs: { SolveRequest: { properties: { policy: { properties: { preset: { enum: string[] } } } } } };
    }>(SCHEMA_PATH);
    expect(schema.$defs.SolveRequest.properties.policy.properties.preset.enum).toEqual([...SOLVE_POLICY_PRESETS]);
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

/**
 * `StageReport` has no golden — it is the one `$defs` entry no fixture contains, because a
 * `wallClockS` float carries no cross-language byte guarantee and so may never enter a canonical
 * payload. Its TS half is therefore gated the only other way available: hold the Zod schema the app
 * parses `generation_jobs.stages` with against the same ajv validator, on cases chosen so the two
 * disagreeing is the failure.
 */
describe("the StageReport projection", () => {
  const stage = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    tier: 4,
    name: "teacherHoles",
    status: "OPTIMAL",
    best: 97,
    bound: 97,
    wallClockS: 1.5,
    ...overrides,
  });

  const ACCEPT_REJECT: { case: string; payload: Record<string, unknown>; valid: boolean }[] = [
    { case: "a complete report", payload: stage(), valid: true },
    { case: "the S-303 stoppedBy", payload: stage({ status: "FEASIBLE", stoppedBy: "target" }), valid: true },
    {
      case: "every optional omitted",
      payload: { tier: 2, name: "holes", status: "UNKNOWN", wallClockS: 10 },
      valid: true,
    },
    { case: "a missing wallClockS", payload: stage({ wallClockS: undefined }), valid: false },
    { case: "an unknown key", payload: stage({ elapsedMs: 1500 }), valid: false },
    { case: "a stoppedBy outside the enum", payload: stage({ stoppedBy: "stagnation" }), valid: false },
    { case: "a nulled optional", payload: stage({ best: null }), valid: false },
    { case: "a tier below 1", payload: stage({ tier: 0 }), valid: false },
  ];

  it.each(ACCEPT_REJECT)("agrees with the schema on $case", ({ payload, valid }) => {
    // `undefined` is not a JSON value: round-tripping drops those keys, which is what an omitted
    // optional actually looks like on the wire and what ajv must be shown.
    const wire: unknown = JSON.parse(JSON.stringify(payload));
    expect(errorsOf(validateStageReport, wire).length === 0).toBe(valid);
    expect(storedStageReportSchema.safeParse(wire).success).toBe(valid);
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
