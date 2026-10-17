import { CHECK_VIOLATION, unwrapCompleted, type SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";
import type { UpdateDisplayNameInput } from "../model/schemas";
import { DISPLAY_NAME_REFUSED_MESSAGE } from "./constants";

/**
 * Set or clear the caller's display name.
 *
 * `user_id` is not sent: the column defaults to `auth.uid()`, and RLS refuses any other owner. No
 * `.select()`, so the upsert stays `return=minimal` and never needs its row back through the
 * SELECT policy. The CHECK is the real gate, because PostgREST can be called around the form.
 */
export const updateDisplayName = async (supabase: SupabaseClient, input: UpdateDisplayNameInput): Promise<void> => {
  const result = await supabase.from("profiles").upsert({ display_name: input.displayName }, { onConflict: "user_id" });
  if (result.error?.code === CHECK_VIOLATION)
    throw new DomainError("UNPROCESSABLE_CONTENT", DISPLAY_NAME_REFUSED_MESSAGE);
  unwrapCompleted(result, "Failed to save display name");
};
