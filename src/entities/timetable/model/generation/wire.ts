import type { Cohort } from "@/shared/config";
import type {
  GeneratedPlacement,
  GenerationCohortDiagnostics,
  GenerationDiagnostics,
  GenerationResult,
  GeneratorCohortSnapshot,
  GeneratorSnapshot,
} from "./types";
import type { PlannerPlacement } from "../placement";

/**
 * The TS half of the frozen wire contract (`contracts/generation-wire.schema.json`) — the ONE
 * implementation of the canonical JSON form declared normatively in `contracts/README.md`, and the
 * `snapshot_hash` digest built on it. `services/solver/src/cpsat_engine/wire.py` is the Python mirror;
 * the two are byte-gated against the committed goldens in `bench/contract-parity.test.ts` and
 * `services/solver/tests/test_contract.py`.
 *
 * Lives in the entity rather than `shared/lib` because it consumes `GeneratorSnapshot` — the FSD
 * import direction forbids the upward reach.
 *
 * Two consumers, one ordering decision: golden fixtures are byte-compared against this output, and
 * `generation_jobs.snapshot_hash` digests it. Ordering therefore cannot be "whatever the producer
 * emitted" — every semantically-unordered array is sorted by a declared key here, so a snapshot
 * assembled in a different order hashes identically.
 *
 * NOT a validator and NOT a hot-path guard: schema validation is test-lane only (ajv / jsonschema),
 * so nothing here runs anywhere near the <200 ms drag-drop budget.
 */

/**
 * The wire projection of a pin: exactly the four fields the engine reads. `id`, `isOptional` and
 * `bundleId` are caller-local markers — the narrowing happens HERE, at the wire boundary, so the
 * in-app `GeneratorSnapshot` (still consumed by the greedy engine until S-309) stays untouched.
 */
export type WirePin = Pick<PlannerPlacement, "courseId" | "day" | "period" | "week">;

export type WireCohortSnapshot = Omit<GeneratorCohortSnapshot, "pins"> & { pins: WirePin[] };

/**
 * `GeneratorSnapshot` with pins narrowed to their wire shape. A `GeneratorSnapshot` is assignable to
 * it (a `PlannerPlacement` structurally satisfies `WirePin`), so every entry point below accepts the
 * in-app type as well as a payload parsed back off the wire.
 */
export type WireSnapshot = Omit<GeneratorSnapshot, "cohorts"> & { cohorts: Record<Cohort, WireCohortSnapshot> };

/**
 * The envelope `POST /jobs/{jobId}/solve` accepts (F-302) — and the ONLY carrier of `formatVersion`
 * on this wire: the snapshot and the result are versioned by the envelope around them, never
 * field-by-field.
 *
 * The schema is `additionalProperties: false`, so a job identity cannot ride in the body — it
 * travels in the URL path. Declared here rather than in `types.ts` because it carries a
 * `WireSnapshot`, which is defined in this module.
 */
export type SolveRequest = {
  formatVersion: 1;
  snapshot: WireSnapshot;
  /** An incumbent board to hint the solver with. Omitted when absent — never `null`. */
  warmStart?: GeneratedPlacement[];
};

/**
 * Canonical JSON: keys sorted lexicographically at every depth, compact separators, and
 * `null`/`undefined`-valued keys omitted. The omit-when-absent convention is encoded HERE rather
 * than merely documented — a producer that emits `lowerBound: null` still canonicalizes to a
 * contract-legal payload, and the schema's `additionalProperties: false` catches everything else.
 *
 * Array order is preserved: this function does not know which arrays are semantically unordered.
 * Use `canonicalizeSnapshot` / `canonicalizeResult` for the declared sorts.
 */
