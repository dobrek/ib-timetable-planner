import type { Container } from "@cloudflare/containers";
import { canonicalizeSolveRequest } from "../model/generation/wire";
import { DISPATCH_TIMEOUT_MS, HEALTH_TIMEOUT_MS, SolverDispatchError, type SolverTransport } from "./solver-transport";

/**
 * The second `SolverTransport` implementation: the same port, reached through the Durable Object
 * container binding instead of a URL. This is what production uses; `createSolverTransport` stays
 * for the tier-1 local loop and the CI integration lane.
 *
 * **Pure, and it has to be.** The container arrives as a parameter, typed structurally, so this
 * module imports nothing from `cloudflare:workers` at runtime and is unit-testable in plain vitest —
 * which matters more here than usual, because the binding path is structurally unreachable from the
 * integration lane (it needs workerd) and its next proof after these tests is the deployed
 * container. The `import type` above is erased by `verbatimModuleSyntax`, so it buys real signatures
 * from the installed package at zero runtime cost.
 *
 * Not barrel-exported, for the same reason `solver-config.ts` is not: `entities/timetable`'s
 * `index.ts` is pulled into ~20 client islands.
 */
export type ContainerLike = Pick<Container, "startAndWaitForPorts" | "containerFetch">;

/** The port `services/solver/Dockerfile` binds, and `SolverContainer.defaultPort`. */
export const SOLVER_CONTAINER_PORT = 8000;

/**
 * How long the container gets to exist and start listening. Distinct from `DISPATCH_TIMEOUT_MS`,
 * which starts only once it is up: a cold start pulls and boots a ~394 MB image, and it is not the
 * solver being slow.
 *
 * 45 s is evidence-backed: the first production cold start (2026-08-18, `standard-4`, EEUR, 394 MB
 * image) took ~5.5 s from `startAndWaitForPorts` to the 202, so this leaves an 8× margin. It is
 * applied to BOTH phases of the start — getting an instance placed (`instanceGetTimeoutMS`, whose
 * library default is only 8 s) and the port coming up (`portReadyTimeoutMS`) — because a cold
 * placement after sleep or a rollout is exactly when the first phase is slow.
 */
export const CONTAINER_START_TIMEOUT_MS = 45_000;

/**
 * The container never came up. Deliberately NOT a `SolverDispatchError`: that one means the service
 * answered and refused, which is a different thing to tell an author and a different thing to fix.
 */
export class SolverContainerStartError extends Error {
  constructor(readonly cause: unknown) {
    super(`the solver container did not start within ${CONTAINER_START_TIMEOUT_MS}ms: ${messageOf(cause)}`);
    this.name = "SolverContainerStartError";
  }
}

export const createBindingSolverTransport = (container: ContainerLike): SolverTransport => ({
  async dispatchSolveJob(jobId, request) {
    await start(container);
    // Two things are deliberate here. The body goes through the canonicalizer, so the binding and
    // the URL transport send byte-identical bytes for the same solve. And there is no `signal` in
    // `init`: this call crosses Workers RPC to the Durable Object, every argument must be
    // structured-cloneable, and an `AbortSignal` is not — the URL transport's
    // `signal: AbortSignal.timeout(...)` idiom does not carry over. The budget is enforced
    // Worker-side instead, around the returned promise.
    const response = await withTimeout(
      container.containerFetch(
        `http://solver-container/jobs/${encodeURIComponent(jobId)}/solve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: canonicalizeSolveRequest(request),
        },
        SOLVER_CONTAINER_PORT,
      ),
      DISPATCH_TIMEOUT_MS,
      `the solver container did not accept the job within ${DISPATCH_TIMEOUT_MS}ms`,
    );
    // 202 is the ONLY success, exactly as over HTTP. `containerFetch` additionally answers 503/429
    // /500 of its own when it cannot get an instance, and folding those in here is right: they are
    // all "the service did not take the work", and the body carries which one.
    if (response.status !== 202) throw new SolverDispatchError(response.status, await response.text());
  },

  async checkHealth() {
    // Note: this WAKES a sleeping container (and starts one that is stopped), so it is not a free
    // probe the way an HTTP GET is — it costs a cold start and restarts the `sleepAfter` clock.
    // There is no production consumer today; keep it that way unless the cost is intended.
    try {
      const response = await withTimeout(
        container.containerFetch("http://solver-container/health", {}, SOLVER_CONTAINER_PORT),
        HEALTH_TIMEOUT_MS,
        "health probe timed out",
      );
      return response.ok;
    } catch {
      return false;
    }
  },
});

/**
 * Start the container and wait for the port, with an explicit budget.
 *
 * `containerFetch` would start it implicitly, but then a cold start and a refused dispatch would
 * both arrive as a `Response` and the author would be told the wrong story. Doing it first, and
 * mapping the throw to its own error type, is what keeps "did not come up" and "refused the job"
 * distinguishable — the split `generation-job.ts` writes into the failed row.
 */
const start = async (container: ContainerLike): Promise<void> => {
  try {
    await container.startAndWaitForPorts({
      ports: SOLVER_CONTAINER_PORT,
      cancellationOptions: {
        instanceGetTimeoutMS: CONTAINER_START_TIMEOUT_MS,
        portReadyTimeoutMS: CONTAINER_START_TIMEOUT_MS,
      },
    });
  } catch (error) {
    throw new SolverContainerStartError(error);
  }
};

/**
 * The Worker-side half of the RPC timeout story. A rejected race, not an abort: nothing here can
 * cancel the in-flight RPC, so this bounds how long WE wait, which is the property the budget is
 * actually about.
 */
const withTimeout = <T>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new SolverDispatchError(408, message));
    }, ms);
  });
  // Clear the timer once the race settles either way, so a fast answer does not leave a live
  // timer (and a later, unobserved rejection) behind in the Durable Object's I/O context.
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));
