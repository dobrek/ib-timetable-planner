/**
 * Hand-written Cloudflare runtime types — the ONLY ones this repo has, and deliberately so.
 *
 * **Do not run `wrangler types`.** It was tried during S-302's spike: the generated 543 KB
 * `worker-configuration.d.ts` types the binding beautifully and then breaks an unrelated React
 * island, because its Workers globals shadow DOM lib types (`document.body.append` in
 * `ExportMenu.tsx` resolves `append` against the Workers `Body`). This file exists because it
 * declares ONLY what this project consumes and redeclares nothing the DOM lib already provides —
 * no `Request`, no `Response`, no `Headers`, no `fetch`. That is what keeps `pnpm check` at 0/0.
 *
 * Consumers: `src/worker.ts` (the Worker entry), `src/solver-container.ts` (the container's Durable
 * Object) and `src/entities/timetable/api/solver-config.ts` (the transport selector). Nothing else
 * should need Workers types; if a fourth consumer appears, ask whether it belongs at the edge.
 *
 * The models below are **minimal, not complete**. Each is trimmed to the surface we actually call,
 * and says so where the simplification is load-bearing.
 */

/**
 * Bindings and secrets on the deployed Worker.
 *
 * `SOLVER` comes from `wrangler.jsonc`'s `durable_objects.bindings`; the rest are Worker secrets set
 * out of band with `wrangler secret put`. All three secrets are optional because a Worker without
 * them still boots — `getSolverTransport()` returns `null` and Generate is simply unavailable, which
 * is a supported state (and the one `pnpm build` runs in).
 *
 * The two-name shape (`Cloudflare.Env` + `Env extends` it) mirrors what `wrangler types` emits, so
 * the day this file is replaced by generated types nothing downstream has to move. It also settles
 * a variance question for free: `@cloudflare/containers` defaults its type parameter to
 * `Cloudflare.Env`, and making the two identical means `SolverContainer` satisfies
 * `getContainer`'s `T extends Container` constraint without a cast.
 */
declare namespace Cloudflare {
  interface Env {
    /** The CP-SAT solver container, fronted by `SolverContainer`. Absent in local dev/preview
     *  builds only in the sense that starting it needs Docker — the binding object itself exists. */
    SOLVER: DurableObjectNamespace<import("./solver-container").SolverContainer>;
    SUPABASE_URL?: string;
    SUPABASE_KEY?: string;
    /** Forwarded to the container through `SolverContainer`'s `envVars`. The Worker never uses it
     *  itself — it is a courier, which is what keeps "the Worker gains no new privilege" true. */
    SOLVER_MACHINE_PASSWORD?: string;
  }
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the extends IS the declaration
interface Env extends Cloudflare.Env {}

/**
 * `ExecutionContext` is the third argument the adapter's `handle` takes. Only the two methods a
 * Worker can call on it are modelled; we call neither, but `handle`'s signature demands the type.
 */
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/**
 * The default-export shape of a Worker entry module.
 *
 * Only `fetch` is modelled, and its return type is load-bearing beyond this file: the adapter
 * derives its own `CfResponse` as `Awaited<ReturnType<Required<ExportedHandler<Env>>['fetch']>>`
 * (`@astrojs/cloudflare/dist/utils/handler.d.ts`), so declaring `fetch` to return `Response` here is
 * what makes `{ fetch: handle } satisfies ExportedHandler<Env>` typecheck in `src/worker.ts`.
 */
interface ExportedHandler<E = unknown> {
  fetch?: (request: Request, env: E, ctx: ExecutionContext) => Response | Promise<Response>;
}

interface DurableObjectId {
  toString(): string;
  readonly name?: string;
}

interface DurableObjectNamespace<T = unknown> {
  idFromName(name: string): DurableObjectId;
  newUniqueId(): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub<T>;
}

/**
 * **A deliberate simplification.** A real stub is an RPC proxy that promisifies every return type.
 * Modelling it as the class itself is faithful exactly where we use it — `startAndWaitForPorts` and
 * `containerFetch` already return promises — and it is what lets the binding transport accept a
 * plain structural fake in unit tests. The place the simplification could mislead is arguments, not
 * returns: RPC arguments must be structured-cloneable, and this type will happily accept one that is
 * not. See the `withTimeout` comment in `solver-binding-transport.ts` for the case that bites.
 */
type DurableObjectStub<T = unknown> = T;

/**
 * The Durable Object storage/lifecycle handle. `container` is the raw platform control surface that
 * `@cloudflare/containers` wraps — we never touch it directly, but its `start` options are what the
 * package derives `Container.envVars`' type from, so an inaccurate shape here would silently turn
 * that field into `any`.
 */
interface DurableObjectState {
  readonly id: DurableObjectId;
  readonly container?: {
    readonly running: boolean;
    start(options?: {
      env?: Record<string, string>;
      entrypoint?: string[];
      enableInternet?: boolean;
      labels?: Record<string, string>;
    }): void;
  };
  waitUntil(promise: Promise<unknown>): void;
  blockConcurrencyWhile<R>(callback: () => Promise<R>): Promise<R>;
}

declare module "cloudflare:workers" {
  /**
   * Module-scope bindings. This is the whole reason `getSolverTransport()` keeps its
   * `() => SolverTransport | null` signature under S-302: bindings are NOT per-request values here,
   * so no call site has to start threading a request through. They cannot travel through
   * `astro:env` either — the adapter's env bridge returns `undefined` for non-primitives.
   */
  export const env: Env;

  /** `ctx` and `env` are public rather than protected on purpose: `@cloudflare/containers` reads
   *  `DurableObject['ctx']['container']` as an indexed access to derive its own option types, which
   *  a protected member would make unresolvable. */
  export class DurableObject<E = unknown> {
    ctx: DurableObjectState;
    env: E;
    constructor(ctx: DurableObjectState, env: E);
  }

  /** Modelled only because `@cloudflare/containers` extends it for its outbound proxy. Unused here. */
  export class WorkerEntrypoint<E = unknown, P = unknown> {
    ctx: ExecutionContext;
    env: E;
    props: P;
    constructor(ctx: ExecutionContext, env: E);
  }
}
