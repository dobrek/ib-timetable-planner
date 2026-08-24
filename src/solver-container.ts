import { Container, type StopParams } from "@cloudflare/containers";
import { ACTIVE_JOBS_URL, ACTIVE_PROBE_TIMEOUT_MS, readActiveJobCount } from "./solver-container-active";
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
   * **Still 30m, and now a belt over braces rather than the only guard.** `sleepAfter` measures
   * inactivity as *incoming requests*, and dispatch answers 202 and detaches — so from the
   * platform's point of view the container looks idle for the whole solve. Before S-304 that made
   * this number the entire defence, and it had to clear the PRD's 20-minute ceiling on its own.
   *
   * Since S-304 the real defence is {@link onActivityExpired}: the expiry no longer implies a stop,
   * it implies a *question*. The dividend — dropping to `10m` and restoring prompt scale-to-zero,
   * worth the ~$5/month of idle billing this stopgap costs — is deliberately withheld until the
   * production drill proves renewal on the deployed container (research D4, plan Phase 6). Lowering
   * it first would re-open the mid-solve sleep S-302 measured, with nothing yet proven under it.
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

  /**
   * **The job-aware stop path (FR-311).** The SDK calls this when `sleepAfter` has expired with no
   * incoming request; its default body is simply `this.stop()`. We ask the container whether it is
   * solving first, and decline to stop it if it is.
   *
   * **Returning without stopping IS the renewal.** The SDK calls `renewActivityTimeout()` itself the
   * moment this resolves (`container.js:1567-1570`), and the probe below renews on its own way in
   * (an in-flight request always does, `:887-890`). So there is no explicit `renewActivityTimeout()`
   * call here and adding one would be decoration — the check simply recurs at the next expiry, once
   * per `sleepAfter` for as long as the solve runs.
   *
   * **Unreachable falls through to the stop.** A container that cannot answer is not solving as far
   * as anyone can tell, and the failure mode of guessing wrong is one interrupted solve that reaches
   * `interrupted` with its last checkpoint and is delivered on the author's next visit. The failure
   * mode of the other guess is a container that can never be put to sleep.
   *
   * **A stopped container is never probed.** `containerFetch` STARTS a container that is not running
   * (`container.js:867-871`), so asking "are you solving?" on an already-stopped one would resurrect
   * the very thing the expiry exists to let go — and because the SDK re-arms a full `sleepAfter`
   * window after this returns, the pair could flap indefinitely. The SDK's own default carries the
   * same `running` guard (`container.js:750-752`), which is the evidence that this method really
   * does get called in that state; delegating to it is both the correct behaviour and the cheapest
   * way to stay in step with it.
   *
   * `alarm()` is deliberately NOT overridden — the SDK's own alarm drives this check, the schedule
   * dispatch and the `onStop` syncing (`container.js:1513-1516` carries a standing warning).
   */
  override async onActivityExpired(): Promise<void> {
    if (this.ctx.container?.running !== true) {
      await super.onActivityExpired();
      return;
    }
    const active = await this.countActiveJobs();
    if (active > 0) {
      // eslint-disable-next-line no-console
      console.log(`[solver-container] sleep declined: ${active} solve(s) in flight — activity renewed`);
      return;
    }
    // eslint-disable-next-line no-console
    console.log("[solver-container] idle at sleepAfter — letting the container stop");
    await super.onActivityExpired();
  }

  override onStop({ exitCode, reason }: StopParams): void {
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

  /** The probe, with every unreadable answer collapsed to 0 — see `solver-container-active.ts`. */
  private async countActiveJobs(): Promise<number> {
    try {
      const response = await this.containerFetch(ACTIVE_JOBS_URL, {
        signal: AbortSignal.timeout(ACTIVE_PROBE_TIMEOUT_MS),
      });
      if (!response.ok) {
        // eslint-disable-next-line no-console
        console.log(`[solver-container] active-jobs probe answered HTTP ${response.status}`);
        return 0;
      }
      return readActiveJobCount(await response.text());
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log("[solver-container] active-jobs probe failed", error);
      return 0;
    }
  }
}
