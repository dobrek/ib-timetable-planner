import type { SafeResult } from "astro:actions";

/**
 * Throw-on-error transport for the optimistic hot path (placement + shelf clients). Unwraps the
 * Astro Action `SafeResult`, throwing on the error channel and returning `data` — the optimistic
 * reconcile needs `data`, which the shared `{ error }` `callAction` (`@/shared/lib/forms`) discards.
 * So this variant stays **throw-by-design** (`ui-conventions.md` §"Astro action clients"), mirroring
 * that helper's `(action, input)` shape. Type-only astro import, so it stays safe under Vitest.
 *
 * Collapses the ~8 near-identical `const { data, error } = await actions.X(args); if (error) throw …;
 * return data` blocks the clients used to repeat into one wrapper.
 */
export async function callActionData<TInput extends Record<string, unknown>, TOutput>(
  action: (input: TInput) => Promise<SafeResult<TInput, TOutput>>,
  input: TInput,
): Promise<TOutput> {
  const { data, error } = await action(input);
  if (error) throw new Error(error.message);
  return data;
}
