import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clonePlan, type Database } from "@/shared/api";
import { HEARTBEAT_GRACE_MS } from "@/entities/timetable";
import { createPlan as createFactoryPlan, registerPlan, teardown } from "@/test/factories";
import { releaseOrphanProposal } from "./release-orphan-proposal";

/**
 * The stranded orphan, against the real stack.
 *
 * `proposalIsReleasable` already made a job-less pending clone *deletable*; this suite is about the
 * other half — making it *usable*. The whole subject is one guarded UPDATE, and both halves of the
 * guard matter: it must clear a plan old enough that "no job row" cannot mean mid-enqueue, and it
 * must NOT clear one still inside that window, because `startGeneration` flags the clone pending a
 * round trip before it inserts the job.
 *
 * The end-to-end case picks the story up from the cascade: the hub's half — that deleting the SOURCE
 * of a stale running job is ALLOWED — belongs to `plans-list`, and is pinned in
 * `plan-actions.integration.test.ts` beside the other delete guards (a cross-slice import here would
 * be a steiger error, and would put the guard's test on the wrong side of the boundary anyway).
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

(hasEnv ? describe : describe.skip)("releaseOrphanProposal (local Supabase)", () => {
  let supabase: SupabaseClient<Database>;

  beforeAll(() => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
  });

  afterAll(async () => {
    if (hasEnv) await teardown(supabase);
  });

  /** A source plan plus the pending clone `startGeneration` would have made from it. */
  const sourceAndPendingClone = async (label: string): Promise<{ sourceId: string; proposalId: string }> => {
    const sourceId = await createFactoryPlan(supabase, { name: `Orphan ${label} ${crypto.randomUUID()}` });
    const { id: proposalId } = await clonePlan(supabase, {
      sourcePlanId: sourceId,
      name: `Proposal — Orphan ${label}`,
      includeBoard: true,
    });
    registerPlan(proposalId);
    await supabase.from("plans").update({ pending_proposal: true }).eq("id", proposalId);
    return { sourceId, proposalId };
  };

  /** Age the plan row past the grace — a genuine orphan always is, its source having died first. */
  const backdate = async (planId: string): Promise<void> => {
    const longAgo = new Date(Date.now() - HEARTBEAT_GRACE_MS - 60_000).toISOString();
    const { error } = await supabase.from("plans").update({ created_at: longAgo }).eq("id", planId);
    if (error) throw new Error(`backdate: ${error.message}`);
  };

  const pendingOf = async (planId: string): Promise<boolean | undefined> =>
    (await supabase.from("plans").select("pending_proposal").eq("id", planId).maybeSingle()).data?.pending_proposal;

  it("un-pends a stranded proposal old enough that no job row can mean mid-enqueue", async () => {
    const { proposalId } = await sourceAndPendingClone("release");
    await backdate(proposalId);

    await releaseOrphanProposal(supabase, proposalId);

    expect(await pendingOf(proposalId)).toBe(false);
  });

  it("leaves a FRESH pending clone alone — that is the enqueue race, not an orphan", async () => {
    // `startGeneration` writes `pending_proposal = true` one round trip BEFORE inserting the job row,
    // so every Generate passes through "pending with no job" for a few milliseconds. An unconditional
    // clear would un-pend a clone whose solve is about to be dispatched.
    const { proposalId } = await sourceAndPendingClone("race");

    await releaseOrphanProposal(supabase, proposalId);

    expect(await pendingOf(proposalId)).toBe(true);
  });

  it("is a no-op on a plan that is not pending, so a repeat visit writes nothing new", async () => {
    const { proposalId } = await sourceAndPendingClone("idempotent");
    await backdate(proposalId);

    await releaseOrphanProposal(supabase, proposalId);
    await releaseOrphanProposal(supabase, proposalId);

    expect(await pendingOf(proposalId)).toBe(false);
  });

  it("heals the whole path: a stale solve's source is deleted, and the clone becomes ordinary", async () => {
    // The defect end to end, from the cascade onwards. The hub lets the source of a STALE running job
    // be deleted — deliberately, since a container that vanished must not hold a plan hostage — and
    // `plan_id` is `on delete cascade`, so that deletion takes the job row with it and leaves the
    // clone pending with nothing that could ever clear the flag: a permanent "still being generated"
    // page for a plan that holds a real board.
    const { sourceId, proposalId } = await sourceAndPendingClone("end-to-end");
    const longAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const { error } = await supabase.from("generation_jobs").insert({
      plan_id: sourceId,
      proposal_plan_id: proposalId,
      snapshot: {},
      snapshot_hash: crypto.randomUUID(),
      policy: { clean: true },
      status: "running",
      heartbeat_at: longAgo,
      created_at: longAgo,
    });
    if (error) throw new Error(`insert job: ${error.message}`);
    await backdate(proposalId);

    await supabase.from("plans").delete().eq("id", sourceId);

    expect((await supabase.from("generation_jobs").select("id").eq("plan_id", sourceId)).data).toEqual([]);
    expect(await pendingOf(proposalId)).toBe(true);

    // ...and the next visit to the clone is what rescues it.
    await releaseOrphanProposal(supabase, proposalId);

    expect(await pendingOf(proposalId)).toBe(false);
  });
});
