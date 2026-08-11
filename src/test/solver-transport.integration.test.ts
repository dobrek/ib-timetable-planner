import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import {
  assembleGeneratorSnapshot,
  canonicalizeSolveRequest,
  computeSnapshotHash,
  course,
  createSolverTransport,
  SolverDispatchError,
  type GenerationResult,
  type SolveRequest,
  type SolverTransport,
} from "@/entities/timetable";
import { createPlan, teardown } from "@/test/factories";

/**
 * F-302's proof-of-life: a queued job row driven all the way to `succeeded` through the REAL solver
 * service, over the real credential path (password grant -> Custom Access Token Hook ->
 * `solver_job_writer`), with real RLS and real column grants.
 *
 * It exists because everything else in this change is hermetic. `test_service.py` asserts the
 * wrapper's PostgREST conversation against a mocked transport, which cannot tell whether the writes
 * are actually PERMITTED — an over-wide expectation and a correct one look identical to a mock. The
 * grant/RLS posture is pinned by `solver-credential.integration.test.ts`; this suite is what proves
 * the two halves meet.
 *
 * It also drives dispatch through `createSolverTransport` — the exact function S-301 will call —
 * rather than a bespoke fetch, so the seam is exercised rather than merely shipped.
 *
 * **A small builder snapshot, deliberately.** `solve_complete` chains the full ten-tier ladder after
 * the completeness solve, and the engine's default stage budget is 120 s per tier: the committed
 * golden takes ~12 minutes end to end (measured). A two-course instance proves the same chain in
 * about a second. Timing budgets are S-308's, and none of this is one.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SOLVER_URL = process.env.SOLVER_URL;

// Same fail-loudly-in-CI posture as the solver-credential guard: in CI the workflow starts the
// service and exports its URL, so a missing value means the wiring broke — not that this suite is
// inapplicable. A silent skip here would be zero coverage wearing a green tick.
if (process.env.CI === "true" && SUPABASE_URL && !SOLVER_URL) {
  throw new Error(
    "The solver proof-of-life needs SOLVER_URL. The integration job must launch the service and " +
      "export its URL to $GITHUB_ENV before vitest runs.",
  );
}

const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY && SOLVER_URL);

/** Generous: a two-course solve is ~1 s, so this is a hang detector, never a performance bar. */
const SETTLE_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 250;

(hasEnv ? describe : describe.skip)("solver transport (proof of life)", () => {
  let admin: SupabaseClient<Database>;
  let transport: SolverTransport;
  let planId: string;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY || !SOLVER_URL) return;
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
    transport = createSolverTransport(SOLVER_URL);
    planId = await createPlan(admin);
  });

  afterAll(async () => {
    await teardown(admin);
  });

  it("reports the service as healthy", async () => {
    expect(await transport.checkHealth()).toBe(true);
  });

  it(
    "drives a queued job to succeeded with a schema-shaped result",
    async () => {
      const request = solveRequest();
      const jobId = await enqueue(admin, planId, request);

      await transport.dispatchSolveJob(jobId, request);

      const row = await settle(admin, jobId);
      expect(row.error).toBeNull();
      expect(row.status).toBe("succeeded");
      expect(row.started_at).not.toBeNull();
      expect(row.finished_at).not.toBeNull();

      // The board came back through the wire contract, not through a bespoke shape.
      const result = row.result as GenerationResult;
      expect(result.diagnostics.engine).toBe("cp-sat");
      expect(result.placements.length).toBeGreaterThan(0);
      expect(result.diagnostics.cohorts.dp1.unplaced).toEqual([]);

      // Stored canonical: `wire_result` applies the declared sorts at the consumer, so a producer
      // that skipped them would show up here as an out-of-order board.
      const keys = result.placements.map((p) => [p.cohort, p.courseId, p.day, p.period, p.week] as const);
      expect(keys).toEqual([...keys].sort(comparePlacementKeys));
    },
    SETTLE_TIMEOUT_MS + 30_000,
  );

  it("dispatches byte-identical bodies regardless of assembly order", () => {
    // Not a solver property — a TRANSPORT one. Dispatch canonicalizes, so a retry assembled in a
    // different order is the same request rather than a second, differently-serialized one.
    const forward = solveRequest();
    const reversed: SolveRequest = {
      ...forward,
      snapshot: {
        ...forward.snapshot,
        cohorts: {
          ...forward.snapshot.cohorts,
          dp1: { ...forward.snapshot.cohorts.dp1, courses: [...forward.snapshot.cohorts.dp1.courses].reverse() },
        },
      },
    };

    expect(canonicalizeSolveRequest(reversed)).toBe(canonicalizeSolveRequest(forward));
  });

  it("surfaces a service-side rejection as a typed error rather than a silent no-op", async () => {
    // STRUCTURALLY valid — it canonicalizes cleanly and is actually sent — but schema-invalid at
    // the far end (`days` must be an integer). That is the realistic failure: a peer whose contract
    // has drifted from ours, which no amount of local typing can catch. A body broken badly enough
    // to break the canonicalizer would fail here in the client and never test the boundary at all.
    const skewed = solveRequest();
    const request = { ...skewed, snapshot: { ...skewed.snapshot, days: "five" as unknown as number } };

    const dispatch = transport.dispatchSolveJob(crypto.randomUUID(), request);

    await expect(dispatch).rejects.toBeInstanceOf(SolverDispatchError);
    await expect(dispatch).rejects.toThrow(/HTTP 422/);
  });
});

