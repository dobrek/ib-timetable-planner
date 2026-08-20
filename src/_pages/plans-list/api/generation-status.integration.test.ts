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

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

    activePlanId = await createFactoryPlan(supabase, { name: "Hub Indicator — active" });
    quietPlanId = await createFactoryPlan(supabase, { name: "Hub Indicator — quiet" });

    // A finished job FIRST, so the active one below is the only row the partial index sees.
    terminalJobId = await enqueue(supabase, activePlanId, { status: "succeeded", finished_at: nowIso() });
    activeJobId = await enqueue(supabase, activePlanId, {
      status: "running",
      started_at: nowIso(),
      stage_index: 4,
      stage_name: "teacherHoles",
    });
  });

  afterAll(async () => {
    await teardown(supabase);
  });

  it("attaches the active job to its plan, and nothing to a quiet one", async () => {
    const result = await loadPlans(supabase);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const active = result.plans.find((plan) => plan.id === activePlanId);
    const quiet = result.plans.find((plan) => plan.id === quietPlanId);

    expect(active?.indicators).toHaveLength(1);
    expect(active?.indicators[0]).toMatchObject({
      kind: "generation",
      jobId: activeJobId,
      planId: activePlanId,
      status: "running",
      stageIndex: 4,
      stageName: "teacherHoles",
    });
    // `created_at` comes from the database, so pin that it parses rather than what it says.
    expect(Number.isNaN(Date.parse(active?.indicators[0]?.startedAt ?? ""))).toBe(false);
    // The succeeded job on the same plan is deliberately absent: the SSR read is active-only, so a
    // finished run leaves no trace on the hub after a reload. The plan page's strip owns that.
    expect(quiet?.indicators).toEqual([]);
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

  it("discovers an active job from a plan id alone — the two-tab flow", async () => {
    const indicators = await readGenerationJobStatuses(supabase, { jobIds: [], planIds: [activePlanId] });

    expect(indicators).toHaveLength(1);
    expect(indicators[0]).toMatchObject({ jobId: activeJobId, status: "running", stageIndex: 4 });
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
    const [indicator] = await readGenerationJobStatuses(supabase, { jobIds: [activeJobId], planIds: [] });

    expect(Object.keys(indicator).sort()).toEqual([
      "jobId",
      "kind",
      "planId",
      "stageIndex",
      "stageName",
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
