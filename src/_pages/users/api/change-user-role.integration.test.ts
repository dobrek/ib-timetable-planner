import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, SupabaseClient } from "@/shared/api";
import type { AppRole } from "@/shared/config";
import { FORBIDDEN_MESSAGE } from "@/shared/lib/errors";
import { createAuthUser, createSignedInUser, teardown, type SignedInUser } from "@/test/factories";
import { changeUserRole } from "./change-user-role";
import { NO_ROLE_TO_REMOVE_MESSAGE } from "./constants";

/**
 * The Users page's write (S-406), run as the action runs it: the domain function on a client signed
 * in with the publishable key, so RLS and the triggers judge it exactly as they judge the page.
 * (The action's own `requires: "manage_users"` is pinned by `src/actions/action-capabilities.test.ts`.)
 * Every target is a throwaway user, and roles are read back as the service role.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

(hasEnv ? describe : describe.skip)("changeUserRole (local Supabase)", () => {
  let service: SupabaseClient;
  let admin: SignedInUser;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    service = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
    admin = await createSignedInUser(service, { role: "admin" });
  });

  afterAll(async () => {
    await teardown(service);
  });

  it("lets an admin give a role-less user a role, change it, and remove it", async () => {
    const { id: target } = await createAuthUser(service);

    await changeUserRole(admin.client, { userId: target, role: "viewer" });
    expect(await roleOf(service, target)).toBe("viewer");

    await changeUserRole(admin.client, { userId: target, role: "author" });
    expect(await roleOf(service, target)).toBe("author");

    await changeUserRole(admin.client, { userId: target, role: null });
    expect(await roleOf(service, target)).toBeNull();
  });

  it("changes a deactivated user's role and keeps them deactivated: a role change never reactivates (S-408)", async () => {
    const target = await userWithRole(service, "author", { deactivated: true });

    await changeUserRole(admin.client, { userId: target, role: "viewer" });

    expect(await roleRowOf(service, target)).toEqual({ role: "viewer", deactivated: true });
  });

  it("refuses an author with FORBIDDEN, and leaves the role as it was", async () => {
    const author = await createSignedInUser(service, { role: "author" });
    const target = await userWithRole(service, "viewer");

    await expect(changeUserRole(author.client, { userId: target, role: "author" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: FORBIDDEN_MESSAGE,
    });
    expect(await roleOf(service, target)).toBe("viewer");
  });

  it("reports removing the role of a role-less user as NOT_FOUND", async () => {
    const { id: target } = await createAuthUser(service);

    await expect(changeUserRole(admin.client, { userId: target, role: null })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: NO_ROLE_TO_REMOVE_MESSAGE,
    });
  });

  it("refuses giving a machine user a role with FORBIDDEN", async () => {
    const { id: machine } = await createAuthUser(service, { appMetadata: { machine_role: "solver_job_writer" } });

    await expect(changeUserRole(admin.client, { userId: machine, role: "viewer" })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: FORBIDDEN_MESSAGE,
    });
    expect(await roleOf(service, machine)).toBeNull();
  });
});

/** A fresh user given `role` by the service role, deactivated in the same write when asked, and its id. */
const userWithRole = async (
  service: SupabaseClient,
  role: AppRole,
  { deactivated = false }: { deactivated?: boolean } = {},
): Promise<string> => {
  const { id } = await createAuthUser(service);
  const deactivatedAt = deactivated ? new Date().toISOString() : null;
  const { error } = await service.from("user_roles").insert({ user_id: id, role, deactivated_at: deactivatedAt });
  if (error) throw new Error(`setup failed: ${error.message}`);
  return id;
};

/** The role row `userId` holds, and whether it is deactivated, read as the service role. */
const roleRowOf = async (
  service: SupabaseClient,
  userId: string,
): Promise<{ role: AppRole; deactivated: boolean } | null> => {
  const { data, error } = await service
    .from("user_roles")
    .select("role, deactivated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`read-back failed: ${error.message}`);
  return data && { role: data.role, deactivated: data.deactivated_at !== null };
};

/** The role `userId` holds, read as the service role; null when it holds none. */
const roleOf = async (service: SupabaseClient, userId: string): Promise<AppRole | null> => {
  const { data, error } = await service.from("user_roles").select("role").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`read-back failed: ${error.message}`);
  return data?.role ?? null;
};
