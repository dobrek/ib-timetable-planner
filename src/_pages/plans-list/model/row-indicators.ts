import type { IndicatorsByPlan } from "./job-progress-store";
import type { GenerationIndicator } from "./plan-indicators";

/**
 * Which live indicators belong on this hub row.
 *
 * **The badge belongs on the proposal**, because that is the plan it is about (S-306) — so a row is
 * matched first against every indicator's `proposalPlanId`. The source-row match is the fallback, and
 * it exists for a hole this shape opens rather than as a preference: a job started on a plan page
 * creates a proposal row an already-open hub has never loaded, and until the author reloads, the
 * source row is the only place the badge can appear at all. Once the proposal row IS on the page it
 * wins, so the badge does not render twice.
 *
 * A `failed` job keeps the source row too, whatever the page holds: its clone has been swept, and the
 * failure belongs where the diagnostic is (FR-308).
 *
 * **The poll's snapshot is the only input, and that is the point.** There used to be a fallback to
 * the row's SSR'd `indicators` for "a plan the store has never had anything to say about" — but the
 * store is SEEDED from exactly those indicators (`PlansHub` flattens them into `initial`), so the
 * fallback could never add anything on the first paint. What it could do, once the poll started
 * evicting, was resurrect a badge the server had just confirmed gone: the store dropped the entry and
 * this function handed back the page-load copy on the very next render. Rule 4 of the store is
 * server-confirmed memory; a render path with its own private memory would quietly repeal it.
 *
 * The snapshot is keyed by SOURCE plan, so both matches scan its values — at most a few entries, once
 * per row, on a page capped at 200 plans.
 */
export const indicatorsForRow = (
  planId: string,
  live: IndicatorsByPlan,
  planIds: readonly string[],
): readonly GenerationIndicator[] => {
  const all = [...live.values()];
  const onProposal = all.filter((indicator) => indicator.proposalPlanId === planId);
  if (onProposal.length > 0) return onProposal;

  return all.filter(
    (indicator) =>
      indicator.planId === planId &&
      (indicator.status === "failed" ||
        indicator.proposalPlanId === null ||
        !planIds.includes(indicator.proposalPlanId)),
  );
};
