import { isActiveIndicator, type GenerationIndicator } from "./plan-indicators";

/**
 * The hub's polling loop, as an EXTERNAL STORE rather than an effect.
 *
 * That shape is not a preference. React 19's `react-hooks/set-state-in-effect` rule (live in this
 * repo's ESLint config, and the wall S-301 hit) rules out the naive fetch-in-an-effect-then-setState
 * loop outright, and the React Compiler is asked to memoize this island like every other. The
 * repo's answer is the one `board-zoom.ts` already uses: keep the mutable thing OUTSIDE React, and
 * let `useSyncExternalStore` subscribe to it. Nothing here calls `setState`.
 *
 * Five rules govern when it reads, and each exists for a reason worth stating:
 *
 *   1. **Only while something is active.** An idle hub — the overwhelming common case — issues no
 *      requests at all. When the last active job goes terminal the timer stops itself.
 *   2. **Only while subscribed.** No subscriber means no visible hub, so nothing to update.
 *   3. **Only while the tab is visible.** A backgrounded tab left open overnight would otherwise
 *      poll ~12 times a minute forever. Returning to it ticks IMMEDIATELY, so the badge is fresh by
 *      the time the author has finished looking at it.
 *   4. **Terminal indicators are remembered.** A job that finishes stays in the snapshot rather than
 *      vanishing, because a badge that disappears reads as a failure. Since S-306 this memory is a
 *      cache rather than the only record: the SSR loader and the discovery read both return
 *      terminal-undelivered and delivered-but-unannounced rows, so a reload no longer erases a ready
 *      proposal — it stays badged until the author opens it once, which is what stamps `notified_at`.
 *   5. **Becoming visible always DISCOVERS, even when nothing is active.** Rule 1 alone would leave
 *      the realistic two-tab flow broken: a hub tab open while Generate was pressed on a plan page
 *      knows no job id, has nothing active, and so would never start a timer — showing nothing at all
 *      until a reload. So a tab returning to the foreground makes one read keyed by the page's PLAN
 *      ids. One request per tab-focus; rule 1 still holds for the 5-second timer.
 *
 * A failed fetch keeps the last snapshot and lets the next tick retry. There is no error state in
 * the UI: the badge is an advisory, and a red cell every time a laptop's Wi-Fi blinks would be worse
 * than a label that is five seconds stale.
 */
export type JobProgressStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => IndicatorsByPlan;
  getServerSnapshot: () => IndicatorsByPlan;
  /**
   * Unsubscribe everyone, which stops the timer and drops the visibility listener. Not one-way: a
   * later `subscribe` re-arms the store. For tests and for a deliberate teardown.
   */
  dispose: () => void;
};

export type IndicatorsByPlan = ReadonlyMap<string, GenerationIndicator>;

export type JobProgressFetcher = (input: { jobIds: string[]; planIds: string[] }) => Promise<GenerationIndicator[]>;

export type JobProgressStoreOptions = {
  /** The SSR'd indicators. Also the server snapshot, so hydration is deterministic by construction. */
  initial: readonly GenerationIndicator[];
  /** Every plan on the page — the discovery key, so a job started in another tab is found. */
  planIds: readonly string[];
  fetch: JobProgressFetcher;
  intervalMs?: number;
};

export const DEFAULT_POLL_INTERVAL_MS = 5000;

