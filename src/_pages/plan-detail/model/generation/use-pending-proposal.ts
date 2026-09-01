import { useState, useSyncExternalStore } from "react";
import { isActiveJobStatus, type CleanLabel } from "@/entities/timetable";
import { createPollingStore, DEFAULT_POLL_INTERVAL_MS, type PollingStore } from "@/shared/lib/polling-store";
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
 * **Lifecycle shared with `plans-list/model/job-progress-store.ts`, in
 * `@/shared/lib/polling-store`.** React 19's `react-hooks/set-state-in-effect` rule rules out
 * fetch-in-an-effect-then-setState, and the React Compiler memoizes this island like every other. So
 * the mutable thing lives outside React and `useSyncExternalStore` subscribes to it; nothing here
 * calls `setState`. The timer, the single in-flight read, the visibility listener and the
 * equality-gated publish are the factory's; what stays here is the part that is about ONE job on one
 * plan — no discovery, no terminal memory, and a delivery that navigates.
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
export type PendingProposalStore = PollingStore<GenerationJobView | null>;

export type PendingProposalStoreOptions = {
  planId: string;
  /** The SSR'd view. Also the server snapshot, so hydration is deterministic by construction. */
  initial: GenerationJobView | null;
  check?: (planId: string) => Promise<GenerationJobView | null>;
  /** Called once, on the first tick that reports a delivered board. Defaults to a same-URL reload. */
  onDelivered?: () => void;
  intervalMs?: number;
};

export const PENDING_POLL_INTERVAL_MS = DEFAULT_POLL_INTERVAL_MS;

export const createPendingProposalStore = (options: PendingProposalStoreOptions): PendingProposalStore => {
  const {
    planId,
    initial,
    check = checkPlanAction,
    onDelivered = reloadIntoBoard,
    intervalMs = PENDING_POLL_INTERVAL_MS,
  } = options;

  // Once, and only once. The navigation is asynchronous, so a second tick could otherwise land while
  // the browser is still tearing the page down and fire it again. It is a closure rather than an
  // option because it is this page's policy, not the lifecycle's — the factory has no idea what
  // "announced" means, and gains nothing from learning.
  let announced = false;

  return createPollingStore<GenerationJobView | null>({
    initial,
    isEqual: sameView,
    read: () => check(planId),
    isActive: (snapshot) => !announced && snapshot !== null && isActiveJobStatus(snapshot.status),
    // AFTER the publish and outside the listeners guard, both deliberately: the delivery already
    // happened server-side inside `check`, so a subscriber leaving mid-flight is a reason to publish
    // nothing and never a reason to skip the navigation. See the factory's `afterTick` contract.
    afterTick: (next) => {
      if (next?.delivered !== true || announced) return;
      announced = true;
      onDelivered();
    },
    tickOnVisible: () => !announced,
    intervalMs,
  });
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
 *  `useSyncExternalStore` enforces — a new object each time would re-render the island forever.
 *
 *  **Every field the page renders must be named here, in the same commit that adds it.** A field the
 *  projection carries but this gate ignores changes silently: the store sees "same view", publishes
 *  nothing, and the UI that depends on it never updates. `stopRequestedAt` is exactly such a field —
 *  it is what flips the button to "Stopping…" while status, stage and error all stay put. */
const sameView = (a: GenerationJobView | null, b: GenerationJobView | null): boolean => {
  if (a === null || b === null) return a === b;
  return (
    a.jobId === b.jobId &&
    a.status === b.status &&
    a.delivered === b.delivered &&
    a.stageIndex === b.stageIndex &&
    a.stageName === b.stageName &&
    a.error === b.error &&
    a.proposalPlanId === b.proposalPlanId &&
    a.finishedAt === b.finishedAt &&
    a.checkpointStageIndex === b.checkpointStageIndex &&
    a.stopRequestedAt === b.stopRequestedAt &&
    sameCleanLabel(a.cleanLabel, b.cleanLabel)
  );
};

/** Structural, because `deriveCleanLabel` builds a fresh object every tick — `===` would never hold. */
const sameCleanLabel = (a: CleanLabel, b: CleanLabel): boolean => {
  if (a.kind !== b.kind) return false;
  if (a.kind === "clean-at-floor" && b.kind === "clean-at-floor") return a.pinnedHours === b.pinnedHours;
  if (a.kind === "not-clean" && b.kind === "not-clean") return a.softHits === b.softHits && a.floor === b.floor;
  return true;
};
