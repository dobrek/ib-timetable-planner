import { checkOpsAccess } from "./solver-container-allowlist";
import type { SolverContainerControl } from "./solver-container-ops";

/**
 * `/api/solver/container`, minus the framework (2026-09, S-308's campaign automation): an allowlisted
 * operator reads the solver container's state, or stops it when idle.
 *
 * An API route rather than an Astro Action because its consumer is the campaign runner, a non-Astro
 * client — the one case `lessons.md` reserves API routes for. The deny-by-default middleware already
 * covers the path (`/api/solver/` is not a public prefix), so an unauthenticated request never gets
 * here; this adds the allowlist on top.
 *
 * Every dependency arrives as a parameter, so the answers below are tested without workerd. The Astro
 * route is only the wiring.
 */
export type SolverContainerRouteRequest = {
  readonly method: "GET" | "POST";
  /** The request's `content-type`; a stop is accepted only as JSON. */
  readonly contentType: string | null;
  /** The parsed JSON body, or `undefined` when it did not parse. Ignored on `GET`. */
  readonly body: unknown;
};

export type SolverContainerRouteDeps = {
  readonly email: string | null | undefined;
  /** The raw `SOLVER_OPS_ALLOWED_EMAILS` secret. */
  readonly allowlist: string | undefined;
  readonly control: SolverContainerControl | null;
};

/** The one action `POST` accepts. */
export const STOP_IF_IDLE_ACTION = "stop-if-idle";

/**
 * | Request                                   | Answer                        |
 * |-------------------------------------------|-------------------------------|
 * | allowlist unset or empty                  | 404 — the route is invisible  |
 * | signed in, not on the allowlist           | 403                           |
 * | no container binding                      | 409                           |
 * | `GET`                                     | 200 with `status()`           |
 * | `POST` JSON `{ "action": "stop-if-idle" }`| 200 with `stopIfIdle()`       |
 * | `POST` anything else                      | 400 (415 when not JSON)       |
 */
export const handleSolverContainerRoute = async (
  request: SolverContainerRouteRequest,
  deps: SolverContainerRouteDeps,
): Promise<Response> => {
  const access = checkOpsAccess(deps.email, deps.allowlist);
  if (access === "closed") return json(404, { error: "not found" });
  if (access === "denied") return json(403, { error: "not an operator" });
  if (deps.control === null) return json(409, { error: "no solver container binding on this Worker" });

  if (request.method === "GET") return json(200, await deps.control.status());

  if (!isJson(request.contentType)) return json(415, { error: "send the action as application/json" });
  if (!isStopIfIdle(request.body)) {
    return json(400, { error: `the only action is { "action": "${STOP_IF_IDLE_ACTION}" }` });
  }
  return json(200, await deps.control.stopIfIdle());
};

const isJson = (contentType: string | null): boolean =>
  (contentType ?? "").split(";")[0]?.trim().toLowerCase() === "application/json";

const isStopIfIdle = (body: unknown): boolean =>
  typeof body === "object" && body !== null && (body as { action?: unknown }).action === STOP_IF_IDLE_ACTION;

/** No caching anywhere: every answer is the container's state at this instant, or a refusal. */
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
