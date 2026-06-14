import type { ActionError, SafeResult } from "astro:actions";

/**
 * The uniform client-side mutation result: Astro's `SafeResult` narrowed to its error
 * channel. Dialogs only branch on the error; data refreshes arrive via `navigate()`.
 */
export type ActionCallResult<TInput extends Record<string, unknown>> = {
  error: ActionError<TInput> | undefined;
};

/**
 * Call a generated Astro Action client and surface only its error channel. Slice
 * `*-client.ts` wrappers stay one-liners over this (the typed api seam per entity).
 */
export async function callAction<TInput extends Record<string, unknown>, TOutput>(
  action: (input: TInput) => Promise<SafeResult<TInput, TOutput>>,
  input: TInput,
): Promise<ActionCallResult<TInput>> {
  const { error } = await action(input);
  return { error };
}