/** A two-cohort instance with disjoint teachers — completable, and solved in about a second. */
const solveRequest = (): SolveRequest => ({
  formatVersion: 1,
  snapshot: assembleGeneratorSnapshot(
    { days: 5, periods: 10, availability: [], finishesEarlyByCourseId: [] },
    {
      dp1: {
        courses: [course("dp1-a", "t1", ["s1"]), course("dp1-b", "t2", ["s1"])],
        placements: [],
        parkedCourseIds: [],
      },
      dp2: { courses: [course("dp2-a", "t3", ["s2"])], placements: [], parkedCourseIds: [] },
    },
  ),
});

/** Enqueue as ADMIN — the solver holds no INSERT, by design: the Worker enqueues, the solver
 *  advances. Mirrors what S-301's Action will do. */
const enqueue = async (supabase: SupabaseClient<Database>, planId: string, request: SolveRequest): Promise<string> => {
  const { data, error } = await supabase
    .from("generation_jobs")
    .insert({
      plan_id: planId,
      policy: { mode: "complete" },
      snapshot: request.snapshot,
      snapshot_hash: await computeSnapshotHash(request.snapshot),
    })
    .select("id")
    .single();
  if (error) throw new Error(`enqueue: ${error.message}`);
  return data.id;
};

type JobRow = Pick<
  Database["public"]["Tables"]["generation_jobs"]["Row"],
  "status" | "started_at" | "finished_at" | "error" | "result"
>;

/** Poll to a terminal status with a NARROW projection — a bare select would drag the TOASTed
 *  snapshot on every tick (the rule the `generation_jobs` migration header states). */
const settle = async (supabase: SupabaseClient<Database>, jobId: string): Promise<JobRow> => {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  const seen: string[] = [];

  for (;;) {
    const { data, error } = await supabase
      .from("generation_jobs")
      .select("status, started_at, finished_at, error, result")
      .eq("id", jobId)
      .single();
    if (error) throw new Error(`poll: ${error.message}`);
    if (seen.at(-1) !== data.status) seen.push(data.status);

    if (["succeeded", "failed", "stopped", "interrupted"].includes(data.status)) return data;
    if (Date.now() > deadline) {
      // Name the states actually observed. A row stuck at `queued` means the worker never claimed
      // it — the service's one silent-failure surface (sign-in), and a timeout alone would not say so.
      throw new Error(`job ${jobId} never settled; observed: ${seen.join(" -> ")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
};

const comparePlacementKeys = (
  a: readonly [string, string, number, number, string],
  b: readonly [string, string, number, number, string],
): number => compare(a[0], b[0]) || compare(a[1], b[1]) || a[2] - b[2] || a[3] - b[3] || compare(a[4], b[4]);

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
