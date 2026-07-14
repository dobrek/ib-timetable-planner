/**
 * The comparison selection, carried in the URL: `/plans/compare?plans=<id>,<id>[,<id>…]`.
 *
 * **No baseline.** The measurements do not need one: `analyzePlan` has zero pairwise coupling, so every
 * number in the scoreboard is a property of one plan alone. Only a *delta* would need a reference —
 * and a delta needs a direction, not a privileged plan. The comparison reports; it never judges, so it
 * renders the columns side by side and lets the expert read them. The order in the URL is simply the
 * order the plans appear in the hub.
 *
 * Lives in `lib/` rather than `model/` because an **Astro route** imports it — the same reason
 * `board-surface.ts` lives in `plan-detail/lib/`. It is read server-side from `Astro.url.searchParams`,
 * before the loader runs, because the selection *selects the SSR dataset*.
 *
 * Keeping the selection in the URL is what makes a comparison shareable and bookmarkable, and lets the
 * browser own history. It is also the single source of truth for what is on screen: the page has no
 * picker of its own, so no client control can drift out of step with the numbers it claims to select.
 */
export type CompareParams = {
  planIds: string[];
};

/**
 * Parse the query string. Malformed ids are **dropped, not rejected** — a stale or hand-edited link is
 * the ordinary case for a URL designed to be shared, and a garbage id should cost the reader the plans
 * it names, not the whole page. Duplicates collapse: a plan compared with itself is a no-op column.
 */
export const readCompareParams = (search: string): CompareParams => {
  const params = new URLSearchParams(search);
  return { planIds: [...new Set((params.get("plans") ?? "").split(",").filter(isPlanId))] };
};

/**
 * The plan-id guard, inlined rather than imported from `@/shared/api`.
 *
 * That barrel exports `createClient`, which reads `astro:env/server`, so importing it drags a
 * server-only module into anything that touches this codec. Nothing here needs a Supabase client to
 * decide whether a string looks like a plan id. The regex is the same one `isUuid` uses; keep them in
 * step if it ever changes.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isPlanId = (id: string): boolean => UUID_RE.test(id);
