// @vitest-environment jsdom
//
// The store listens for `visibilitychange` on `document`, and pausing a backgrounded tab is one of
// its four rules — so this needs a DOM. The jsdom PROJECT is scoped to `*.test.tsx` (the repo's
// ".tsx only for JSX" convention), and this file has no JSX in it, so the environment is selected
// per-file here rather than by renaming a JSX-free test to `.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createJobProgressStore, type JobProgressFetcher } from "./job-progress-store";
import type { GenerationIndicator } from "./plan-indicators";

const PLAN_A = "11111111-1111-4111-8111-111111111111";
const PLAN_B = "33333333-3333-4333-8333-333333333333";
const JOB_A = "22222222-2222-4222-8222-222222222222";
/** The proposal plan A's job solves onto — the row the badge is really about (S-306). */
const PROPOSAL_A = "44444444-4444-4444-8444-444444444444";

const indicator = (overrides: Partial<GenerationIndicator> = {}): GenerationIndicator => ({
  kind: "generation",
  jobId: JOB_A,
  planId: PLAN_A,
  proposalPlanId: PROPOSAL_A,
  delivered: false,
  status: "running",
  stageIndex: 1,
  stageName: "completeness",
  startedAt: "2026-08-20T14:02:31.000Z",
  stale: false,
  ...overrides,
});

/**
 * A fetcher that answers from a queue and records what it was asked for.
 *
 * The store REPLACES its snapshot with each answer, so an exhausted queue means "everything is
 * gone", not "nothing changed" — every test's queue must cover the ticks it drives.
 */
const scriptedFetcher = (...responses: GenerationIndicator[][]) => {
  const calls: { jobIds: string[]; planIds: string[] }[] = [];
  const queue = [...responses];
  const fetch: JobProgressFetcher = (input) => {
    calls.push(input);
    return Promise.resolve(queue.shift() ?? []);
  };
  return { fetch, calls };
};

/** Advance fake timers AND drain the microtask queue the async tick resolves through. */
const advance = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms);
};

