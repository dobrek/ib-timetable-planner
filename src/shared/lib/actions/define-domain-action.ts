import { defineAction, type ActionAPIContext } from "astro:actions";
import type * as z from "zod/v4/core";
import type { SupabaseClient } from "@/shared/api";
import { requireSession } from "./require-session";
import { requireSupabase } from "./require-supabase";
import { runDomain } from "./run-domain";

/**
 * Define an Astro Action with the standard domain shape: session enforced, Supabase
 * client resolved, and the run function's `DomainError`s translated to `ActionError`s.
 * Keeps slice `actions.ts` files as declarative input → run routing tables.
 */
export function defineDomainAction<TInputSchema extends z.$ZodType, TOutput>(options: {
  input: TInputSchema;
  run: (supabase: SupabaseClient, input: z.output<TInputSchema>) => Promise<TOutput>;
}) {
  const handler = (input: z.output<TInputSchema>, context: ActionAPIContext): Promise<TOutput> => {
    requireSession(context);
    const supabase = requireSupabase(context);
    return runDomain(() => options.run(supabase, input));
  };
  return defineAction<TOutput, undefined, TInputSchema>({
    input: options.input,
    handler: handler as never,
  });
}
