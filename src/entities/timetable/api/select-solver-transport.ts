import type { SolverTransport } from "./solver-transport";

/**
 * Which transport a given environment gets — the whole of S-302's dispatch decision, as a pure
 * function so the precedence can be tested without workerd, a binding, or `astro:env`.
 *
 * `solver-config.ts` supplies the two factories and the two environment values; this file knows
 * nothing about where either came from.
 */
export type TransportSources<TBinding> = {
  /** `SOLVER_URL` from `astro:env/server` — set locally, deliberately absent in production. */
  readonly url: string | undefined;
  /** `env.SOLVER` from `cloudflare:workers` — present on the deployed Worker. */
  readonly binding: TBinding | undefined;
  readonly fromUrl: (url: string) => SolverTransport;
  readonly fromBinding: (binding: TBinding) => SolverTransport;
};

/**
 * **An explicit `SOLVER_URL` wins over the binding**, and that order is load-bearing rather than
 * arbitrary. It is what keeps the author's `build && preview` loop — and the hosted-solve campaign —
 * pointed at a native solver on the developer's machine. If the binding won, every local test of
 * Generate would require a Docker daemon and a container start, which is the opposite of the cheap
 * fast loop those modes exist to provide.
 *
 * `null` when neither is configured: "no solver here" is a supported state, rendered by the UI, not
 * a boot failure — which is why `pnpm build` and the e2e lane work with nothing configured at all.
 *
 * One sharp edge worth knowing: in a local `preview` the binding OBJECT exists even with
 * `dev.enable_containers: false`, so with `SOLVER_URL` unset this returns a binding transport that
 * would fail at container start rather than returning `null`. That is why `pnpm env:prod` (the
 * read-only smoke) must not be used to exercise Generate.
 */
export const selectSolverTransport = <TBinding>({
  url,
  binding,
  fromUrl,
  fromBinding,
}: TransportSources<TBinding>): SolverTransport | null => {
  if (url) return fromUrl(url);
  if (binding) return fromBinding(binding);
  return null;
};