const setVisibility = (state: "visible" | "hidden"): void => {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
};

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createJobProgressStore", () => {
  it("starts from the SSR'd indicators, and serves them as the server snapshot too", () => {
    const { fetch } = scriptedFetcher();
    const store = createJobProgressStore({ initial: [indicator()], planIds: [PLAN_A], fetch });

    expect(store.getSnapshot().get(PLAN_A)).toMatchObject({ status: "running", stageIndex: 1 });
    // Identical objects, so the first client render cannot disagree with the server's markup.
    expect(store.getServerSnapshot()).toBe(store.getSnapshot());
    store.dispose();
  });

  it("polls only once something is subscribed", async () => {
    const { fetch, calls } = scriptedFetcher([indicator()]);
    const store = createJobProgressStore({ initial: [indicator()], planIds: [PLAN_A], fetch, intervalMs: 5000 });

    await advance(20_000);
    expect(calls).toHaveLength(0);

    store.subscribe(() => undefined);
    await advance(5000);
    expect(calls).toHaveLength(1);
    store.dispose();
  });

  it("does not poll at all on an idle hub — the common case costs nothing", async () => {
    const { fetch, calls } = scriptedFetcher();
    const store = createJobProgressStore({ initial: [], planIds: [PLAN_A, PLAN_B], fetch, intervalMs: 5000 });
    store.subscribe(() => undefined);

    await advance(60_000);

    expect(calls).toHaveLength(0);
    store.dispose();
  });

  it("advances the snapshot as stages come in, and notifies subscribers", async () => {
    const { fetch } = scriptedFetcher([indicator({ stageIndex: 4, stageName: "teacherHoles" })]);
    const store = createJobProgressStore({ initial: [indicator()], planIds: [PLAN_A], fetch, intervalMs: 5000 });
    const notified = vi.fn();
    store.subscribe(notified);

    await advance(5000);

    expect(store.getSnapshot().get(PLAN_A)).toMatchObject({ stageIndex: 4, stageName: "teacherHoles" });
    expect(notified).toHaveBeenCalledTimes(1);
    store.dispose();
  });

  it("keeps the snapshot's identity stable when nothing changed", async () => {
    // Three answers for the three ticks 15 s buys: the subject of this test is "nothing changed",
    // so the fetcher has to keep saying so. An exhausted queue would be an eviction, not a no-op.
    const { fetch } = scriptedFetcher([indicator()], [indicator()], [indicator()]);
    const store = createJobProgressStore({ initial: [indicator()], planIds: [PLAN_A], fetch, intervalMs: 5000 });
    const notified = vi.fn();
    store.subscribe(notified);
    const before = store.getSnapshot();

    await advance(15_000);

    // `useSyncExternalStore` compares snapshots by identity: a fresh Map every tick would re-render
    // the hub on a timer, and could loop.
    expect(store.getSnapshot()).toBe(before);
    expect(notified).not.toHaveBeenCalled();
    store.dispose();
  });

  it("stops polling once every known job is terminal", async () => {
    const { fetch, calls } = scriptedFetcher([indicator({ status: "succeeded" })]);
    const store = createJobProgressStore({ initial: [indicator()], planIds: [PLAN_A], fetch, intervalMs: 5000 });
    store.subscribe(() => undefined);

    await advance(5000);
    expect(calls).toHaveLength(1);

    await advance(60_000);
    expect(calls).toHaveLength(1);
    store.dispose();
  });

  it("remembers a terminal job instead of letting its badge vanish", async () => {
    // Rule 4: the badge outlives the solve because the ROW does, and the refresh re-read it. The
    // memory is the server's, not the store's — see the eviction cases below for the other half.
    const { fetch } = scriptedFetcher([indicator({ status: "succeeded" })]);
    const store = createJobProgressStore({ initial: [indicator()], planIds: [PLAN_A], fetch, intervalMs: 5000 });
    store.subscribe(() => undefined);

    await advance(15_000);

    expect(store.getSnapshot().get(PLAN_A)).toMatchObject({ status: "succeeded" });
    store.dispose();
  });

  it("asks about every job it remembers AND the plans it might not", async () => {
    const { fetch, calls } = scriptedFetcher([indicator()]);
    const store = createJobProgressStore({
      initial: [indicator()],
      planIds: [PLAN_A, PLAN_B],
      fetch,
      intervalMs: 5000,
    });
    store.subscribe(() => undefined);

    await advance(5000);

    // The planIds half is the two-tab flow: a hub open while Generate was pressed on a plan page has
    // no job id to refresh, so discovery is the only way it ever learns.
    expect(calls[0]).toEqual({ jobIds: [JOB_A], planIds: [PLAN_A, PLAN_B] });
    store.dispose();
  });

  it("keeps asking about a job that has already gone terminal", async () => {
    // The request half of eviction. `refreshKnown` is unfiltered by status, so a terminal row that
    // still exists always comes back — and a terminal job the store stopped asking about could never
    // be found missing, which is why the old active-only refresh made the stale badge unfixable.
    const succeeded = indicator({ status: "succeeded" });
    const { fetch, calls } = scriptedFetcher([succeeded]);
    const store = createJobProgressStore({ initial: [succeeded], planIds: [PLAN_A], fetch, intervalMs: 5000 });
    store.subscribe(() => undefined);

    // Terminal-only, so no timer runs (rule 1) — the visibility path is the tick.
    setVisibility("hidden");
    setVisibility("visible");
    await advance(0);

    expect(calls[0]).toEqual({ jobIds: [JOB_A], planIds: [PLAN_A] });
    store.dispose();
  });

  it("asks nothing when it has neither a plan to discover through nor a job to re-confirm", async () => {
    // The bail. A hub with no plans on the page and an empty snapshot has no question to ask, so it
    // must not spend a request asking it — not even on the unconditional visibility tick of rule 5.
    const { fetch, calls } = scriptedFetcher();
    const store = createJobProgressStore({ initial: [], planIds: [], fetch, intervalMs: 5000 });
    store.subscribe(() => undefined);

    setVisibility("hidden");
    setVisibility("visible");
    await advance(60_000);

    expect(calls).toHaveLength(0);
    store.dispose();
  });

  it("discovers a job that started in another tab", async () => {
    const { fetch } = scriptedFetcher([indicator({ planId: PLAN_B, jobId: "job-b" })]);
    const store = createJobProgressStore({ initial: [], planIds: [PLAN_A, PLAN_B], fetch, intervalMs: 5000 });
    store.subscribe(() => undefined);

    // Nothing is active, so no timer runs — the tab discovers on its next focus instead.
    setVisibility("hidden");
    setVisibility("visible");
    await advance(0);

    expect(store.getSnapshot().get(PLAN_B)).toMatchObject({ status: "running" });
    store.dispose();
  });

  it("pauses while the tab is hidden and ticks immediately on return", async () => {
    const { fetch, calls } = scriptedFetcher([indicator({ stageIndex: 2 })], [indicator({ stageIndex: 3 })]);
    const store = createJobProgressStore({ initial: [indicator()], planIds: [PLAN_A], fetch, intervalMs: 5000 });
    store.subscribe(() => undefined);

    setVisibility("hidden");
    await advance(60_000);
    expect(calls, "a backgrounded tab must not poll all night").toHaveLength(0);

    setVisibility("visible");
    await advance(0);
    expect(calls, "and must be fresh the moment it is looked at again").toHaveLength(1);
    store.dispose();
  });

  it("keeps the last snapshot when a fetch fails, and retries on the next tick", async () => {
    const calls: number[] = [];
    let attempt = 0;
    const fetch: JobProgressFetcher = () => {
      attempt += 1;
      calls.push(attempt);
      return attempt === 1 ? Promise.reject(new Error("offline")) : Promise.resolve([indicator({ stageIndex: 7 })]);
    };
    const store = createJobProgressStore({ initial: [indicator()], planIds: [PLAN_A], fetch, intervalMs: 5000 });
    store.subscribe(() => undefined);

    await advance(5000);
    // The stale badge survives the failed tick rather than blanking or turning red.
    expect(store.getSnapshot().get(PLAN_A)).toMatchObject({ stageIndex: 1 });

    await advance(5000);
    expect(store.getSnapshot().get(PLAN_A)).toMatchObject({ stageIndex: 7 });
    store.dispose();
  });

  it("stops polling when the last subscriber leaves", async () => {
    const { fetch, calls } = scriptedFetcher([indicator()], [indicator()], [indicator()]);
    const store = createJobProgressStore({ initial: [indicator()], planIds: [PLAN_A], fetch, intervalMs: 5000 });
    const unsubscribe = store.subscribe(() => undefined);

    await advance(5000);
    expect(calls).toHaveLength(1);

    unsubscribe();
    await advance(60_000);
    expect(calls).toHaveLength(1);
    store.dispose();
  });

  it("never runs two fetches at once, however slow one is", async () => {
    let resolveFirst: ((value: GenerationIndicator[]) => void) | undefined;
    const calls: number[] = [];
    const fetch: JobProgressFetcher = () => {
      calls.push(calls.length);
      return calls.length === 1
        ? new Promise<GenerationIndicator[]>((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve([]);
    };
    const store = createJobProgressStore({ initial: [indicator()], planIds: [PLAN_A], fetch, intervalMs: 5000 });
    store.subscribe(() => undefined);

    await advance(30_000);
    expect(calls, "a slow tick must not stack a queue behind it").toHaveLength(1);

    resolveFirst?.([indicator({ stageIndex: 2 })]);
    await advance(5000);
    expect(calls.length).toBeGreaterThan(1);
    store.dispose();
  });

  it("goes quiet after dispose", async () => {
    const { fetch, calls } = scriptedFetcher([indicator()], [indicator()]);
    const store = createJobProgressStore({ initial: [indicator()], planIds: [PLAN_A], fetch, intervalMs: 5000 });
    store.subscribe(() => undefined);

    store.dispose();
    await advance(60_000);

    expect(calls).toHaveLength(0);
  });
});

