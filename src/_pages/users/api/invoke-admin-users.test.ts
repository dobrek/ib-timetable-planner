import { FunctionsFetchError, FunctionsHttpError } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@/shared/api";
import { DomainError } from "@/shared/lib/errors";
import {
  CREATE_ACCOUNT_UNKNOWN,
  EMAIL_EXISTS_MESSAGE,
  INVITATION_NOT_PENDING_MESSAGE,
  INVITE_UNKNOWN,
  NOT_PENDING_MESSAGE,
  RESEND_TOO_SOON_MESSAGE,
  REVOKE_FAILURE,
} from "./constants";
import { invokeAdminUsers } from "./invoke-admin-users";

const USER_ID = "6f1c2a3e-8b4d-4e5f-9a6b-7c8d9e0f1a2b";
const PASSWORD = "Abcdefghjkmnpqrstuvwxyz2";

const invoking = (result: { data: unknown; error: unknown }) => {
  const invoke = vi.fn(() => Promise.resolve(result));
  return { supabase: { functions: { invoke } } as unknown as SupabaseClient, invoke };
};

const refusal = (status: number) => ({
  data: null,
  error: new FunctionsHttpError(new Response(JSON.stringify({ error: "echoed" }), { status })),
});

describe("invokeAdminUsers", () => {
  it("calls admin-users with the body and returns the revealed password", async () => {
    const { supabase, invoke } = invoking({ data: { userId: USER_ID, password: PASSWORD }, error: null });

    await expect(
      invokeAdminUsers(supabase, { op: "create", email: "dee@example.test", role: "viewer" }),
    ).resolves.toEqual({
      userId: USER_ID,
      password: PASSWORD,
    });
    expect(invoke).toHaveBeenCalledWith("admin-users", {
      body: { op: "create", email: "dee@example.test", role: "viewer" },
    });
  });

  it("maps a 409 on create to an email-exists conflict, with fixed wording", async () => {
    const { supabase } = invoking(refusal(409));

    const error = await invokeAdminUsers(supabase, { op: "create", email: "dee@example.test", role: null }).catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: "CONFLICT", message: EMAIL_EXISTS_MESSAGE });
  });

  it("maps a 409 on re-issue to an already-chose-their-own conflict", async () => {
    const { supabase } = invoking(refusal(409));

    await expect(invokeAdminUsers(supabase, { op: "reissue", userId: USER_ID })).rejects.toMatchObject({
      code: "CONFLICT",
      message: NOT_PENDING_MESSAGE,
    });
  });

  it("reads a function that was never reached as an unknown outcome, never as a success", async () => {
    const { supabase } = invoking({ data: null, error: new FunctionsFetchError(new TypeError("Failed to fetch")) });

    await expect(
      invokeAdminUsers(supabase, { op: "create", email: "dee@example.test", role: null }),
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: CREATE_ACCOUNT_UNKNOWN,
    });
  });

  it.each([
    ["no body", null],
    ["a body without a password", { userId: USER_ID }],
    ["a password that is not a string", { userId: USER_ID, password: 12 }],
    ["an array", [USER_ID, PASSWORD]],
  ])("refuses a 200 with %s, since an account nobody holds a password for is a failure", async (_label, data) => {
    const { supabase } = invoking({ data, error: null });

    await expect(
      invokeAdminUsers(supabase, { op: "create", email: "dee@example.test", role: null }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: CREATE_ACCOUNT_UNKNOWN });
  });

  it("returns an invite's account and whether it was a re-send", async () => {
    const { supabase, invoke } = invoking({ data: { userId: USER_ID, resent: true }, error: null });

    await expect(
      invokeAdminUsers(supabase, { op: "invite", email: "eve@example.test", role: "viewer" }),
    ).resolves.toEqual({ userId: USER_ID, resent: true });
    expect(invoke).toHaveBeenCalledWith("admin-users", {
      body: { op: "invite", email: "eve@example.test", role: "viewer" },
    });
  });

  it.each(["resend", "revoke"] as const)("returns the account a %s acted on, and nothing else", async (op) => {
    const { supabase } = invoking({ data: { userId: USER_ID, extra: "ignored" }, error: null });

    await expect(invokeAdminUsers(supabase, { op, userId: USER_ID })).resolves.toEqual({ userId: USER_ID });
  });

  it.each([
    ["no body", null],
    ["a body without resent", { userId: USER_ID }],
    ["resent that is not a boolean", { userId: USER_ID, resent: "yes" }],
  ])("refuses an invite's 200 with %s: the invitation may have been sent", async (_label, data) => {
    const { supabase } = invoking({ data, error: null });

    await expect(
      invokeAdminUsers(supabase, { op: "invite", email: "eve@example.test", role: "viewer" }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: INVITE_UNKNOWN });
  });

  it("refuses a revoke's 200 without the account, as an outcome nobody knows", async () => {
    const { supabase } = invoking({ data: {}, error: null });

    await expect(invokeAdminUsers(supabase, { op: "revoke", userId: USER_ID })).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: REVOKE_FAILURE,
    });
  });

  it("maps an invite's 409 to an existing account, and a re-send's to an invitation no longer pending", async () => {
    await expect(
      invokeAdminUsers(invoking(refusal(409)).supabase, { op: "invite", email: "eve@example.test", role: "admin" }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: EMAIL_EXISTS_MESSAGE });
    await expect(
      invokeAdminUsers(invoking(refusal(409)).supabase, { op: "resend", userId: USER_ID }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: INVITATION_NOT_PENDING_MESSAGE });
  });

  it("maps the cooldown's 429 to its own code and wording", async () => {
    await expect(
      invokeAdminUsers(invoking(refusal(429)).supabase, { op: "resend", userId: USER_ID }),
    ).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS", message: RESEND_TOO_SOON_MESSAGE });
  });

  it("never puts the function's response text in the error it throws", async () => {
    const { supabase } = invoking(refusal(500));

    const error = await invokeAdminUsers(supabase, { op: "reissue", userId: USER_ID }).catch(
      (thrown: unknown) => thrown,
    );

    expect((error as DomainError).message).not.toContain("echoed");
  });
});
