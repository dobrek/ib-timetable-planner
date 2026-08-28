import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationJobView } from "../../api/generation-delivery";
import { createPendingProposalStore } from "./use-pending-proposal";

/**
 * The pending page's ticker, driven at the STORE level rather than through the hook.
 *
 * `useSyncExternalStore` is a thin subscription over this object — the hook adds a `useState`
 * initializer and nothing else — so every rule worth pinning (when it reads, when it stops, what it
 * does on delivery) is a property of the store. Same split as `job-progress-store.test.ts` on the hub.
 */
const view = (over: Partial<GenerationJobView> = {}): GenerationJobView => ({
  jobId: "job-1",
  status: "running",
  role: "proposal",
  sourcePlanId: "plan-1",
  sourcePlanName: "Year 2026/27",
  proposalPlanId: "plan-2",
  delivered: false,
  error: null,
  createdAt: "2026-08-28T07:40:07.000Z",
  finishedAt: null,
  cleanLabel: { kind: "unavailable" },
  checkpointStageIndex: null,
  stageIndex: 3,
  stageName: "teacherHoles",
  ...over,
});

const INTERVAL = 5000;

describe("createPendingProposalStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks while the job is active, and each tick is the DELIVERING check", async () => {
    // Not the hub's status-only read: this page's whole content is the job, and the author is looking
    // at the plan the board lands on. See the store's docblock for why that inverts S-303's rule.
    const check = vi.fn().mockResolvedValue(view({ stageIndex: 4 }));
    const store = createPendingProposalStore({ planId: "plan-2", initial: view(), check, onDelivered: vi.fn() });
    store.subscribe(vi.fn());

    await vi.advanceTimersByTimeAsync(INTERVAL);

    expect(check).toHaveBeenCalledWith("plan-2");
    expect(store.getSnapshot()?.stageIndex).toBe(4);
    store.dispose();
  });

  it("does not tick at all while the job is terminal", () => {
    // A failed or swept job has nothing left to report, and this page is the last thing the author
    // sees before they navigate away. An idle page must issue no requests.
    const check = vi.fn();
    const store = createPendingProposalStore({
      planId: "plan-2",
      initial: view({ status: "failed" }),
      check,
      onDelivered: vi.fn(),
    });
    store.subscribe(vi.fn());

    vi.advanceTimersByTime(INTERVAL * 4);

    expect(check).not.toHaveBeenCalled();
    store.dispose();
  });

  it("does not tick before anyone subscribes, nor after the last subscriber leaves", () => {
    const check = vi.fn();
    const store = createPendingProposalStore({ planId: "plan-2", initial: view(), check, onDelivered: vi.fn() });

    vi.advanceTimersByTime(INTERVAL * 2);
    expect(check).not.toHaveBeenCalled();

    const unsubscribe = store.subscribe(vi.fn());
    unsubscribe();
    vi.advanceTimersByTime(INTERVAL * 2);

    expect(check).not.toHaveBeenCalled();
  });

  it("navigates once the tick reports a delivered board — and only once", async () => {
    // The delivery happened INSIDE that check, server-side. The navigation is what renders it: the
    // route now answers the same URL with a board, through the normal SSR path, so there is no
    // client-side board bootstrap to keep in step with the server's.
    const onDelivered = vi.fn();
    const check = vi.fn().mockResolvedValue(view({ status: "succeeded", delivered: true }));
    const store = createPendingProposalStore({ planId: "plan-2", initial: view(), check, onDelivered });
    store.subscribe(vi.fn());

    await vi.advanceTimersByTimeAsync(INTERVAL * 3);

    expect(onDelivered).toHaveBeenCalledOnce();
    store.dispose();
  });

  it("stops ticking after it has announced, so a slow navigation cannot re-deliver", async () => {
    const check = vi.fn().mockResolvedValue(view({ status: "succeeded", delivered: true }));
    const store = createPendingProposalStore({ planId: "plan-2", initial: view(), check, onDelivered: vi.fn() });
    store.subscribe(vi.fn());

    await vi.advanceTimersByTimeAsync(INTERVAL);
    const afterFirst = check.mock.calls.length;
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);

    expect(check).toHaveBeenCalledTimes(afterFirst);
    store.dispose();
  });

  it("notifies subscribers only when something actually changed", async () => {
    // Identity is the contract `useSyncExternalStore` enforces: the action returns a fresh object
    // every tick, so publishing it unconditionally would re-render the island twelve times a minute.
    const listener = vi.fn();
    const check = vi.fn().mockResolvedValue(view());
    const store = createPendingProposalStore({ planId: "plan-2", initial: view(), check, onDelivered: vi.fn() });
    store.subscribe(listener);

    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    expect(listener).not.toHaveBeenCalled();

    check.mockResolvedValue(view({ stageIndex: 7 }));
    await vi.advanceTimersByTimeAsync(INTERVAL);

    expect(listener).toHaveBeenCalled();
    store.dispose();
  });

  it("keeps the last snapshot when a read fails, and retries on the next tick", async () => {
    // The page is an advisory. A red banner every time Wi-Fi blinks would be worse than a stage
    // number that is five seconds stale.
    const check = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(view({ stageIndex: 9 }));
    const store = createPendingProposalStore({ planId: "plan-2", initial: view(), check, onDelivered: vi.fn() });
    store.subscribe(vi.fn());

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(store.getSnapshot()?.stageIndex).toBe(3);

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(store.getSnapshot()?.stageIndex).toBe(9);
    store.dispose();
  });

  it("serves the SSR'd view as the server snapshot, so hydration matches by construction", () => {
    const initial = view();
    const store = createPendingProposalStore({ planId: "plan-2", initial, check: vi.fn(), onDelivered: vi.fn() });

    expect(store.getServerSnapshot()).toBe(initial);
  });
});
