import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canonicalizeSolveRequest, type SolveRequest } from "../model/generation/wire";
import {
  CONTAINER_START_TIMEOUT_MS,
  createBindingSolverTransport,
  SOLVER_CONTAINER_PORT,
  SolverContainerStartError,
  type ContainerLike,
} from "./solver-binding-transport";
import { DISPATCH_TIMEOUT_MS, SolverDispatchError } from "./solver-transport";

const JOB_ID = "3f1a8c22-0b7e-4c8e-9a1d-2f6b5e4d3c21";

/** An empty two-cohort snapshot — the narrowest thing the canonicalizer accepts. This suite tests
 *  the transport, not the engine, so the body only has to be real enough to canonicalize. */
const request = (): SolveRequest => ({
  formatVersion: 1,
  snapshot: {
    days: 1,
    periods: 1,
    availability: [],
    finishesEarlyByCourseId: [],
    cohorts: {
      dp1: { courses: [], pins: [], parkedCourseIds: [] },
      dp2: { courses: [], pins: [], parkedCourseIds: [] },
    },
  },
});

type Call = { url: string; init: RequestInit | undefined; port: number | undefined };

/** Models a container that accepts the connection and then goes quiet — the case the Worker-side
 *  budget exists for, and the one an unbounded call would hang on until the invocation limit. */
const neverSettles = <T>(): Promise<T> => new Promise<T>(() => undefined);

/**
 * A structural stand-in for the Durable Object stub. This is the payoff of typing the transport's
 * parameter as `Pick<Container, …>`: the binding path is exercisable in plain vitest, which matters
 * because it is structurally unreachable from the integration lane (that needs workerd) and its next
 * proof after this file is the deployed container.
 */
const fakeContainer = (
  overrides: {
    start?: () => Promise<void>;
    respond?: (call: Call) => Promise<Response> | Response;
  } = {},
) => {
  const order: string[] = [];
  const calls: Call[] = [];
  const startArgs: unknown[] = [];
  const container: ContainerLike = {
    startAndWaitForPorts: async (...args: unknown[]) => {
      order.push("start");
      startArgs.push(args[0]);
      await (overrides.start?.() ?? Promise.resolve());
    },
    containerFetch: async (url: unknown, init: unknown, port: unknown) => {
      order.push("fetch");
      const call = { url: String(url), init: init as RequestInit | undefined, port: port as number | undefined };
      calls.push(call);
      return (await overrides.respond?.(call)) ?? new Response("", { status: 202 });
    },
  };
  return { container, order, startArgs, fetches: () => calls };
};

