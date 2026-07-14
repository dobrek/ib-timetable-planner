/**
 * The comparison selection, carried in the URL: `/plans/compare?plans=<id>,<id>&baseline=<id>`.
 *
 * Lives in `lib/` rather than `model/` because an **Astro route** imports it — the same reason
 * `board-surface.ts` lives in `plan-detail/lib/`. It is read server-side from `Astro.url.searchParams`,
 * before the loader runs, because the selection *selects the SSR dataset*: this is the
 * `plans/[id]/index.astro` precedent, not the client-side `useUrlSyncedFilters` one.
 *
 * Keeping the selection in the URL is what makes a comparison shareable and bookmarkable, and lets the
 * browser own history — the same stance the read-only plan views take.
 */
export type CompareParams = {
  planIds: string[];
  /** The reference every delta is measured against. Defaults to the first picked plan. */
  baselineId: string | null;
};

/**
 * The plan-id guard, inlined rather than imported from `@/shared/api`.
 *
 * That barrel exports `createClient`, which reads `astro:env/server` — a **server-only module**. This
 * codec is imported by `PlanPicker`, a `client:load` island, so pulling the barrel in fails the build
 * outright (Astro's server-only-module error). The regex is the same one `isUuid` uses; keep them in
 * step if it ever changes.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isPlanId = (id: string): boolean => UUID_RE.test(id);

/**
 * Parse the query string. Malformed ids are **dropped, not rejected** — a stale or hand-edited link is
 * the ordinary case for a URL designed to be shared, and a garbage id should cost the reader the plans
 * it names, not the whole page. Duplicates collapse: comparing a plan with itself is a no-op column.
 */
export const readCompareParams = (search: string): CompareParams => {
  const params = new URLSearchParams(search);
  const planIds = [...new Set((params.get("plans") ?? "").split(",").filter(isPlanId))];
  const requested = params.get("baseline");

  return {
    planIds,
    // A baseline naming a plan we aren't comparing is meaningless; fall back to the first picked plan.
    baselineId: requested !== null && planIds.includes(requested) ? requested : (planIds[0] ?? null),
  };
};

/** Serialize back to a query string, omitting defaults so a clean state yields a clean URL. */
export const toCompareSearch = (state: CompareParams): string => {
  const params = new URLSearchParams();
  if (state.planIds.length > 0) params.set("plans", state.planIds.join(","));
  // The first plan is the default baseline, so naming it explicitly would be noise in the URL.
  if (state.baselineId !== null && state.baselineId !== state.planIds[0]) params.set("baseline", state.baselineId);
  return params.toString();
};
