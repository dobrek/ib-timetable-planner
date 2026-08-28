import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/shared/api";
import { createPlan as createFactoryPlan, teardown } from "@/test/factories";
import { loadPlans } from "./loader";
import { readGenerationJobStatuses } from "./generation-status";

/**
 * The hub's read side against the real database: the SSR loader's indicator attachment, and the poll
 * the store calls on a timer.
 *
 * Two properties only this lane can prove. First, that the narrow projections actually work against
 * PostgREST — a `select` string is a runtime contract, and a column typo is green in every unit test
 * and 400s here. Second, that **at most one indicator per plan** holds, which is not something the
 * loader enforces at all: it is `generation_jobs_active_per_plan`, a partial unique index, and the
 * only way to check it is to try to insert a second active row and be refused.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

(hasEnv ? describe : describe.skip)("plans-list generation status (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;
  let activePlanId: string;
  let quietPlanId: string;
  let activeJobId: string;
  let terminalJobId: string;
  let activeProposalId: string;
  let readyProposalId: string;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

    activePlanId = await createFactoryPlan(supabase, { name: "Hub Indicator — active" });
    quietPlanId = await createFactoryPlan(supabase, { name: "Hub Indicator — quiet" });
    // Stand-in proposal rows. They are plans in their own right (that is the whole of S-306), so a
    // plain factory plan is exactly what `clone_plan` would have produced for these purposes.
    activeProposalId = await createFactoryPlan(supabase, { name: "Proposal — Hub Indicator active" });
    readyProposalId = await createFactoryPlan(supabase, { name: "Proposal — Hub Indicator ready" });

    // A finished job FIRST, so the active one below is the only row the partial index sees. It is
    // DELIVERED and already announced, which is what keeps it off the hub — the case the
    // `notified_at` backfill exists for.
    terminalJobId = await enqueue(supabase, activePlanId, {
      status: "succeeded",
      finished_at: nowIso(),
      proposal_plan_id: readyProposalId,
      delivered_plan_id: readyProposalId,
      delivery: "proposal",
      notified_at: nowIso(),
    });
    activeJobId = await enqueue(supabase, activePlanId, {
      status: "running",
      started_at: nowIso(),
      stage_index: 4,
      stage_name: "teacherHoles",
      proposal_plan_id: activeProposalId,
    });
  });

  afterAll(async () => {
    await teardown(supabase);
  });

  it("attaches the active job to the PROPOSAL row, not the source, and nothing to a quiet plan", async () => {
    // S-306: the badge belongs on the row it is about. Both plans are on this page, so the proposal
    // wins and the source shows nothing — otherwise the same job would badge twice.
    const result = await loadPlans(supabase);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const byId = (id: string) => result.plans.find((plan) => plan.id === id);

    expect(byId(activeProposalId)?.indicators).toHaveLength(1);
    expect(byId(activeProposalId)?.indicators[0]).toMatchObject({
      kind: "generation",
      jobId: activeJobId,
      planId: activePlanId,
      proposalPlanId: activeProposalId,
      delivered: false,
      status: "running",
      stageIndex: 4,
      stageName: "teacherHoles",
    });
    // `created_at` comes from the database, so pin that it parses rather than what it says.
    expect(Number.isNaN(Date.parse(byId(activeProposalId)?.indicators[0]?.startedAt ?? ""))).toBe(false);
    expect(byId(activePlanId)?.indicators).toEqual([]);
    expect(byId(quietPlanId)?.indicators).toEqual([]);
  });

  it("leaves a delivered-and-ANNOUNCED job off the hub entirely", async () => {
    // The other half of the durable-badge rule: "Ready — open" survives a reload only until the
    // author opens the proposal once, which is what stamps `notified_at`. This job carries one.
    const result = await loadPlans(supabase);
    if (result.kind !== "ok") return;

    expect(result.plans.find((plan) => plan.id === readyProposalId)?.indicators).toEqual([]);
  });

  it("keeps a READY proposal badged across a reload until it has been announced", async () => {
    // The reload is what this proves: before S-306 terminal memory lived only in the poll store's
    // RAM, so a refresh erased "Ready". Now the SSR loader itself returns the row.
    const plan = await createFactoryPlan(supabase, { name: "Hub Indicator — ready source" });
    const proposal = await createFactoryPlan(supabase, { name: "Proposal — Hub Indicator ready source" });
    await enqueue(supabase, plan, {
      status: "succeeded",
      finished_at: nowIso(),
      proposal_plan_id: proposal,
      delivered_plan_id: proposal,
      delivery: "proposal",
    });

    const result = await loadPlans(supabase);
    if (result.kind !== "ok") return;

    expect(result.plans.find((row) => row.id === proposal)?.indicators[0]).toMatchObject({
      delivered: true,
      proposalPlanId: proposal,
      status: "succeeded",
    });
  });

  it("keeps a terminal-but-UNDELIVERED job badged, so a ready board is never silent", async () => {
    const plan = await createFactoryPlan(supabase, { name: "Hub Indicator — undelivered source" });
    const proposal = await createFactoryPlan(supabase, { name: "Proposal — Hub Indicator undelivered" });
    await enqueue(supabase, plan, {
      status: "succeeded",
      finished_at: nowIso(),
      proposal_plan_id: proposal,
    });

    const result = await loadPlans(supabase);
    if (result.kind !== "ok") return;

    expect(result.plans.find((row) => row.id === proposal)?.indicators[0]).toMatchObject({
      delivered: false,
      status: "succeeded",
    });
  });

  it("cannot attach two indicators to one plan, because the database refuses the second job", async () => {
    // `generation_jobs_active_per_plan` is what makes the loader's one-query design safe — not any
    // check in the loader itself, which simply keys a Map by plan id.
    const second = await supabase
      .from("generation_jobs")
      .insert({ plan_id: activePlanId, policy: {}, snapshot: {}, snapshot_hash: "x".repeat(64), status: "queued" });

    expect(second.error?.code).toBe("23505");
  });

  it("reads back the jobs it is asked about, terminal ones included", async () => {
    // Terminal rows are the point of the jobIds path: a poll learns a job ENDED by being told its
    // new status, so filtering them out would leave the badge spinning forever.
    const indicators = await readGenerationJobStatuses(supabase, {
      jobIds: [activeJobId, terminalJobId],
      planIds: [],
    });

    expect(indicators.map((indicator) => indicator.status).sort()).toEqual(["running", "succeeded"]);
  });

  it("discovers an active job from the SOURCE plan id alone — the two-tab flow", async () => {
    // The hole S-306 opens: a job started on a plan page creates a proposal row the already-open hub
    // has never loaded, so the discovery read has to match on the id the hub DOES know.
    const indicators = await readGenerationJobStatuses(supabase, { jobIds: [], planIds: [activePlanId] });

    expect(indicators).toHaveLength(1);
    expect(indicators[0]).toMatchObject({ jobId: activeJobId, status: "running", stageIndex: 4 });
  });

  it("discovers the same job from the PROPOSAL plan id, once that row is on the page", async () => {
    const indicators = await readGenerationJobStatuses(supabase, { jobIds: [], planIds: [activeProposalId] });

    expect(indicators).toHaveLength(1);
    expect(indicators[0]).toMatchObject({ jobId: activeJobId, proposalPlanId: activeProposalId });
  });

  it("returns one entry when both paths name the same row", async () => {
    const indicators = await readGenerationJobStatuses(supabase, {
      jobIds: [activeJobId],
      planIds: [activePlanId],
    });

    expect(indicators).toHaveLength(1);
  });

  it("issues no query at all when asked about nothing", async () => {
    expect(await readGenerationJobStatuses(supabase, { jobIds: [], planIds: [] })).toEqual([]);
  });

  it("never selects the payload columns — a 5-second timer must not drag the snapshot", async () => {
    // `snapshot` is ~124 KB and TOASTed, `result` and `checkpoint` ~35 KB each. Asserting the SHAPE
    // of what comes back is how a widened projection gets caught: an extra column would appear here.
    //
    // `stale` is derived, not projected: S-304 added `heartbeat_at` — a scalar timestamp — to the
    // columns and computes staleness at the mapping edge, so the payloads stay off the wire. This
    // list is the specification of that, and it must be updated deliberately, never to make a red
    // test green.
    const [indicator] = await readGenerationJobStatuses(supabase, { jobIds: [activeJobId], planIds: [] });

    expect(Object.keys(indicator).sort()).toEqual([
      "delivered",
      "jobId",
      "kind",
      "planId",
      "proposalPlanId",
      "stageIndex",
      "stageName",
      "stale",
      "startedAt",
      "status",
    ]);
  });
});

const nowIso = (): string => new Date().toISOString();

/** Insert a job row as admin — the solver holds no INSERT, and neither does the hub. */
const enqueue = async (
  supabase: SupabaseClient<Database>,
  planId: string,
  fields: Record<string, unknown>,
): Promise<string> => {
  const { data, error } = await supabase
    .from("generation_jobs")
    .insert({
      plan_id: planId,
      policy: { mode: "complete" },
      snapshot: {},
      snapshot_hash: "a".repeat(64),
      ...fields,
    })
    .select("id")
    .single();
  if (error) throw new Error(`enqueue: ${error.message}`);
  return data.id;
};
