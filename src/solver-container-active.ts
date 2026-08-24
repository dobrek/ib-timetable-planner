/**
 * "Is the container solving?" — the one question the Durable Object asks before it lets `sleepAfter`
 * stop a running container, extracted as a pure function so the decision is testable without the DO
 * runtime.
 *
 * The container answers from `JobRegistry.__len__` alone (`GET /jobs/active`, no database touch), so
 * this reads a two-field body and nothing else. Everything unreadable — a non-2xx, non-JSON, a
 * missing or non-numeric field — is **zero**, deliberately: a container that cannot say it is
 * solving is not a container we may keep awake indefinitely, and the cost of being wrong in that
 * direction is one interrupted solve that S-304's own reclaim already recovers.
 *
 * Lives at the top level of `src/` beside `solver-container.ts` and `solver-container-env.ts` for
 * the same reason they do: deployment wiring sits outside `steiger`'s `layerSequence`, and nothing
 * under a layer may import it.
 */

/** The probe's URL. The host is ignored — `containerFetch` rewrites it onto the container's port. */
export const ACTIVE_JOBS_URL = "http://solver-container/jobs/active";

/**
 * Short on purpose. CP-SAT releases the GIL during search (measured: 56 main-thread ticks through a
 * live solve) so a busy solver genuinely answers in milliseconds; anything slower is a container in
 * trouble, and waiting on it would only delay the stop the alarm already decided on.
 */
export const ACTIVE_PROBE_TIMEOUT_MS = 5_000;

/** How many solves the body claims are in flight. Anything unreadable is 0 — see the module note. */
export const readActiveJobCount = (body: string): number => {
  const parsed = parseJson(body);
  if (typeof parsed !== "object" || parsed === null) return 0;
  const active = (parsed as { active?: unknown }).active;
  if (typeof active !== "number" || !Number.isFinite(active) || active <= 0) return 0;
  return Math.floor(active);
};

const parseJson = (body: string): unknown => {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
};
