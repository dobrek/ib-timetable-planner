import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clonePlan, type Database, type SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";
import { createPlan, registerPlan, teardown } from "@/test/factories";
import { deletePlan } from "./delete-plan";
import { loadPlans } from "./loader";
import { markCurrentPlan } from "./mark-current-plan";
import { unmarkCurrentPlan } from "./unmark-current-plan";

// The current-plan marker (S-404, FR-420), driven against the local Supabase as the service role:
// the database rules first, then the hub's domain functions.
//
// TEST ISOLATION. `is_current` is the first fact that spans plans, and the lane runs files in
// parallel, so another file can move the marker at any moment: the role matrix's allowed probes
// really mark a fresh plan current. So nothing here reads the table afterwards to ask "is plan X
// current right now" or "is no plan current". The cases assert on what an RPC returned, on "at most
// one plan is current", and on facts no other file can change: a plan this file never marked is
// not current, because nobody else knows its id. A violation is provoked in one statement over this
// file's own plans, so it never depends on which plan someone else marked. Apart from the matrix
// probe, this is the only file that moves the marker.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

const MISSING_PLAN_ID = "00000000-0000-4000-8000-000000000000";

(hasEnv ? describe : describe.skip)("current-plan marker (local Supabase)", () => {
  let supabase: SupabaseClient;

  beforeAll(() => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
  });

  afterAll(async () => {
    await teardown(supabase);
  });

  describe("database rules", () => {
    it("a new plan and a clone are not current", async () => {
      const source = await createPlan(supabase);
      expect(await isCurrent(supabase, source)).toBe(false);

      // Marked first, so a clone that copied the column would carry it (or trip the unique index).
      await setCurrent(supabase, source);
      const { id: clone } = await clonePlan(supabase, {
        sourcePlanId: source,
        name: `Current Clone ${source}`,
        includeBoard: false,
      });
      registerPlan(clone);
      expect(await isCurrent(supabase, clone)).toBe(false);
    });

    it("set_current_plan returns the target marked current, and at most one plan is current", async () => {
      const plan = await createPlan(supabase);

      expect(await setCurrent(supabase, plan)).toEqual([expect.objectContaining({ id: plan, is_current: true })]);
      expect(await countCurrent(supabase)).toBeLessThanOrEqual(1);
    });

    it("set_current_plan moves the marker: the previously marked plan is no longer current", async () => {
      const first = await createPlan(supabase);
      const second = await createPlan(supabase);

      await setCurrent(supabase, first);
      await setCurrent(supabase, second);

      // Only this file knows `first`, so nobody can have marked it again since.
      expect(await isCurrent(supabase, first)).toBe(false);
    });

    it("set_current_plan on a missing plan returns no row and changes nothing", async () => {
      // The function returns before it unsets anything. Whether some plan is still marked is not
      // this file's to assert (test isolation), so the returned rows are the claim.
      expect(await setCurrent(supabase, MISSING_PLAN_ID)).toEqual([]);
    });

    it("set_current_plan on a pending proposal returns no row", async () => {
      const pending = await createPendingPlan(supabase);

      expect(await setCurrent(supabase, pending)).toEqual([]);
      expect(await isCurrent(supabase, pending)).toBe(false);
    });

    it("two concurrent set_current_plan calls both succeed", async () => {
      const first = await createPlan(supabase);
      const second = await createPlan(supabase);

      // The movers' advisory lock makes the second wait and then win, instead of meeting the
      // first's new current row in the unique index (23505).
      const [firstRows, secondRows] = await Promise.all([setCurrent(supabase, first), setCurrent(supabase, second)]);

      expect(firstRows).toEqual([expect.objectContaining({ id: first, is_current: true })]);
      expect(secondRows).toEqual([expect.objectContaining({ id: second, is_current: true })]);
    });

    it("the database refuses two current plans", async () => {
      const first = await createPlan(supabase);
      const second = await createPlan(supabase);

      const { error } = await supabase.from("plans").update({ is_current: true }).in("id", [first, second]);

      expect(error?.code).toBe("23505");
    });

    it("the database refuses a current pending proposal", async () => {
      const pending = await createPendingPlan(supabase);

      const { error } = await supabase.from("plans").update({ is_current: true }).eq("id", pending);

      expect(error?.code).toBe("23514");
    });

    it("moving the marker does not change updated_at on either plan; a rename still does", async () => {
      const first = await createPlan(supabase);
      const second = await createPlan(supabase);
      const before = { first: await updatedAt(supabase, first), second: await updatedAt(supabase, second) };

      await setCurrent(supabase, first);
      await setCurrent(supabase, second);

      // Another file's move would unset `second` the same way, which the trigger skips too.
      expect({ first: await updatedAt(supabase, first), second: await updatedAt(supabase, second) }).toEqual(before);

      const { error } = await supabase
        .from("plans")
        .update({ name: `Renamed ${first}` })
        .eq("id", first);
      expect(error).toBeNull();
      expect(await updatedAt(supabase, first)).not.toBe(before.first);
    });

    it("marking the plan that is already current returns it and leaves its updated_at unchanged", async () => {
      const plan = await createPlan(supabase);
      await setCurrent(supabase, plan);
      const markedAt = await updatedAt(supabase, plan);

      // Whether another file moved the marker in between or not, the second call never bumps the
      // date: it either skips a target already current or flips it back, which the trigger skips.
      expect(await setCurrent(supabase, plan)).toEqual([
        expect.objectContaining({ id: plan, is_current: true, updated_at: markedAt }),
      ]);
    });
  });

  describe("hub domain functions", () => {
    it("markCurrentPlan returns the plan marked current", async () => {
      const plan = await createPlan(supabase);

      expect(await markCurrentPlan(supabase, { id: plan })).toMatchObject({ id: plan, is_current: true });
    });

    it("markCurrentPlan on a pending proposal throws CONFLICT with the pending message", async () => {
      const pending = await createPendingPlan(supabase);

      const failure = markCurrentPlan(supabase, { id: pending });

      await expect(failure).rejects.toMatchObject({ code: "CONFLICT", message: /still being generated/ });
      expect(await isCurrent(supabase, pending)).toBe(false);
    });

    it("markCurrentPlan on a missing plan throws NOT_FOUND 'Plan not found.'", async () => {
      await expect(markCurrentPlan(supabase, { id: MISSING_PLAN_ID })).rejects.toEqual(
        new DomainError("NOT_FOUND", "Plan not found."),
      );
    });

    // Retried: the one case that needs the marker to stay put between two calls. A parallel file can
    // move it between the mark and the unmark, and the unmark then rightly finds nothing to clear.
    it("unmarkCurrentPlan clears the marker on the plan that holds it", { retry: 2 }, async () => {
      const plan = await createPlan(supabase);
      const createdAt = await updatedAt(supabase, plan);
      await markCurrentPlan(supabase, { id: plan });

      // Clearing writes `is_current` alone, so "Last updated" stays where it was.
      expect(await unmarkCurrentPlan(supabase, { id: plan })).toMatchObject({
        id: plan,
        is_current: false,
        updated_at: createdAt,
      });
    });

    it("unmarkCurrentPlan on a plan that is not current throws NOT_FOUND", async () => {
      const plan = await createPlan(supabase);

      await expect(unmarkCurrentPlan(supabase, { id: plan })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("deletePlan deletes the current plan (no refusal)", async () => {
      const plan = await createPlan(supabase);
      expect(await markCurrentPlan(supabase, { id: plan })).toMatchObject({ is_current: true });

      await deletePlan(supabase, { id: plan });

      const { data, error } = await supabase.from("plans").select("id").eq("id", plan);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("the hub loader returns isCurrent, current row first", async () => {
      const unmarked = await createPlan(supabase);

      const result = await loadPlans(supabase);
      if (result.kind !== "ok") throw new Error("the hub loader was unavailable");

      // One query, one snapshot: whoever holds the marker, these hold for this read.
      const currentRows = result.plans.flatMap((row, index) => (row.isCurrent ? [index] : []));
      expect(currentRows.length).toBeLessThanOrEqual(1);
      expect(currentRows.every((index) => index === 0)).toBe(true);
      expect(result.plans.find((row) => row.id === unmarked)).toMatchObject({ isCurrent: false });
    });
  });
});

type PlanRecord = Database["public"]["Tables"]["plans"]["Row"];

/** The marker move as the service role. Throws on any error, so a case only ever sees rows. */
const setCurrent = async (supabase: SupabaseClient, planId: string): Promise<PlanRecord[]> => {
  const { data, error } = await supabase.rpc("set_current_plan", { p_plan_id: planId });
  if (error) throw new Error(`set_current_plan: ${error.message}`);
  return data;
};

const isCurrent = async (supabase: SupabaseClient, planId: string): Promise<boolean> =>
  (await readPlan(supabase, planId)).is_current;

const updatedAt = async (supabase: SupabaseClient, planId: string): Promise<string> =>
  (await readPlan(supabase, planId)).updated_at;

const readPlan = async (supabase: SupabaseClient, planId: string): Promise<PlanRecord> => {
  const { data, error } = await supabase.from("plans").select().eq("id", planId).single();
  if (error) throw new Error(`read plan ${planId}: ${error.message}`);
  return data;
};

const countCurrent = async (supabase: SupabaseClient): Promise<number> => {
  const { count, error } = await supabase
    .from("plans")
    .select("id", { count: "exact", head: true })
    .eq("is_current", true);
  if (error) throw new Error(`count current plans: ${error.message}`);
  return count ?? 0;
};

/** A fresh plan flagged as a pending proposal, the way generation's `markPending` leaves a clone. */
const createPendingPlan = async (supabase: SupabaseClient): Promise<string> => {
  const planId = await createPlan(supabase);
  const { error } = await supabase.from("plans").update({ pending_proposal: true }).eq("id", planId);
  if (error) throw new Error(`mark pending: ${error.message}`);
  return planId;
};
