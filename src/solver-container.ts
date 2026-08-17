import { Container } from "@cloudflare/containers";
import { solverContainerEnvVars } from "./solver-container-env";

/**
 * The Durable Object that fronts the CP-SAT solver container.
 *
 * On Cloudflare a container is *always* reached through a DO class, and that class must be exported
 * from the Worker's entry module — which is why `src/worker.ts` exists at all. This file holds the
 * policy (port, sleep, secrets, logging); the entry just re-exports it.
 *
 * It lives at the top level of `src/`, outside the FSD graph, for the same reason `src/worker.ts`
 * does: `steiger`'s `layerSequence` does not inspect top-level files, and this is deployment
 * topology rather than domain code. Nothing in `app/`, `_pages/`, `widgets/`, `entities/` or
 * `shared/` may import it.
 */
export class SolverContainer extends Container<Env> {
  /** The port `services/solver/Dockerfile`'s uvicorn binds — and it binds `0.0.0.0`, not loopback,
   *  precisely so this reaches it. */
  defaultPort = 8000;

  /**
   * **A stopgap, and knowingly a crude one.** The platform default is 10 minutes of inactivity, and
   * a solve runs 12–20. Dispatch answers 202 and detaches, so during a solve there is NO request in
   * flight — from the platform's point of view the container looks idle for the entire job and the
   * default would put it to sleep mid-solve.
   *
   * 30m clears the PRD's 20-minute ceiling with margin. It is not a lifecycle: S-304 owns activity
   * renewal, SIGTERM checkpointing and widening the claim CAS so a killed solve is recoverable. The
   * cost of the stopgap is ~+$5/month of idle billing after each solve.
   */
  sleepAfter = "30m";

  /**
   * **The secrets channel, and the only one a Cloudflare container has.** There is no
   * `containers[].configuration.secrets` field — Worker secrets are read here and forwarded down.
   * The rule itself lives in `solver-container-env.ts` as a pure function, so what gets forwarded
   * (and what must not) is pinned by tests rather than by reading this class.
   */
  envVars = solverContainerEnvVars(this.env);

  /**
   * Lifecycle logging. Observability is enabled on the Worker (`wrangler.jsonc`), so these land in
   * `wrangler tail` and the dashboard — which is where S-304 and S-308 will read cold-start and
   * sleep behaviour from. Names and states only: never a value out of `envVars`.
   */
  override onStart(): void {
    // eslint-disable-next-line no-console
    console.log("[solver-container] started");
  }

  override onStop({ exitCode, reason }: { exitCode: number; reason: string }): void {
    // A non-zero exit here is the visible half of the fail-closed credential check: the service
    // refuses to start when its token is not `solver_job_writer`, and this is where that shows up.
    // eslint-disable-next-line no-console
    console.log(`[solver-container] stopped: exitCode=${exitCode} reason=${reason}`);
  }

  override onError(error: unknown): unknown {
    // eslint-disable-next-line no-console
    console.error("[solver-container] error", error);
    return error;
  }
}