describe("server-confirmed memory", () => {
  it("evicts a remembered TERMINAL badge once the server stops returning its row", async () => {
    // The stale "Ready — open" shape. The author opened the proposal and then deleted it from its own
    // page, so `delivered_plan_id` went back to null while `delivery` stayed set — the mapping edge
    // drops the row, and the answer simply omits it. Under union-merge the badge stayed on screen
    // forever, linking to a plan that no longer exists.
    const delivered = indicator({ status: "succeeded", delivered: true });
    const { fetch } = scriptedFetcher([]);
    const store = createJobProgressStore({ initial: [delivered], planIds: [PLAN_A], fetch, intervalMs: 5000 });
    store.subscribe(() => undefined);

    setVisibility("hidden");
    setVisibility("visible");
    await advance(0);

    expect(store.getSnapshot().has(PLAN_A)).toBe(false);
    store.dispose();
  });

  it("evicts a remembered ACTIVE badge whose row vanished, and stops polling", async () => {
    // The forever-poll shape: the source plan was deleted mid-solve, so the job row cascaded away
    // with it. The badge kept saying "Generating", which kept `shouldRun()` true, which kept a
    // request going out every five seconds for as long as the tab stayed open.
    const { fetch, calls } = scriptedFetcher([]);
    const store = createJobProgressStore({ initial: [indicator()], planIds: [], fetch, intervalMs: 5000 });
    store.subscribe(() => undefined);

    await advance(5000);
    expect(store.getSnapshot().size).toBe(0);

    await advance(60_000);
    expect(calls, "nothing left to watch, so nothing left to ask").toHaveLength(1);
    store.dispose();
  });

  it("keeps a terminal badge for as long as the row keeps coming back", async () => {
    // The other side of the same coin: replacing the snapshot wholesale is only safe because the
    // refresh is status-unfiltered, so a row that still exists is in every answer.
    const succeeded = indicator({ status: "succeeded" });
    const { fetch } = scriptedFetcher([succeeded], [succeeded]);
    const store = createJobProgressStore({ initial: [indicator()], planIds: [PLAN_A], fetch, intervalMs: 5000 });
    store.subscribe(() => undefined);

    await advance(5000);
    setVisibility("hidden");
    setVisibility("visible");
    await advance(0);

    expect(store.getSnapshot().get(PLAN_A)).toMatchObject({ status: "succeeded" });
    store.dispose();
  });
});

describe("snapshot equality", () => {
  it("republishes when a job becomes DELIVERED without changing status", () => {
    // The subtle one S-306 introduces: a `succeeded` row stays `succeeded` while another tab's visit
    // lands the board, and the label crosses from "Finished — open to deliver" to "Ready — open". If
    // `delivered` were left out of the field comparison the badge would freeze on the older label for
    // as long as the hub stayed open.
    const listener = vi.fn();
    const undelivered = indicator({ status: "succeeded", delivered: false });
    const { fetch } = scriptedFetcher([{ ...undelivered, delivered: true }]);
    const store = createJobProgressStore({ initial: [undelivered], planIds: [PLAN_A], fetch, intervalMs: 1000 });
    store.subscribe(listener);

    // A terminal-only snapshot runs no timer (rule 1), so drive one tick through the visibility path.
    document.dispatchEvent(new Event("visibilitychange"));

    return vi.waitFor(() => {
      expect(listener).toHaveBeenCalled();
      expect(store.getSnapshot().get(PLAN_A)?.delivered).toBe(true);
    });
  });
});
