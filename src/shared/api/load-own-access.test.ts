import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";
import { loadOwnAccess } from "./load-own-access";

type Answer = { data: unknown; error: unknown };
const noError = null;

/** A client whose role read and flag read answer as given; `flagRead` counts the flag queries. */
const client = (role: Answer, flag: Answer) => {
  const flagRead = vi.fn(() => Promise.resolve(flag));
  const supabase = {
    rpc: () => Promise.resolve(role),
    from: () => ({ select: () => ({ maybeSingle: flagRead }) }),
  } as unknown as SupabaseClient;
  return { supabase, flagRead };
};

const rejected = { code: "PGRST301", message: "JWT expired", details: "", hint: "" };

describe("loadOwnAccess", () => {
  it("reads the role alone for a caller who holds one, never the flag", async () => {
    const { supabase, flagRead } = client({ data: "author", error: noError }, { data: null, error: noError });
    await expect(loadOwnAccess(supabase)).resolves.toEqual({ role: "author", mustChangePassword: false });
    expect(flagRead).not.toHaveBeenCalled();
  });

  it("reads the flag for a caller with no role", async () => {
    const pending = client({ data: null, error: noError }, { data: { must_change_password: true }, error: noError });
    await expect(loadOwnAccess(pending.supabase)).resolves.toEqual({ role: null, mustChangePassword: true });
    expect(pending.flagRead).toHaveBeenCalledOnce();

    const roleless = client({ data: null, error: noError }, { data: { must_change_password: false }, error: noError });
    await expect(loadOwnAccess(roleless.supabase)).resolves.toEqual({ role: null, mustChangePassword: false });
  });

  it("rejects when the flag read fails, so a pending admin is never reported as role-less", async () => {
    const { supabase } = client({ data: null, error: noError }, { data: null, error: rejected });
    await expect(loadOwnAccess(supabase)).rejects.toBeInstanceOf(DomainError);
  });

  it("rejects when the role read fails, and never reads the flag", async () => {
    const { supabase, flagRead } = client({ data: null, error: rejected }, { data: null, error: noError });
    await expect(loadOwnAccess(supabase)).rejects.toBeInstanceOf(DomainError);
    expect(flagRead).not.toHaveBeenCalled();
  });
});