export const canonicalStringify = (value: unknown): string => {
  if (isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (isRecord(value))
    return `{${presentKeys(value)
      .map((key) => member(key, value[key]))
      .join(",")}}`;
  if (value === undefined) return "null";
  return JSON.stringify(value);
};

/** The canonical form of a snapshot: pins projected to the wire shape, declared array sorts applied. */
export const canonicalizeSnapshot = (snapshot: WireSnapshot): string => canonicalStringify(toWireSnapshot(snapshot));

/** The canonical form of a result: declared array sorts applied, optional keys dropped when absent. */
export const canonicalizeResult = (result: GenerationResult): string => canonicalStringify(toWireResult(result));

/**
 * The canonical form of a solve request: the snapshot through its own declared sorts, `warmStart`
 * through the `placements` order, and the key omitted entirely when there is no warm start.
 *
 * This is what the app POSTs, so dispatch gets deterministic bytes for free — two callers that
 * assembled the same solve in a different order send the identical body.
 */
export const canonicalizeSolveRequest = (request: SolveRequest): string =>
  canonicalStringify(toWireSolveRequest(request));

/**
 * `generation_jobs.snapshot_hash` — SHA-256 hex over the canonical snapshot. Drift is a
 * source-plan-at-T0 vs source-plan-at-T1 comparison, so the digest covers the solve's entire input
 * set (grid, availability, finishes-early flags, catalog AND board) by digesting the snapshot itself.
 *
 * Web Crypto, mirroring `computeCatalogHash` — edge-safe on workerd, global in Node.
 */
export const computeSnapshotHash = async (snapshot: WireSnapshot): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalizeSnapshot(snapshot)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

// --- canonical serialization -----------------------------------------------------------------

const isArray = (value: unknown): value is readonly unknown[] => Array.isArray(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const presentKeys = (record: Record<string, unknown>): string[] =>
  Object.keys(record)
    .filter((key) => record[key] !== null && record[key] !== undefined)
    .sort(compareStrings);

const member = (key: string, value: unknown): string => `${JSON.stringify(key)}:${canonicalStringify(value)}`;

// --- wire projections ------------------------------------------------------------------------

const toWireSnapshot = (snapshot: WireSnapshot): WireSnapshot => ({
  days: snapshot.days,
  periods: snapshot.periods,
  availability: [...snapshot.availability]
    .map(({ teacherKey, day, period, severity }) => ({ teacherKey, day, period, severity }))
    .sort(byAvailabilityCell),
  finishesEarlyByCourseId: [...snapshot.finishesEarlyByCourseId].sort(compareStrings),
  cohorts: { dp1: toWireCohort(snapshot.cohorts.dp1), dp2: toWireCohort(snapshot.cohorts.dp2) },
});

const toWireCohort = (cohort: WireCohortSnapshot): WireCohortSnapshot => ({
  courses: [...cohort.courses]
    .map(({ id, teacherKeys, hours, studentKeys, weekMode }) => ({
      id,
      teacherKeys: [...teacherKeys].sort(compareStrings),
      hours,
      studentKeys: [...studentKeys].sort(compareStrings),
      weekMode,
    }))
    .sort((a, b) => compareStrings(a.id, b.id)),
  pins: [...cohort.pins].map(toWirePin).sort(byWirePin),
  // A multiset: duplicate count is semantic (one entry covers one parked hour), so this sorts, never dedupes.
  parkedCourseIds: [...cohort.parkedCourseIds].sort(compareStrings),
});

const toWirePin = ({ courseId, day, period, week }: WirePin): WirePin => ({ courseId, day, period, week });

const toWireSolveRequest = ({ formatVersion, snapshot, warmStart }: SolveRequest): SolveRequest => ({
  formatVersion,
  snapshot: toWireSnapshot(snapshot),
  // Omit-when-absent stated at the projection rather than left to `canonicalStringify` dropping an
  // `undefined`: an EMPTY warm start is a present value and must survive as `[]`.
  ...(warmStart === undefined ? {} : { warmStart: [...warmStart].map(toWirePlacement).sort(byWirePlacement) }),
});

const toWireResult = (result: GenerationResult): GenerationResult => ({
  placements: [...result.placements].map(toWirePlacement).sort(byWirePlacement),
  diagnostics: toWireDiagnostics(result.diagnostics),
});

const toWirePlacement = ({ cohort, courseId, day, period, week }: GeneratedPlacement): GeneratedPlacement => ({
  cohort,
  courseId,
  day,
  period,
  week,
});

const toWireDiagnostics = (diagnostics: GenerationDiagnostics): GenerationDiagnostics => ({
  engine: diagnostics.engine,
  elapsedMs: diagnostics.elapsedMs,
  partial: diagnostics.partial,
  provenOptimal: diagnostics.provenOptimal,
  stopReason: diagnostics.stopReason,
  cohorts: {
    dp1: toWireCohortDiagnostics(diagnostics.cohorts.dp1),
    dp2: toWireCohortDiagnostics(diagnostics.cohorts.dp2),
  },
});

const toWireCohortDiagnostics = ({
  occupiedSlotsBefore,
  occupiedSlotsAfter,
  unplaced,
  lowerBound,
}: GenerationCohortDiagnostics): GenerationCohortDiagnostics => ({
  occupiedSlotsBefore,
  occupiedSlotsAfter,
  unplaced: [...unplaced]
    .map(({ courseId, missing }) => ({ courseId, missing }))
    .sort((a, b) => compareStrings(a.courseId, b.courseId)),
  lowerBound,
});

// --- declared array orders -------------------------------------------------------------------

/** Code-unit order — never `localeCompare`, whose collation is locale-dependent and unportable. */
const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const byAvailabilityCell = (
  a: { teacherKey: string; day: number; period: number },
  b: { teacherKey: string; day: number; period: number },
): number => compareStrings(a.teacherKey, b.teacherKey) || a.day - b.day || a.period - b.period;

const byWirePin = (a: WirePin, b: WirePin): number =>
  compareStrings(a.courseId, b.courseId) || a.day - b.day || a.period - b.period || compareStrings(a.week, b.week);

const byWirePlacement = (a: GeneratedPlacement, b: GeneratedPlacement): number =>
  compareStrings(a.cohort, b.cohort) || byWirePin(a, b);