describe("createBindingSolverTransport", () => {
  describe("dispatchSolveJob", () => {
    it("starts the container and waits for the port BEFORE posting", async () => {
      // `containerFetch` would start it implicitly, but then a cold start and a refused dispatch
      // would both arrive as a Response and the author would be told the wrong story.
      const fake = fakeContainer();

      await createBindingSolverTransport(fake.container).dispatchSolveJob(JOB_ID, request());

      expect(fake.order).toEqual(["start", "fetch"]);
    });

    it("waits on the solver port with an explicit start budget", async () => {
      const fake = fakeContainer();

      await createBindingSolverTransport(fake.container).dispatchSolveJob(JOB_ID, request());

      expect(fake.startArgs[0]).toEqual({
        ports: SOLVER_CONTAINER_PORT,
        cancellationOptions: { portReadyTimeoutMS: CONTAINER_START_TIMEOUT_MS },
      });
    });

    it("posts the canonicalized request to the job's solve path on the solver port", async () => {
      const fake = fakeContainer();
      const solve = request();

      await createBindingSolverTransport(fake.container).dispatchSolveJob(JOB_ID, solve);

      const [post] = fake.fetches();
      expect(post.url).toBe(`http://solver-container/jobs/${JOB_ID}/solve`);
      expect(post.port).toBe(SOLVER_CONTAINER_PORT);
      expect(post.init?.method).toBe("POST");
      expect(post.init?.headers).toEqual({ "Content-Type": "application/json" });
      // Byte-identical to what the URL transport would send: two callers who assembled the same
      // solve in a different order must not produce different bodies.
      expect(post.init?.body).toBe(canonicalizeSolveRequest(solve));
    });

    it("never puts an AbortSignal in the RPC arguments", async () => {
      // The reason `withTimeout` exists at all. `containerFetch` on a Durable Object stub crosses
      // Workers RPC, every argument must be structured-cloneable, and an AbortSignal is not — so
      // the URL transport's `signal: AbortSignal.timeout(...)` idiom cannot carry over. If this
      // ever regresses, the failure in production is an RPC throw before the container is reached.
      const fake = fakeContainer();

      await createBindingSolverTransport(fake.container).dispatchSolveJob(JOB_ID, request());

      expect(fake.fetches()[0]?.init).not.toHaveProperty("signal");
    });

    it("percent-encodes the job id into the path", async () => {
      const fake = fakeContainer();

      await createBindingSolverTransport(fake.container).dispatchSolveJob("a/../b", request());

      expect(fake.fetches()[0]?.url).toBe("http://solver-container/jobs/a%2F..%2Fb/solve");
    });

    it("accepts 202 and nothing else", async () => {
      const fake = fakeContainer({ respond: () => new Response("created", { status: 201 }) });

      // A 2xx that is not 202 means the service answered something this client does not understand;
      // treating it as accepted would lose the job silently.
      await expect(
        createBindingSolverTransport(fake.container).dispatchSolveJob(JOB_ID, request()),
      ).rejects.toBeInstanceOf(SolverDispatchError);
    });

    it("reports a refusal as a dispatch error carrying the status and body", async () => {
      const fake = fakeContainer({ respond: () => new Response("already running 1 job(s)", { status: 503 }) });

      await expect(createBindingSolverTransport(fake.container).dispatchSolveJob(JOB_ID, request())).rejects.toThrow(
        /HTTP 503.*already running/s,
      );
    });

    it("distinguishes a container that never came up from a job the service refused", async () => {
      // The split `generation-job.ts` writes into the failed row. "Docker/the platform could not
      // give us an instance" and "the solver said no" need different fixes.
      const fake = fakeContainer({ start: () => Promise.reject(new Error("no instance available")) });

      const dispatch = createBindingSolverTransport(fake.container).dispatchSolveJob(JOB_ID, request());

      await expect(dispatch).rejects.toBeInstanceOf(SolverContainerStartError);
      await expect(dispatch).rejects.not.toBeInstanceOf(SolverDispatchError);
      await expect(dispatch).rejects.toThrow(/did not start.*no instance available/s);
      expect(fake.fetches()).toHaveLength(0);
    });
  });

  describe("the Worker-side dispatch budget", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("gives up as a dispatch failure when the container never answers", async () => {
      // A container that accepts the connection and never replies is a different failure from an
      // unreachable one, and only the second settles on its own.
      const fake = fakeContainer({ respond: () => neverSettles<Response>() });

      const dispatch = createBindingSolverTransport(fake.container).dispatchSolveJob(JOB_ID, request());
      const assertion = expect(dispatch).rejects.toBeInstanceOf(SolverDispatchError);
      await vi.advanceTimersByTimeAsync(DISPATCH_TIMEOUT_MS);

      await assertion;
    });

    it("does not fire the budget on a prompt answer", async () => {
      const fake = fakeContainer();

      const dispatch = createBindingSolverTransport(fake.container).dispatchSolveJob(JOB_ID, request());
      await vi.advanceTimersByTimeAsync(0);

      await expect(dispatch).resolves.toBeUndefined();
    });
  });

  describe("checkHealth", () => {
    it("is true when the container answers ok", async () => {
      const fake = fakeContainer({ respond: () => new Response("ok", { status: 200 }) });

      await expect(createBindingSolverTransport(fake.container).checkHealth()).resolves.toBe(true);
    });

    it("is false — never a throw — when the container is unreachable", async () => {
      // "Unreachable solver" is a state to render, not an exception to handle at every call site.
      const fake = fakeContainer({ respond: () => Promise.reject(new Error("boom")) });

      await expect(createBindingSolverTransport(fake.container).checkHealth()).resolves.toBe(false);
    });

    it("is false on a non-ok status", async () => {
      const fake = fakeContainer({ respond: () => new Response("nope", { status: 500 }) });

      await expect(createBindingSolverTransport(fake.container).checkHealth()).resolves.toBe(false);
    });

    it("probes /health without starting the container itself", async () => {
      // It reaches the container through `containerFetch`, which wakes it — noted in the source as
      // a cost, and the reason there is no production consumer.
      const fake = fakeContainer();

      await createBindingSolverTransport(fake.container).checkHealth();

      expect(fake.order).toEqual(["fetch"]);
      expect(fake.fetches()[0]?.url).toBe("http://solver-container/health");
    });
  });
});
