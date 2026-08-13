import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { computeSnapshotHash, SolverDispatchError, type SolverTransport } from "@/entities/timetable";
import { DomainError } from "@/shared/lib/errors";
import { createPlan as createFactoryPlan, registerPlan, teardown } from "@/test/factories";
import { startGeneration, type GenerationDeps } from "./generation-job";

/**
 * The enqueue path against the real local stack, with the SOLVER faked at the transport seam.
 *
 * Faking there and nowhere else is the point: everything below the seam is real — the plan loader,
 * the snapshot assembly, `computeSnapshotHash`, `clone_plan`, the `generation_jobs` insert and the
 * partial unique index that makes "one active job per plan" true. Only the HTTP call to a service
 * that would take twelve minutes is stubbed, which is also what lets this suite run in CI without
 * the solver container (the full chain against a live service is Phase 5's).
 *
 * What it pins is the ORDERING contract, because every failure mode is an ordering statement:
 * assemble and hash before any write, and never leave a `queued` row that nothing was dispatched
 * for — a state no later slice could tell apart from a solver that died before claiming.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

type Dispatched = { jobId: string; snapshotHash: string };

/** Records what it was asked to dispatch, so the test can assert the body was the hashed snapshot. */
const recordingTransport = (): { transport: SolverTransport; calls: Dispatched[] } => {
  const calls: Dispatched[] = [];
  return {
    calls,
    transport: {
      dispatchSolveJob: async (jobId, request) => {
        calls.push({ jobId, snapshotHash: await computeSnapshotHash(request.snapshot) });
      },
      checkHealth: () => Promise.resolve(true),
    },
  };
};

const refusingTransport = (): SolverTransport => ({
  dispatchSolveJob: () => Promise.reject(new SolverDispatchError(503, "at capacity")),
  checkHealth: () => Promise.resolve(false),
});

const deps = (transport: SolverTransport | null): GenerationDeps => ({ getTransport: () => transport });

(hasEnv ? describe : describe.skip)("startGeneration (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;
  let planId: string;
  let planName: string;

  const jobsFor = async (id: string) =>
    (
      await supabase
        .from("generation_jobs")
        .select("id, status, proposal_plan_id, snapshot_hash, policy, error")
        .eq("plan_id", id)
    ).data ?? [];

  const planExists = async (id: string): Promise<boolean> =>
    ((await supabase.from("plans").select("id").eq("id", id)).data ?? []).length > 0;

  /**
   * Proposal clones of ONE source plan, found by the deterministic name `startGeneration` gives them.
   * Scoped that way on purpose: `pnpm test:integration` runs suites in parallel, so a global
   * `plans` count would be measuring the other suites' fixtures as much as this one's.
   */
  const proposalsOf = async (sourceName: string): Promise<string[]> =>
    ((await supabase.from("plans").select("id").eq("name", `Proposal — ${sourceName}`)).data ?? []).map(
      (row) => row.id,
    );

  /**
   * A uniquely-named plan, so its proposals are findable by name.
   *
   * Deliberately NOT `seedPlanCatalog`-ed. Every assertion here is about the enqueue ORDERING —
   * what exists after each failure mode — and none of them reads the snapshot's contents, which
   * `plan-snapshot.test.ts` covers without a database. An empty catalog assembles, hashes, clones
   * and dispatches exactly the same way, and skipping four full CSV seeds keeps this suite off the
   * local stack's back while the whole integration lane runs in parallel.
   */
  const seededPlan = async (label: string): Promise<{ id: string; name: string }> => {
    const name = `Enqueue ${label} ${crypto.randomUUID()}`;
    return { id: await createFactoryPlan(supabase, { name }), name };
  };

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
    const source = await seededPlan("source");
    planId = source.id;
    planName = source.name;
  });

  afterAll(async () => {
    if (hasEnv) await teardown(supabase);
  });

  it("clones the plan, records a queued job, and dispatches the snapshot it hashed", async () => {
    const { transport, calls } = recordingTransport();

    const result = await startGeneration(supabase, { planId }, deps(transport));
    registerPlan(result.proposalPlanId);

    const [job] = await jobsFor(planId);
    expect(job).toMatchObject({
      id: result.jobId,
      status: "queued",
      proposal_plan_id: result.proposalPlanId,
      policy: { clean: true },
    });
    expect(await planExists(result.proposalPlanId)).toBe(true);

    // The binding the solver checks after claiming: the row's digest IS the dispatched body's.
    expect(calls).toEqual([{ jobId: result.jobId, snapshotHash: job.snapshot_hash }]);
  });

  it("refuses a second job while one is active, and leaves no orphan clone behind", async () => {
    // The partial unique index is the enforcement; this asserts the app TRANSLATES it rather than
    // leaking a 23505 — and, just as importantly, that the clone made moments earlier is cleaned up.
    await expect(startGeneration(supabase, { planId }, deps(recordingTransport().transport))).rejects.toThrow(
      DomainError,
    );
    await expect(startGeneration(supabase, { planId }, deps(recordingTransport().transport))).rejects.toThrow(
      /already running/i,
    );

    // Exactly the one proposal the FIRST (successful) enqueue made — the two refused attempts each
    // cloned before discovering the conflict, and each undid it.
    expect(await proposalsOf(planName)).toHaveLength(1);
    expect(await jobsFor(planId)).toHaveLength(1);
  });

  it("marks the job failed and deletes the clone when dispatch is refused", async () => {
    const other = await seededPlan("refused");

    await expect(startGeneration(supabase, { planId: other.id }, deps(refusingTransport()))).rejects.toThrow(/503/);

    const [job] = await jobsFor(other.id);
    expect(job.status).toBe("failed");
    expect(job.error).toMatch(/dispatch failed/);
    // The row inserts with a non-null `proposal_plan_id`, and the column is `on delete set null` —
    // so a null here IS the evidence the clone was deleted, and the failed row self-documents that
    // its proposal target is gone rather than pointing at a plan that no longer exists.
    expect(job.proposal_plan_id).toBeNull();
    // No half-made proposal left on the plans list either.
    expect(await proposalsOf(other.name)).toHaveLength(0);

    // ...and because the row is terminal, the plan is enqueueable again.
    const retry = await startGeneration(supabase, { planId: other.id }, deps(recordingTransport().transport));
    registerPlan(retry.proposalPlanId);
    expect(await jobsFor(other.id)).toHaveLength(2);
  });

  it("fails before touching anything when no solver is configured", async () => {
    const unconfigured = await seededPlan("unconfigured");

    await expect(startGeneration(supabase, { planId: unconfigured.id }, deps(null))).rejects.toThrow(/not configured/);

    expect(await jobsFor(unconfigured.id)).toHaveLength(0);
    expect(await proposalsOf(unconfigured.name)).toHaveLength(0);
  });

  it("reports a missing plan as NOT_FOUND rather than cloning nothing", async () => {
    await expect(
      startGeneration(
        supabase,
        { planId: "00000000-0000-0000-0000-000000000000" },
        deps(recordingTransport().transport),
      ),
    ).rejects.toThrow(/not found/i);
  });
});
