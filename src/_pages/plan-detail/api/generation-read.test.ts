import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SOLVE_POLICY } from "@/entities/timetable";
import type { SupabaseClient } from "@/shared/api";
import { withStopper, type GenerationJobView, type StatusRow } from "./generation-read";

const GRACE = "22222222-2222-4222-8222-222222222222";

const view = (over: Partial<GenerationJobView> = {}): GenerationJobView => ({
  jobId: "job-1",
  status: "stopped",
  role: "proposal",
  sourcePlanId: "plan-1",
  sourcePlanName: "Year 2026/27",
  proposalPlanId: "plan-2",
  delivered: false,
  error: null,
  createdAt: "2026-11-06T07:40:07.000Z",
  finishedAt: "2026-11-06T07:52:00.000Z",
  cleanLabel: { kind: "unavailable" },
  checkpointStageIndex: null,
  stageIndex: 3,
  stageName: "teacherHoles",
  stopRequestedAt: "2026-11-06T07:50:00.000Z",
  requestedBy: GRACE,
  stopRequestedBy: null,
  stoppedBy: null,
  policy: DEFAULT_SOLVE_POLICY,
  stalled: false,
  awaitingDelivery: false,
  ...over,
});

/** `withStopper` reads only the stopper's id off the row. */
const row = { stop_requested_by: GRACE } as StatusRow;

/** A client stub answering the credit lookup's two `.select(…).in(…)` reads. */
const stubClient = () => {
  const rows: Record<string, unknown[]> = {
    user_directory: [{ user_id: GRACE, email: "grace@example.test", is_service_account: false }],
    profiles: [{ user_id: GRACE, display_name: "Grace Hopper" }],
  };
  const from = vi.fn((table: string) => ({
    select: () => ({ in: () => Promise.resolve({ data: rows[table] ?? [], error: null }) }),
  }));
  return { client: { from } as unknown as SupabaseClient, from };
};

describe("withStopper", () => {
  it("names the stopper of a stopped job", async () => {
    const { client } = stubClient();

    const named = await withStopper(client, row, view());

    expect(named.stoppedBy).toMatchObject({ kind: "user", user: { id: GRACE } });
  });

  it("leaves the stopper unnamed when the lookup fails, rather than failing the read", async () => {
    const failing = {
      from: () => ({ select: () => ({ in: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) }),
    } as unknown as SupabaseClient;
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      await expect(withStopper(failing, row, view())).resolves.toMatchObject({ stoppedBy: null });
      expect(quiet).toHaveBeenCalledOnce();
    } finally {
      quiet.mockRestore();
    }
  });

  it("looks nobody up while the board waits for delivery, which a viewer polls every tick", async () => {
    const { client, from } = stubClient();
    const waiting = view({ checkpointStageIndex: 4, awaitingDelivery: true });

    await expect(withStopper(client, row, waiting)).resolves.toBe(waiting);
    expect(from).not.toHaveBeenCalled();
  });

  it("looks nobody up for a job that was not stopped", async () => {
    const { client, from } = stubClient();
    const interrupted = view({ status: "interrupted" });

    await expect(withStopper(client, row, interrupted)).resolves.toBe(interrupted);
    expect(from).not.toHaveBeenCalled();
  });
});
