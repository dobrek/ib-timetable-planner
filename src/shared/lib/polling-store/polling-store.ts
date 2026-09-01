/**
 * The polling lifecycle both live-progress stores in this app need, with the domain left out.
 *
 * Two slices grew the same ~55 lines independently — the hub's generation badges
 * (`plans-list/model/job-progress-store.ts`) and the pending proposal page's ticker
 * (`plan-detail/model/generation/use-pending-proposal.ts`). What they share is not a fetch, it is a
 * LIFECYCLE: a timer that runs only when there is something to watch, a visibility listener that
 * lives and dies with the subscription, a single in-flight read, and an equality-gated publish.
 *
 * **Why a store rather than an effect.** React 19's `react-hooks/set-state-in-effect` rule (live in
 * this repo's ESLint config) rules out the naive fetch-in-an-effect-then-setState loop outright, and
 * the React Compiler memoizes these islands like every other. So the mutable thing lives OUTSIDE
 * React and `useSyncExternalStore` subscribes to it. Nothing here calls `setState`.
 *
 * **Why the domain arrives as closures.** FSD forbids `shared` importing from `entities`, so
 * `isActiveJobStatus` — the predicate that decides whether a job is worth polling for — cannot be
 * named here. That constraint produced the right seam rather than an obstacle: every domain question
 * is one option, and this file knows only "is there anything to watch" and "did it change".
 *
 * Four behavioural invariants, all pinned by the suite beside this file:
 *
 *   1. The timer runs only while **subscribed ∧ visible ∧ `isActive(snapshot)`**. An idle store — the
 *      common case on both pages — issues no requests at all, and a backgrounded tab left open
 *      overnight goes quiet instead of polling twelve times a minute.
 *   2. **One read in flight at a time.** A read that outlives the interval (a slow link) must not
 *      stack a queue of identical reads that then all land at once and fight over the snapshot.
 *   3. **A failed read keeps the snapshot** and lets the next tick retry. Both consumers are
 *      advisories; a red cell every time a laptop's Wi-Fi blinks is worse than five-second-stale text.
 *   4. **Becoming visible ticks immediately**, by default even when nothing is active — the hub needs
 *      that to discover a job started in another tab, and a store returning to the foreground should
 *      be fresh by the time the reader has finished looking at it. `tickOnVisible` narrows it.
 */
export type PollingStore<T> = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => T;
  getServerSnapshot: () => T;
  /**
   * Unsubscribe everyone, which stops the timer and drops the visibility listener. Not one-way: a
   * later `subscribe` re-arms the store. For tests and for a deliberate teardown.
   */
  dispose: () => void;
};

export type PollingStoreOptions<T> = {
  /** The first snapshot, and the server snapshot — so hydration is deterministic by construction. */
  initial: T;
  /** Identity is the contract `useSyncExternalStore` enforces; a fresh object every tick would
   *  re-render the island on a timer and could loop. Compare by value here. */
  isEqual: (a: T, b: T) => boolean;
  /**
   * Produce the NEXT snapshot from the current one.
   *
   * The whole read, including any bail: a tick with nothing worth asking about returns `current`
   * unchanged rather than reaching the network, and the equality gate turns that into a no-op.
   * Returning the next snapshot (rather than a delta to merge) is what lets the hub's eviction
   * semantics — the answer replaces the snapshot, so a row the server stops returning loses its
   * badge — live in the consumer instead of needing a hook here.
   */
  read: (current: T) => Promise<T>;
  /** Is there anything left worth polling for? Drives the timer. */
  isActive: (snapshot: T) => boolean;
  /**
   * A side effect on the read's result, run AFTER the publish attempt and OUTSIDE the
   * `listeners.size > 0` guard — on every successful read, whatever the snapshot did.
   *
   * Both halves are load-bearing rather than incidental. After, because the pending page's
   * `onDelivered` navigates and the board it navigates into must not be racing an unpublished
   * snapshot. Outside, because delivery already happened server-side inside `read`: a subscriber
   * leaving mid-flight is a reason to publish nothing, never a reason to swallow the fact.
   */
  afterTick?: (next: T) => void;
  /** Whether becoming visible should tick. Defaults to unconditional (invariant 4). */
  tickOnVisible?: (snapshot: T) => boolean;
  intervalMs?: number;
};

export const createPollingStore = <T>(options: PollingStoreOptions<T>): PollingStore<T> => {
  const {
    initial,
    isEqual,
    read,
    isActive,
    afterTick,
    tickOnVisible = always,
    intervalMs = DEFAULT_POLL_INTERVAL_MS,
  } = options;

  let snapshot = initial;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  const listeners = new Set<() => void>();

  const publish = (next: T): void => {
    if (isEqual(snapshot, next)) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const tick = async (): Promise<void> => {
    if (inFlight || listeners.size === 0) return;
    inFlight = true;
    try {
      const next = await read(snapshot);
      // The last subscriber can leave WHILE this awaits; a store nobody is watching stays silent.
      if (listeners.size > 0) publish(next);
      afterTick?.(next);
    } catch {
      // Invariant 3: keep the last snapshot and let the next tick retry.
    } finally {
      inFlight = false;
      syncTimer();
    }
  };

  const shouldRun = (): boolean => listeners.size > 0 && isVisible() && isActive(snapshot);

  const syncTimer = (): void => {
    if (shouldRun() && timer === null) {
      timer = setInterval(() => void tick(), intervalMs);
    } else if (!shouldRun() && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const onVisibilityChange = (): void => {
    // Ticking BEFORE re-arming matters: the reader is looking at this now, and waiting a full
    // interval to refresh a tab they just returned to is the one delay they would notice.
    if (isVisible() && listeners.size > 0 && tickOnVisible(snapshot)) void tick();
    syncTimer();
  };

  // The DOM listener lives and dies with the subscription — attached by the first subscriber,
  // detached by the last. Nothing touches the document at construction time, so creating the store
  // inside a render is side-effect free, and a mount → cleanup → remount (StrictMode's rehearsal)
  // simply re-arms it.
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
    getServerSnapshot: () => initial,
    dispose: () => {
      if (listeners.size > 0) unlisten();
      listeners.clear();
      syncTimer();
    },
  };
};

const DEFAULT_POLL_INTERVAL_MS = 5000;

const always = (): boolean => true;

const isVisible = (): boolean => typeof document === "undefined" || document.visibilityState === "visible";
