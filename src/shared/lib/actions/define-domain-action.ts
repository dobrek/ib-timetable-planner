import { defineAction, type ActionAPIContext } from "astro:actions";
import type * as z from "zod/v4/core";
import type { SupabaseClient } from "@/shared/api";
import type { Capability } from "@/shared/config";
import { requireCapability } from "./require-capability";
import { requireSession } from "./require-session";
import { requireSupabase } from "./require-supabase";
import { runDomain } from "./run-domain";

/**
 * Define an Astro Action with the standard domain shape: session enforced, the caller's role
 * checked against `requires`, Supabase client resolved, and the run function's `DomainError`s
 * translated to `ActionError`s. Keeps slice `actions.ts` files as declarative input → run routing
 * tables.
 *
 * `requires` defaults to `edit` (S-403), so an action that forgets to declare one fails closed:
 * only the caller's own-account actions (`session`) and pure reads (`read`) declare less.
 */
export function defineDomainAction<TInputSchema extends z.$ZodType, TOutput>(options: {
  input: TInputSchema;
  run: (supabase: SupabaseClient, input: z.output<TInputSchema>) => Promise<TOutput>;
  requires?: Capability;
}) {
  const { requires = "edit" } = options;
  const handler = (input: z.output<TInputSchema>, context: ActionAPIContext): Promise<TOutput> => {
    requireSession(context);
    requireCapability(context, requires);
    const supabase = requireSupabase(context);
    return runDomain(() => options.run(supabase, input));
  };
  return defineAction<TOutput, undefined, TInputSchema>({
    input: options.input,
    handler: handler as never,
  });
}
