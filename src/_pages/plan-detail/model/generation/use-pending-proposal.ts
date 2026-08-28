import { useState, useSyncExternalStore } from "react";
import { isActiveJobStatus } from "@/entities/timetable";
import { checkPlan as checkPlanAction } from "../../api/generation-client";
import type { GenerationJobView } from "../../api/generation-delivery";

/**
 * The pending proposal page's own poll — the one place in `plan-detail` that loops, and the one
 * place that is allowed to.
 *
 * **Why the FR-312 argument does not forbid it here.** S-303 kept live progress off the plan page and
 * put it on the hub, on a structural rather than a measured argument: `/plans` has no board, so a
 * poll can never contend with dragging there. A *pending* proposal has no board either — it renders
 * this progress panel and nothing else, and `loadCombinedPlannerData` is not even called for it. So
 * the same structural argument permits the loop, rather than an exception being carved for it.
 *
 * **And delivery from this page is delivery TO this page.** The other half of S-303's separation was
 * that the hub must never deliver: running verify → translate → apply on a timer, from a page the
 * author is not looking at, races every other tab. Here the author IS looking at the one plan the
 * delivery lands on, and the page's whole content is that job. So this ticker calls `checkPlan` —
 * the delivering read — rather than the hub's status-only one, and on the tick that delivers it
 * navigates so the board renders through the normal SSR path. No client-side board bootstrap.
 *
 * **Shape copied from `plans-list/model/job-progress-store.ts`, for the reason recorded there.**
 * React 19's `react-hooks/set-state-in-effect` rule rules out fetch-in-an-effect-then-setState, and
 * the React Compiler memoizes this island like every other. So the mutable thing lives outside React
 * and `useSyncExternalStore` subscribes to it; nothing here calls `setState`. This store is smaller
 * than the hub's because the problem is: one job, one plan, no discovery, no terminal memory.
 *
 * Three rules govern when it reads:
 *
 *   1. **Only while the job is active.** A terminal job stops the timer — the page is either about to
 *      navigate (delivered) or showing a final state (failed, swept).
 *   2. **Only while subscribed and visible.** A backgrounded tab is silent; returning to it ticks
 *      immediately, because a five-second wait on a page the author just came back to is the one
 *      delay they would notice.
 *   3. **A failed read keeps the last snapshot** and lets the next tick retry. The page is an
 *      advisory; a red banner every time Wi-Fi blinks would be worse than a stale stage number.
 */
export type PendingProposalStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => GenerationJobView | null;
  getServerSnapshot: () => GenerationJobView | null;
  /** Unsubscribe everyone, stopping the timer and dropping the visibility listener. Re-armable. */
  dispose: () => void;
};

export type PendingProposalStoreOptions = {
  planId: string;
  /** The SSR'd view. Also the server snapshot, so hydration is deterministic by construction. */
  initial: GenerationJobView | null;
  check?: (planId: string) => Promise<GenerationJobView | null>;
  /** Called once, on the first tick that reports a delivered board. Defaults to a same-URL reload. */
  onDelivered?: () => void;
  intervalMs?: number;
};

export const PENDING_POLL_INTERVAL_MS = 5000;

export const createPendingProposalStore = (options: PendingProposalStoreOptions): PendingProposalStore => {
  const {
    planId,
    initial,
    check = checkPlanAction,
    onDelivered = reloadIntoBoard,
    intervalMs = PENDING_POLL_INTERVAL_MS,
  } = options;

  let snapshot = initial;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight = false;
  // Once, and only once. The navigation is asynchronous, so a second tick could otherwise land while
  // the browser is still tearing the page down and fire it again.
  let announced = false;
  const listeners = new Set<() => void>();

  const publish = (next: GenerationJobView | null): void => {
    if (sameView(snapshot, next)) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const tick = async (): Promise<void> => {
    // One request at a time: a tick that outlives the interval must not stack up identical
    // deliveries that then all land at once.
    if (inFlight || listeners.size === 0) return;
    inFlight = true;
    try {
      const view = await check(planId);
      if (listeners.size > 0) publish(view);
      if (view?.delivered === true && !announced) {
        announced = true;
        onDelivered();
      }
    } catch {
      // Keep the last snapshot; the next tick retries. See rule 3.
    } finally {
      inFlight = false;
      syncTimer();
    }
  };

  const shouldRun = (): boolean =>
    listeners.size > 0 && isVisible() && !announced && snapshot !== null && isActiveJobStatus(snapshot.status);

  const syncTimer = (): void => {
    if (shouldRun() && timer === null) {
      timer = setInterval(() => void tick(), intervalMs);
    } else if (!shouldRun() && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const onVisibilityChange = (): void => {
    if (isVisible() && listeners.size > 0 && !announced) void tick();
    syncTimer();
  };

  // The DOM listener lives and dies with the subscription, so constructing the store inside a render
  // is side-effect free and a StrictMode mount → cleanup → remount simply re-arms it.
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

/**
 * Subscribe the pending page to its own job.
 *
 * The store is created ONCE via `useState`'s initializer — not in an effect and not per render —
 * which is what keeps the island Compiler-clean and leaves `useSyncExternalStore`'s unsubscribe as
 * the whole lifecycle. Same construction as `useGenerationIndicators` on the hub.
 */
export const usePendingProposal = (
  planId: string,
  initial: GenerationJobView | null,
  options: Omit<PendingProposalStoreOptions, "planId" | "initial"> = {},
): GenerationJobView | null => {
  const [store] = useState(() => createPendingProposalStore({ planId, initial, ...options }));

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
};

/**
 * Re-request the same URL so the board renders through the normal SSR path.
 *
 * `assign(href)` rather than `reload()`: a reload re-submits whatever produced the current document,
 * while this is unambiguously a fresh GET of the same address — which is the request the route now
 * answers with a board instead of a progress panel.
 */
const reloadIntoBoard = (): void => {
  if (typeof window !== "undefined") window.location.assign(window.location.href);
};

/** Field-by-field: the action returns a fresh object every tick, and identity is the contract
 *  `useSyncExternalStore` enforces — a new object each time would re-render the island forever. */
const sameView = (a: GenerationJobView | null, b: GenerationJobView | null): boolean => {
  if (a === null || b === null) return a === b;
  return (
    a.jobId === b.jobId &&
    a.status === b.status &&
    a.delivered === b.delivered &&
    a.stageIndex === b.stageIndex &&
    a.stageName === b.stageName &&
    a.error === b.error &&
    a.proposalPlanId === b.proposalPlanId
  );
};

const isVisible = (): boolean => typeof document === "undefined" || document.visibilityState === "visible";
