import { useState, useSyncExternalStore } from "react";
import { readGenerationJobStatuses } from "../api/plans-client";
import { createJobProgressStore, type IndicatorsByPlan, type JobProgressFetcher } from "./job-progress-store";
import type { GenerationIndicator } from "./plan-indicators";

/**
 * Subscribe the hub to the live state of any generation job on the page.
 *
 * The store is created ONCE, lazily, via `useState`'s initializer — not in an effect, and not on
 * every render. That is what keeps the island Compiler-clean: no `setState` in an effect (React 19's
 * `set-state-in-effect` rule), and no dependency array to get wrong. There is no teardown effect
 * either: the store's timer and DOM listener live inside `subscribe`, so `useSyncExternalStore`'s
 * own unsubscribe is the whole lifecycle — and a StrictMode remount re-arms rather than kills it.
 *
 * `getServerSnapshot` returns the SSR'd indicators unchanged, so the server's markup and the client's
 * first render are the same by construction rather than by luck.
 */
export const useGenerationIndicators = (
  initial: readonly GenerationIndicator[],
  planIds: readonly string[],
  fetcher: JobProgressFetcher = readGenerationJobStatuses,
): IndicatorsByPlan => {
  const [store] = useState(() => createJobProgressStore({ initial, planIds, fetch: fetcher }));

  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
};
