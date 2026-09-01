import { createPollingStore, type PollingStore } from "@/shared/lib/polling-store";
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
 * **The lifecycle itself is `@/shared/lib/polling-store`.** The timer, the single in-flight read, the
 * visibility listener and the equality-gated publish are shared with the pending proposal page's
 * ticker — the same ~55 lines, grown twice. What stays here is the part that is about generation
 * badges, which is the four options below plus the rules they encode.
 *
 * Five rules govern when it reads, and each exists for a reason worth stating:
 *
 *   1. **Only while something is active.** An idle hub — the overwhelming common case — issues no
 *      requests at all. When the last active job goes terminal the timer stops itself. (`isActive`.)
 *   2. **Only while subscribed.** No subscriber means no visible hub, so nothing to update.
 *   3. **Only while the tab is visible.** A backgrounded tab left open overnight would otherwise
 *      poll ~12 times a minute forever. Returning to it ticks IMMEDIATELY, so the badge is fresh by
 *      the time the author has finished looking at it.
 *   4. **Terminal indicators are remembered — for exactly as long as their row still exists.** A job
 *      that finishes stays in the snapshot rather than vanishing, because a badge that disappears the
 *      instant a solve ends reads as a failure. Since S-306 that memory is a ROW state rather than
 *      RAM: the SSR loader and the discovery read both return terminal-undelivered and
 *      delivered-but-unannounced rows, so a reload no longer erases a ready proposal — it stays
 *      badged until the author opens it once, which is what stamps `notified_at`. The poll is held to
 *      the same standard: it re-reads EVERY remembered job, terminal ones included, and the answer
 *      REPLACES the snapshot. So memory is server-confirmed — a badge survives because its row still
 *      exists and the refresh re-read it, and a row the server no longer returns (cascaded away with
 *      a deleted source, or dropped at the mapping edge as delivered-then-deleted) takes its badge
 *      with it on the next tick rather than freezing on screen forever. `PlansHub` renders strictly
 *      from this snapshot for the same reason — see `row-indicators.ts`.
 *   5. **Becoming visible always DISCOVERS, even when nothing is active.** Rule 1 alone would leave
 *      the realistic two-tab flow broken: a hub tab open while Generate was pressed on a plan page
 *      knows no job id, has nothing active, and so would never start a timer — showing nothing at all
 *      until a reload. So a tab returning to the foreground makes one read keyed by the page's PLAN
 *      ids. One request per tab-focus; rule 1 still holds for the 5-second timer. This is the
 *      factory's UNGATED default for `tickOnVisible`, which is why no override is passed.
 *
 * A failed fetch keeps the last snapshot and lets the next tick retry. There is no error state in
 * the UI: the badge is an advisory, and a red cell every time a laptop's Wi-Fi blinks would be worse
 * than a label that is five seconds stale.
 */
export type JobProgressStore = PollingStore<IndicatorsByPlan>;

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

  return createPollingStore<IndicatorsByPlan>({
    initial: indexByPlan(initial),
    isEqual: sameIndicators,
    read: (current) => refresh(current, planIds, fetch),
    isActive: (snapshot) => [...snapshot.values()].some(isActiveIndicator),
    intervalMs,
  });
};

/**
 * One tick's question, and the whole of rule 4's answer.
 *
 * It asks about EVERY remembered job, not just the active ones: a terminal entry that is never
 * queried can never be missing from an answer, and absence from the answer is the only evidence this
 * store has that a row is gone. `refreshKnown` is unfiltered by status, so a row that still exists
 * always comes back — which is what makes returning the response as the WHOLE next snapshot safe for
 * terminal memory, and makes eviction fall out of it for free.
 */
const refresh = async (
  current: IndicatorsByPlan,
  planIds: readonly string[],
  fetch: JobProgressFetcher,
): Promise<IndicatorsByPlan> => {
  // Nothing to ask about: no plans to discover through and nothing remembered to re-confirm.
  if (planIds.length === 0 && current.size === 0) return current;
  return indexByPlan(await fetch({ jobIds: rememberedJobIds(current), planIds: [...planIds] }));
};

const indexByPlan = (indicators: readonly GenerationIndicator[]): IndicatorsByPlan =>
  new Map(indicators.map((indicator) => [indicator.planId, indicator]));

const rememberedJobIds = (snapshot: IndicatorsByPlan): string[] =>
  [...snapshot.values()].map((indicator) => indicator.jobId);

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