export const createJobProgressStore = (options: JobProgressStoreOptions): JobProgressStore => {
  const { initial, planIds, fetch, intervalMs = DEFAULT_POLL_INTERVAL_MS } = options;
  const serverSnapshot: IndicatorsByPlan = indexByPlan(initial);

  let snapshot = serverSnapshot;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  const listeners = new Set<() => void>();

  const publish = (next: IndicatorsByPlan): void => {
    // Identity is the contract `useSyncExternalStore` enforces: returning a fresh Map every tick
    // would re-render the hub five times a minute and, worse, loop if the render read it again.
    if (sameIndicators(snapshot, next)) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const tick = async (): Promise<void> => {
    // One request at a time. A tick that outlives the interval (a slow link) must not stack up a
    // queue of identical reads that then all land at once and fight over the snapshot.
    if (inFlight || listeners.size === 0) return;
    if (planIds.length === 0 && activeJobIds(snapshot).length === 0) return;
    inFlight = true;
    try {
      const fetched = await fetch({ jobIds: activeJobIds(snapshot), planIds: [...planIds] });
      // The last subscriber can leave WHILE this awaits; a store nobody is watching stays silent.
      if (listeners.size > 0) publish(merge(snapshot, fetched));
    } catch {
      // Keep the last snapshot; the next tick retries. See the class docstring.
    } finally {
      inFlight = false;
      syncTimer();
    }
  };

  const shouldRun = (): boolean => listeners.size > 0 && isVisible() && [...snapshot.values()].some(isActiveIndicator);

  const syncTimer = (): void => {
    if (shouldRun() && timer === null) {
      timer = setInterval(() => void tick(), intervalMs);
    } else if (!shouldRun() && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const onVisibilityChange = (): void => {
    // Unconditional on becoming visible — NOT gated on `shouldRun()` — and that is the whole of rule
    // 5. Ticking before re-arming also matters: the author is looking at the badge now, and waiting a
    // full interval to refresh a tab they just returned to is the one delay they would notice.
    if (isVisible() && listeners.size > 0) void tick();
    syncTimer();
  };

  // The DOM listener lives and dies with the subscription — attached by the first subscriber,
  // detached by the last — exactly as `board-zoom.ts` does with `storage`. Nothing touches the
  // document at construction time, so creating the store inside a render is side-effect free, and
  // a mount → cleanup → remount (StrictMode's rehearsal) simply re-arms it.
  const listen = (): void => {
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibilityChange);
  };
  const unlisten = (): void => {
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibilityChange);
  };

  return {
    subscribe: (listener) => {
      if (listeners.size === 0) listen();
      listeners.add(listener);
      syncTimer();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) unlisten();
        syncTimer();
      };
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => serverSnapshot,
    dispose: () => {
      if (listeners.size > 0) unlisten();
      listeners.clear();
      syncTimer();
    },
  };
};

const indexByPlan = (indicators: readonly GenerationIndicator[]): IndicatorsByPlan =>
  new Map(indicators.map((indicator) => [indicator.planId, indicator]));

/**
 * The fetched rows over the remembered ones, keyed by plan.
 *
 * Fetched wins on a collision — it is strictly newer — and a plan the fetch did not mention keeps
 * what it had, which is what makes terminal memory work.
 *
 * S-306 demoted that memory from the only record to a cache. The discovery read now also returns
 * terminal-undelivered and delivered-but-unannounced rows, so "Ready — open" is a ROW state that
 * survives a reload; this in-RAM memory is what keeps the badge on screen between the moment a job
 * goes terminal and the next tick that re-reads it. Rule 4 in the class docstring is amended
 * accordingly.
 */
const merge = (current: IndicatorsByPlan, fetched: readonly GenerationIndicator[]): IndicatorsByPlan =>
  new Map([...current, ...indexByPlan(fetched)]);

const activeJobIds = (snapshot: IndicatorsByPlan): string[] =>
  [...snapshot.values()].filter(isActiveIndicator).map((indicator) => indicator.jobId);

/** Field-by-field, because a new Map with equal contents is a different object every tick. */
const sameIndicators = (a: IndicatorsByPlan, b: IndicatorsByPlan): boolean => {
  if (a.size !== b.size) return false;
  for (const [planId, left] of a) {
    const right = b.get(planId);
    if (!right) return false;
    if (
      left.jobId !== right.jobId ||
      left.status !== right.status ||
      left.stageIndex !== right.stageIndex ||
      left.stageName !== right.stageName ||
      // S-306: `delivered` is the difference between "Finished — open to deliver" and "Ready — open",
      // and a job can cross it without its status changing — a `succeeded` row stays `succeeded` while
      // some other tab's visit lands the board. Omitting it here would freeze the badge on the older
      // of the two labels for as long as the hub stayed open.
      left.delivered !== right.delivered ||
      left.proposalPlanId !== right.proposalPlanId
    ) {
      return false;
    }
  }
  return true;
};

const isVisible = (): boolean => typeof document === "undefined" || document.visibilityState === "visible";
