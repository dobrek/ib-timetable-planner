import type { APIRoute } from "astro";
import { getSolverContainerControl, getSolverOpsAllowlist } from "@/entities/timetable/api/solver-container-control";
import { handleSolverContainerRoute, type SolverContainerRouteDeps } from "@/solver-container-route";

/**
 * The operator's control surface for the solver container — wiring only; every decision is in
 * `src/solver-container-route.ts`. Behind the deny-by-default middleware plus an explicit allowlist
 * (`SOLVER_OPS_ALLOWED_EMAILS`), and invisible when that allowlist is unset.
 */
export const GET: APIRoute = (context) =>
  handleSolverContainerRoute({ method: "GET", contentType: null, body: undefined }, deps(context.locals.user));

export const POST: APIRoute = async (context) =>
  handleSolverContainerRoute(
    {
      method: "POST",
      contentType: context.request.headers.get("content-type"),
      body: await context.request.json().catch(() => undefined),
    },
    deps(context.locals.user),
  );

const deps = (user: App.Locals["user"]): SolverContainerRouteDeps => ({
  email: user?.email,
  allowlist: getSolverOpsAllowlist(),
  control: getSolverContainerControl(),
});
