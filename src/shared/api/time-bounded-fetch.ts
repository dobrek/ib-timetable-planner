/**
 * How long one Supabase request may take from the Worker before it gives up: inside Workers' 30 s
 * `waitUntil` window (where the password-reset send runs), with room left to log, and far inside a
 * cron run's 15 minutes of wall time.
 */
export const SUPABASE_REQUEST_TIMEOUT_MS = 20_000;

/**
 * A `fetch` for the Worker's own Supabase clients (the sessionless one and the machine one) that
 * gives up after `SUPABASE_REQUEST_TIMEOUT_MS`, so a stalled request fails in time to log its own line
 * rather than vanish. It calls the global rather than aliasing it: workerd refuses a `fetch` called
 * with a `this` other than the global.
 */
export function timeBoundedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const timeout = AbortSignal.timeout(SUPABASE_REQUEST_TIMEOUT_MS);
  return fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
}
