import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SOLVE_POLICY } from "@/entities/timetable";
import { checkPlan, readPlanJob } from "../../api/generation-client";
import type { GenerationJobView } from "../../api/generation-read";
import { createPendingProposalStore, WAITING_BACKOFF_AFTER_MS, WAITING_POLL_INTERVAL_MS } from "./use-pending-proposal";

// The default transports, so a test can tell which one a store picked without a server.
vi.mock("../../api/generation-client", () => ({ checkPlan: vi.fn(), readPlanJob: vi.fn() }));

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
  stopRequestedAt: null,
  policy: DEFAULT_SOLVE_POLICY,
  stalled: false,
  awaitingDelivery: false,
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
    const store = createPendingProposalStore({
      planId: "plan-2",
      canEdit: true,
      initial: view(),
      check,
      onDelivered: vi.fn(),
    });
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
      canEdit: true,
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
    const store = createPendingProposalStore({
      planId: "plan-2",
      canEdit: true,
      initial: view(),
      check,
      onDelivered: vi.fn(),
    });

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
    const store = createPendingProposalStore({ planId: "plan-2", canEdit: true, initial: view(), check, onDelivered });
    store.subscribe(vi.fn());

    await vi.advanceTimersByTimeAsync(INTERVAL * 3);

    expect(onDelivered).toHaveBeenCalledOnce();
    store.dispose();
  });

  it("stops ticking after it has announced, so a slow navigation cannot re-deliver", async () => {
    const check = vi.fn().mockResolvedValue(view({ status: "succeeded", delivered: true }));
    const store = createPendingProposalStore({
      planId: "plan-2",
      canEdit: true,
      initial: view(),
      check,
      onDelivered: vi.fn(),
    });
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
    const store = createPendingProposalStore({
      planId: "plan-2",
      canEdit: true,
      initial: view(),
      check,
      onDelivered: vi.fn(),
    });
    store.subscribe(listener);

    await vi.advanceTimersByTimeAsync(INTERVAL * 2);
    expect(listener).not.toHaveBeenCalled();

    check.mockResolvedValue(view({ stageIndex: 7 }));
    await vi.advanceTimersByTimeAsync(INTERVAL);

    expect(listener).toHaveBeenCalled();
    store.dispose();
  });

  it.each([
    ["the policy preset", view({ policy: { preset: "student-first" } })],
    [
      "cleanRequested on a not-clean label",
      view({ cleanLabel: { kind: "not-clean", softHits: 3, floor: 1, cleanRequested: false } }),
    ],
  ])("notices a change to %s — every rendered field is named in the gate", async (_field, next) => {
    // The documented rule: a field the projection carries but the gate ignores changes silently.
    const listener = vi.fn();
    const base = view({ cleanLabel: { kind: "not-clean", softHits: 3, floor: 1, cleanRequested: true } });
    const check = vi.fn().mockResolvedValue(base);
    const store = createPendingProposalStore({
      planId: "plan-2",
      canEdit: true,
      initial: base,
      check,
      onDelivered: vi.fn(),
    });
    store.subscribe(listener);

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(listener).not.toHaveBeenCalled();

    check.mockResolvedValue({ ...base, ...next });
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
    const store = createPendingProposalStore({
      planId: "plan-2",
      canEdit: true,
      initial: view(),
      check,
      onDelivered: vi.fn(),
    });
    store.subscribe(vi.fn());

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(store.getSnapshot()?.stageIndex).toBe(3);

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(store.getSnapshot()?.stageIndex).toBe(9);
    store.dispose();
  });

  /**
   * A viewer's store (S-405). Its read never writes, so a finished board does not land on its tick —
   * it waits for an author's or admin's visit. The store keeps watching while it waits, which is what
   * turns the viewer's page into the board on its own.
   */
  it("never backs off an editor's ticker, which ends with the ladder", async () => {
    const check = vi.fn().mockImplementation(() => Promise.resolve(view({ status: "running" })));
    const store = createPendingProposalStore({
      planId: "plan-2",
      canEdit: true,
      initial: view({ status: "running" }),
      check,
      onDelivered: vi.fn(),
    });
    store.subscribe(vi.fn());

    await vi.advanceTimersByTimeAsync(WAITING_BACKOFF_AFTER_MS + WAITING_POLL_INTERVAL_MS);

    expect(check).toHaveBeenCalledTimes((WAITING_BACKOFF_AFTER_MS + WAITING_POLL_INTERVAL_MS) / INTERVAL);
    store.dispose();
  });

  describe("for a viewer", () => {
    const finished = (over: Partial<GenerationJobView> = {}) =>
      view({ status: "succeeded", stageIndex: 10, awaitingDelivery: true, ...over });

    it("defaults to the write-free read, never the delivering check", async () => {
      vi.mocked(readPlanJob).mockResolvedValue(view());
      const store = createPendingProposalStore({
        planId: "plan-2",
        canEdit: false,
        initial: view(),
        onDelivered: vi.fn(),
      });
      store.subscribe(vi.fn());

      await vi.advanceTimersByTimeAsync(INTERVAL);

      expect(readPlanJob).toHaveBeenCalledWith("plan-2");
      expect(checkPlan).not.toHaveBeenCalled();
      store.dispose();
    });

    it("keeps ticking while a finished board waits for an author", async () => {
      const check = vi.fn().mockResolvedValue(finished());
      const store = createPendingProposalStore({
        planId: "plan-2",
        canEdit: false,
        initial: finished(),
        check,
        onDelivered: vi.fn(),
      });
      store.subscribe(vi.fn());

      await vi.advanceTimersByTimeAsync(INTERVAL * 3);

      expect(check).toHaveBeenCalledTimes(3);
      store.dispose();
    });

    // The wait lasts as long as no author visits — days, on a tab left open. The first stretch keeps
    // the full cadence; after it, at most one read a minute.
    it.each([
      { what: "a finished board", waiting: () => finished() },
      { what: "a stalled run", waiting: () => view({ status: "running", stalled: true }) },
    ])("backs off a long wait on $what to one read a minute", async ({ waiting }) => {
      const check = vi.fn().mockImplementation(() => Promise.resolve(waiting()));
      const store = createPendingProposalStore({
        planId: "plan-2",
        canEdit: false,
        initial: waiting(),
        check,
        onDelivered: vi.fn(),
      });
      store.subscribe(vi.fn());

      // The first tick starts the wait's clock, and every tick of the first stretch reads.
      await vi.advanceTimersByTimeAsync(WAITING_BACKOFF_AFTER_MS);
      const fullCadence = WAITING_BACKOFF_AFTER_MS / INTERVAL;
      expect(check).toHaveBeenCalledTimes(fullCadence);

      // Then no read until a minute after the last one, and exactly one when it is due.
      await vi.advanceTimersByTimeAsync(WAITING_POLL_INTERVAL_MS - INTERVAL);
      expect(check).toHaveBeenCalledTimes(fullCadence);
      await vi.advanceTimersByTimeAsync(INTERVAL);
      expect(check).toHaveBeenCalledTimes(fullCadence + 1);
      store.dispose();
    });

    it("reloads into the board on the first tick that finds it delivered — and only once", async () => {
      const onDelivered = vi.fn();
      const check = vi
        .fn()
        .mockResolvedValueOnce(finished())
        .mockResolvedValue(finished({ delivered: true, awaitingDelivery: false }));
      const store = createPendingProposalStore({
        planId: "plan-2",
        canEdit: false,
        initial: finished(),
        check,
        onDelivered,
      });
      store.subscribe(vi.fn());

      await vi.advanceTimersByTimeAsync(INTERVAL);
      expect(onDelivered).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(INTERVAL * 3);
      expect(onDelivered).toHaveBeenCalledOnce();
      expect(check).toHaveBeenCalledTimes(2);
      store.dispose();
    });

    it("an editor's store stops on the same snapshot — its own tick is what delivers", () => {
      const check = vi.fn();
      const store = createPendingProposalStore({
        planId: "plan-2",
        canEdit: true,
        initial: finished(),
        check,
        onDelivered: vi.fn(),
      });
      store.subscribe(vi.fn());

      vi.advanceTimersByTime(INTERVAL * 4);

      expect(check).not.toHaveBeenCalled();
      store.dispose();
    });

    it("still stops on a terminal job with no board to wait for", () => {
      const check = vi.fn();
      const store = createPendingProposalStore({
        planId: "plan-2",
        canEdit: false,
        initial: view({ status: "failed" }),
        check,
        onDelivered: vi.fn(),
      });
      store.subscribe(vi.fn());

      vi.advanceTimersByTime(INTERVAL * 4);

      expect(check).not.toHaveBeenCalled();
      store.dispose();
    });
  });

  it.each([
    ["stalled", { stalled: true }],
    ["awaitingDelivery", { awaitingDelivery: true }],
  ] as const)("notices %s changing alone — a viewer's panel turns on it", async (_field, change) => {
    // The S-405 flags change panels while every other field stays put, so the gate must name them.
    const listener = vi.fn();
    const base = view();
    const check = vi.fn().mockResolvedValue(base);
    const store = createPendingProposalStore({
      planId: "plan-2",
      canEdit: false,
      initial: base,
      check,
      onDelivered: vi.fn(),
    });
    store.subscribe(listener);

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(listener).not.toHaveBeenCalled();

    check.mockResolvedValue({ ...base, ...change });
    await vi.advanceTimersByTimeAsync(INTERVAL);

    expect(listener).toHaveBeenCalled();
    store.dispose();
  });

  it("serves the SSR'd view as the server snapshot, so hydration matches by construction", () => {
    const initial = view();
    const store = createPendingProposalStore({
      planId: "plan-2",
      canEdit: true,
      initial,
      check: vi.fn(),
      onDelivered: vi.fn(),
    });

    expect(store.getServerSnapshot()).toBe(initial);
  });
});
